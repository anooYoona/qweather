"""Config and options flow for the QWeather integration."""
from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    SelectOptionDict,
)

from .api import QWeatherAuth, QWeatherAuthError, QWeatherClient, QWeatherError
from .const import (
    CONF_API_HOST,
    CONF_API_KEY,
    CONF_INDICES,
    CONF_INTERVAL_AIR,
    CONF_INTERVAL_FORECAST,
    CONF_INTERVAL_NOW,
    CONF_INTERVAL_WARNING,
    CONF_JWT_KEY_ID,
    CONF_JWT_PRIVATE_KEY,
    CONF_JWT_PROJECT_ID,
    CONF_LANGUAGE,
    CONF_LATITUDE,
    CONF_LOCATION,
    CONF_LOCATION_NAME,
    CONF_LONGITUDE,
    DEFAULT_INDICES,
    DEFAULT_INTERVAL_AIR,
    DEFAULT_INTERVAL_FORECAST,
    DEFAULT_INTERVAL_NOW,
    DEFAULT_INTERVAL_WARNING,
    DEFAULT_LANGUAGE,
    DOMAIN,
    INDEX_TYPES,
    is_chinese_system,
)

_LOGGER = logging.getLogger(__name__)


def _language_options(is_zh: bool) -> dict[str, str]:
    """Return the language dropdown choices, labelled for the local audience."""
    if is_zh:
        return {"auto": "自动跟随系统", "zh": "中文", "en": "English"}
    return {"auto": "Auto", "en": "English", "zh": "中文"}


def _indices_selector(is_zh: bool) -> SelectSelector:
    """Return the multi-select for life-index types."""
    return SelectSelector(
        SelectSelectorConfig(
            options=[
                SelectOptionDict(value=key, label=labels[1] if is_zh else labels[0])
                for key, labels in INDEX_TYPES.items()
            ],
            multiple=True,
            mode=SelectSelectorMode.DROPDOWN,
            sort=False,
        )
    )


def _parse_coordinates(text: str) -> tuple[float, float] | None:
    """Parse "lat,lon" or "lon,lat" into (latitude, longitude).

    QWeather writes coordinates longitude-first, but users routinely paste them
    the other way round, so disambiguate on magnitude: only a longitude can
    exceed 90 degrees.
    """
    parts = text.split(",")
    if len(parts) != 2:
        return None
    try:
        first, second = float(parts[0].strip()), float(parts[1].strip())
    except ValueError:
        return None
    return (second, first) if abs(first) > 90 else (first, second)


async def _resolve_location(
    hass: Any, client: QWeatherClient, location: str
) -> tuple[float, float, str]:
    """Resolve user input to (latitude, longitude, display name)."""
    location = location.strip()
    if not location:
        return hass.config.latitude, hass.config.longitude, "Home"

    if coordinates := _parse_coordinates(location):
        return coordinates[0], coordinates[1], location

    if resolved := await client.lookup_city(location):
        return resolved

    raise InvalidLocation(f"Could not resolve location {location!r}")


async def _validate(hass: Any, data: dict[str, Any]) -> dict[str, Any]:
    """Validate credentials, resolve the location, and return entry data."""
    host = data.get(CONF_API_HOST, "").replace("https://", "").replace("http://", "")
    host = host.strip().rstrip("/")
    if not host:
        raise CannotConnect("No API host provided")

    auth = QWeatherAuth(
        api_key=data.get(CONF_API_KEY),
        private_key=data.get(CONF_JWT_PRIVATE_KEY),
        key_id=data.get(CONF_JWT_KEY_ID),
        project_id=data.get(CONF_JWT_PROJECT_ID),
    )
    client = QWeatherClient(async_get_clientsession(hass), host, auth)

    latitude, longitude, name = await _resolve_location(
        hass, client, data.get(CONF_LOCATION, "")
    )

    # Probe the one endpoint every install needs, to fail fast on bad keys.
    await client.get_current(latitude, longitude)

    return {
        **data,
        CONF_API_HOST: host,
        CONF_LATITUDE: round(latitude, 2),
        CONF_LONGITUDE: round(longitude, 2),
        CONF_LOCATION_NAME: name,
    }


class QWeatherConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for QWeather."""

    VERSION = 2

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Let the user pick an authentication method."""
        return self.async_show_menu(step_id="user", menu_options=["api_key", "jwt"])

    async def async_step_api_key(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Configure the integration with a standard API key."""
        return await self._async_credentials_step(
            "api_key", {vol.Required(CONF_API_KEY): str}, user_input
        )

    async def async_step_jwt(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Configure the integration with Ed25519 JWT credentials."""
        return await self._async_credentials_step(
            "jwt",
            {
                vol.Required(CONF_JWT_PRIVATE_KEY): str,
                vol.Required(CONF_JWT_KEY_ID): str,
                vol.Required(CONF_JWT_PROJECT_ID): str,
            },
            user_input,
        )

    async def _async_credentials_step(
        self,
        step_id: str,
        credential_schema: dict[Any, Any],
        user_input: dict[str, Any] | None,
    ) -> ConfigFlowResult:
        """Collect credentials plus the common settings, then validate."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                data = await _validate(self.hass, user_input)
            except InvalidLocation:
                errors["base"] = "invalid_location"
            except QWeatherAuthError:
                errors["base"] = "invalid_auth"
            except (CannotConnect, QWeatherError):
                errors["base"] = "cannot_connect"
            except Exception:  # noqa: BLE001 - surfaced to the user as "unknown"
                _LOGGER.exception("Unexpected error setting up QWeather")
                errors["base"] = "unknown"
            else:
                await self.async_set_unique_id(
                    f"qweather_{data[CONF_LATITUDE]}_{data[CONF_LONGITUDE]}"
                )
                self._abort_if_unique_id_configured()

                name = data[CONF_LOCATION_NAME]
                title = "QWeather" if name in ("Home", "") or "," in name else f"QWeather ({name})"
                return self.async_create_entry(title=title, data=data)

        is_zh = is_chinese_system(self.hass)
        schema = vol.Schema(
            {
                **credential_schema,
                vol.Required(CONF_API_HOST): str,
                vol.Optional(CONF_LOCATION, default=""): str,
                vol.Optional(CONF_LANGUAGE, default=DEFAULT_LANGUAGE): vol.In(
                    _language_options(is_zh)
                ),
                vol.Optional(CONF_INDICES, default=DEFAULT_INDICES): _indices_selector(is_zh),
            }
        )
        return self.async_show_form(
            step_id=step_id,
            data_schema=self.add_suggested_values_to_schema(schema, user_input or {}),
            errors=errors,
        )

    async def async_step_reauth(
        self, entry_data: Mapping[str, Any]
    ) -> ConfigFlowResult:
        """Start reauthentication after the API rejected the credentials."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Collect fresh credentials for an existing entry."""
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                await _validate(self.hass, {**entry.data, **user_input})
            except QWeatherAuthError:
                errors["base"] = "invalid_auth"
            except (CannotConnect, QWeatherError, InvalidLocation):
                errors["base"] = "cannot_connect"
            else:
                return self.async_update_reload_and_abort(
                    entry, data_updates=user_input
                )

        uses_jwt = bool(entry.data.get(CONF_JWT_PRIVATE_KEY))
        schema = vol.Schema(
            {
                vol.Required(CONF_JWT_PRIVATE_KEY): str,
                vol.Required(CONF_JWT_KEY_ID): str,
                vol.Required(CONF_JWT_PROJECT_ID): str,
            }
            if uses_jwt
            else {vol.Required(CONF_API_KEY): str}
        )
        return self.async_show_form(
            step_id="reauth_confirm", data_schema=schema, errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow handler."""
        return QWeatherOptionsFlow()


class QWeatherOptionsFlow(OptionsFlow):
    """Handle the QWeather options flow."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage language, host, location, indices and update intervals."""
        entry = self.config_entry
        errors: dict[str, str] = {}

        if user_input is not None:
            user_input[CONF_API_HOST] = (
                user_input[CONF_API_HOST]
                .replace("https://", "")
                .replace("http://", "")
                .strip()
                .rstrip("/")
            )
            location = user_input.pop(CONF_LOCATION, "").strip()

            # Only touch GeoAPI when the location actually changed.
            if location != entry.data.get(CONF_LOCATION, ""):
                try:
                    resolved = await _validate(
                        self.hass,
                        {**entry.data, **user_input, CONF_LOCATION: location},
                    )
                except InvalidLocation:
                    errors["base"] = "invalid_location"
                except QWeatherAuthError:
                    errors["base"] = "invalid_auth"
                except (CannotConnect, QWeatherError):
                    errors["base"] = "cannot_connect"
                else:
                    self.hass.config_entries.async_update_entry(
                        entry,
                        data={
                            **entry.data,
                            CONF_LOCATION: location,
                            CONF_LATITUDE: resolved[CONF_LATITUDE],
                            CONF_LONGITUDE: resolved[CONF_LONGITUDE],
                            CONF_LOCATION_NAME: resolved[CONF_LOCATION_NAME],
                        },
                    )

            if not errors:
                return self.async_create_entry(title="", data=user_input)

        options = entry.options
        is_zh = is_chinese_system(self.hass, entry)

        def current(key: str, default: Any) -> Any:
            return options.get(key, entry.data.get(key, default))

        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_LANGUAGE, default=current(CONF_LANGUAGE, DEFAULT_LANGUAGE)
                ): vol.In(_language_options(is_zh)),
                vol.Optional(CONF_API_HOST, default=current(CONF_API_HOST, "")): str,
                vol.Optional(CONF_LOCATION, default=current(CONF_LOCATION, "")): str,
                vol.Optional(
                    CONF_INDICES, default=current(CONF_INDICES, DEFAULT_INDICES)
                ): _indices_selector(is_zh),
                vol.Optional(
                    CONF_INTERVAL_WARNING,
                    default=current(CONF_INTERVAL_WARNING, DEFAULT_INTERVAL_WARNING),
                ): vol.All(vol.Coerce(int), vol.Range(min=5, max=60)),
                vol.Optional(
                    CONF_INTERVAL_NOW,
                    default=current(CONF_INTERVAL_NOW, DEFAULT_INTERVAL_NOW),
                ): vol.All(vol.Coerce(int), vol.Range(min=10, max=120)),
                vol.Optional(
                    CONF_INTERVAL_AIR,
                    default=current(CONF_INTERVAL_AIR, DEFAULT_INTERVAL_AIR),
                ): vol.All(vol.Coerce(int), vol.Range(min=15, max=180)),
                vol.Optional(
                    CONF_INTERVAL_FORECAST,
                    default=current(CONF_INTERVAL_FORECAST, DEFAULT_INTERVAL_FORECAST),
                ): vol.All(vol.Coerce(int), vol.Range(min=30, max=360)),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)


class CannotConnect(Exception):
    """Raised when the QWeather host is unreachable or misconfigured."""


class InvalidLocation(Exception):
    """Raised when the configured location cannot be resolved."""
