"""Thin async client for the QWeather API.

Owns everything network-facing: host normalisation, authentication (API key or
locally signed Ed25519 JWT), rate-limit handling, and the exact set of
endpoints this integration is allowed to call.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from typing import Any

from aiohttp import ClientError, ClientSession, ClientTimeout

from .const import DEFAULT_GEOAPI_HOST

_LOGGER = logging.getLogger(__name__)

REQUEST_TIMEOUT = ClientTimeout(total=10, connect=5)

# QWeather caps JWTs at 24h; a short window keeps a leaked token cheap while
# still meaning we sign roughly once per 10 minutes rather than per request.
JWT_TTL = 900
JWT_REFRESH_MARGIN = 300

# Minimum spacing between requests, to avoid tripping the per-second QPS limit
# when several buckets come due in the same update cycle.
REQUEST_SPACING = 0.25


class QWeatherError(Exception):
    """Base error for QWeather API failures."""


class QWeatherAuthError(QWeatherError):
    """Credentials were rejected by the API."""


class QWeatherRateLimitError(QWeatherError):
    """The API returned HTTP 429."""

    def __init__(self, retry_after: float) -> None:
        """Store how long the caller should wait."""
        super().__init__(f"Rate limited, retry in {retry_after:.0f}s")
        self.retry_after = retry_after


def _b64(raw: bytes) -> str:
    """Base64url-encode without padding, as required by JWS."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class QWeatherAuth:
    """Authentication strategy: static API key, or self-signed Ed25519 JWT."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        private_key: str | None = None,
        key_id: str | None = None,
        project_id: str | None = None,
    ) -> None:
        """Initialise with either an API key or a full set of JWT credentials."""
        self.api_key = api_key
        self._private_key_pem = private_key
        self._key_id = key_id
        self._project_id = project_id

        self._token: str | None = None
        self._token_exp: float = 0.0
        self._signing_key: Any = None

    @property
    def uses_jwt(self) -> bool:
        """Return True when this auth signs JWTs rather than sending a key."""
        return bool(self._private_key_pem and self._key_id and self._project_id)

    def _load_key(self) -> Any:
        """Parse and cache the Ed25519 private key from its PEM form."""
        if self._signing_key is not None:
            return self._signing_key

        try:
            from cryptography.hazmat.primitives.serialization import (
                load_pem_private_key,
            )
        except ImportError as err:  # pragma: no cover - ships with HA core
            raise QWeatherError(
                "The 'cryptography' package is required for JWT authentication"
            ) from err

        pem = self._private_key_pem or ""
        try:
            self._signing_key = load_pem_private_key(pem.encode(), password=None)
        except (ValueError, TypeError) as err:
            raise QWeatherAuthError(f"Invalid Ed25519 private key: {err}") from err

        return self._signing_key

    def token(self) -> str:
        """Return a cached JWT, signing a new one only when near expiry."""
        now = time.time()
        if self._token and now < self._token_exp - JWT_REFRESH_MARGIN:
            return self._token

        key = self._load_key()
        header = {"alg": "EdDSA", "kid": self._key_id}
        payload = {"sub": self._project_id, "iat": int(now) - 30, "exp": int(now) + JWT_TTL}

        signing_input = ".".join(
            _b64(json.dumps(part, separators=(",", ":")).encode())
            for part in (header, payload)
        ).encode()

        self._token = f"{signing_input.decode()}.{_b64(key.sign(signing_input))}"
        self._token_exp = now + JWT_TTL
        _LOGGER.debug("Signed a new QWeather JWT, valid for %ss", JWT_TTL)
        return self._token

    def headers(self) -> dict[str, str]:
        """Return the auth headers for a request."""
        if self.uses_jwt:
            return {"Authorization": f"Bearer {self.token()}"}
        # Note: the API key must NOT be sent as a Bearer token; the gateway
        # would try to parse it as a JWT and reject it with a 401.
        return {"X-QW-Api-Key": self.api_key or ""}


class QWeatherClient:
    """Async client restricted to the endpoints this integration needs."""

    def __init__(
        self,
        session: ClientSession,
        host: str,
        auth: QWeatherAuth,
        language: str = "zh",
    ) -> None:
        """Initialise the client for one dedicated API host."""
        self.session = session
        self.host = host.replace("https://", "").replace("http://", "").strip().rstrip("/")
        self.auth = auth
        self.language = language
        self._blocked_until: float = 0.0
        self._last_request: float = 0.0

    async def _get(
        self, path: str, params: dict[str, Any] | None = None, *, host: str | None = None
    ) -> dict[str, Any]:
        """Perform one GET request and return the decoded JSON body."""
        target_host = host or self.host
        if not target_host:
            raise QWeatherError("No QWeather API host configured")

        now = time.time()
        if now < self._blocked_until:
            raise QWeatherRateLimitError(self._blocked_until - now)

        # Space requests out so a burst of due buckets cannot trip the QPS limit.
        elapsed = now - self._last_request
        if elapsed < REQUEST_SPACING:
            await asyncio.sleep(REQUEST_SPACING - elapsed)
        self._last_request = time.time()

        url = f"https://{target_host}{path}"
        try:
            async with self.session.get(
                url,
                params=params,
                headers=self.auth.headers(),
                timeout=REQUEST_TIMEOUT,
            ) as response:
                if response.status == 429:
                    retry_after = float(response.headers.get("Retry-After") or 60)
                    self._blocked_until = time.time() + retry_after
                    _LOGGER.warning(
                        "QWeather rate limit hit on %s, backing off for %ss", path, retry_after
                    )
                    raise QWeatherRateLimitError(retry_after)

                if response.status in (401, 403):
                    raise QWeatherAuthError(
                        f"QWeather rejected the credentials for {path} (HTTP {response.status})"
                    )

                if response.status != 200:
                    raise QWeatherError(f"{path} returned HTTP {response.status}")

                data: dict[str, Any] = await response.json()
        except (ClientError, TimeoutError, asyncio.TimeoutError) as err:
            raise QWeatherError(f"Error connecting to {url}: {err}") from err

        # The legacy v7 endpoints signal failure in a body field rather than
        # via the HTTP status; v1 endpoints omit `code` entirely.
        code = str(data.get("code", "200"))
        if code not in ("200", "204"):
            if code in ("401", "402", "403"):
                raise QWeatherAuthError(f"{path} returned business code {code}")
            raise QWeatherError(f"{path} returned business code {code}")

        return data

    def _params(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        """Build query params, always carrying the language preference."""
        params: dict[str, Any] = {"lang": self.language}
        if extra:
            params.update(extra)
        return params

    # -- The six runtime endpoints ------------------------------------------
    # v1 endpoints take the coordinates in the path as /{latitude}/{longitude}.

    async def get_current(self, lat: float, lon: float) -> dict[str, Any]:
        """GET /weather/v1/current/{latitude}/{longitude}."""
        return await self._get(f"/weather/v1/current/{lat:.2f}/{lon:.2f}", self._params())

    async def get_daily(self, lat: float, lon: float) -> dict[str, Any]:
        """GET /weather/v1/daily/{latitude}/{longitude}."""
        return await self._get(f"/weather/v1/daily/{lat:.2f}/{lon:.2f}", self._params())

    async def get_hourly(self, lat: float, lon: float) -> dict[str, Any]:
        """GET /weather/v1/hourly/{latitude}/{longitude}."""
        return await self._get(f"/weather/v1/hourly/{lat:.2f}/{lon:.2f}", self._params())

    async def get_alerts(self, lat: float, lon: float) -> dict[str, Any]:
        """GET /weatheralert/v1/current/{latitude}/{longitude}."""
        return await self._get(f"/weatheralert/v1/current/{lat:.2f}/{lon:.2f}", self._params())

    async def get_air(self, lat: float, lon: float) -> dict[str, Any]:
        """GET /airquality/v1/current/{latitude}/{longitude}."""
        return await self._get(f"/airquality/v1/current/{lat:.2f}/{lon:.2f}", self._params())

    async def get_indices(
        self, lat: float, lon: float, types: list[str], days: str = "1d"
    ) -> dict[str, Any]:
        """GET /v7/indices/{days}.

        Unlike the v1 endpoints this is a legacy v7 route: coordinates go in a
        query parameter as `longitude,latitude`, and `lang` must stay `zh` —
        several index types return HTTP 400 for `lang=en`. The card translates
        the Chinese payload client-side.
        """
        return await self._get(
            f"/v7/indices/{days}",
            {
                "location": f"{lon:.2f},{lat:.2f}",
                "type": ",".join(sorted(types, key=int)),
                "lang": "zh",
            },
        )

    # -- Setup-time only ----------------------------------------------------

    async def lookup_city(self, query: str) -> tuple[float, float, str] | None:
        """Resolve a city name to (lat, lon, name) via GeoAPI.

        Called only from the config/options flow, never from the coordinator.
        """
        try:
            data = await self._get(
                "/v2/city/lookup", {"location": query}, host=DEFAULT_GEOAPI_HOST
            )
        except QWeatherError as err:
            _LOGGER.debug("GeoAPI lookup failed for %r: %s", query, err)
            return None

        locations = data.get("location") or []
        if not locations:
            return None

        first = locations[0]
        try:
            return float(first["lat"]), float(first["lon"]), str(first.get("name", query))
        except (KeyError, TypeError, ValueError):
            return None
