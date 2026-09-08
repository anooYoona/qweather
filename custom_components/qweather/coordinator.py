"""DataUpdateCoordinator for the QWeather integration.

Owns polling cadence and turns v1 API payloads into the flat attribute shapes
the entities and the custom card consume. All networking lives in `api.py`.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import logging
import time
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import (
    QWeatherAuth,
    QWeatherAuthError,
    QWeatherClient,
    QWeatherError,
    QWeatherRateLimitError,
)
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
    CONF_LONGITUDE,
    DEFAULT_INDICES,
    DEFAULT_INTERVAL_AIR,
    DEFAULT_INTERVAL_FORECAST,
    DEFAULT_INTERVAL_NOW,
    DEFAULT_INTERVAL_WARNING,
    DEFAULT_LANGUAGE,
    is_chinese_system,
)

_LOGGER = logging.getLogger(__name__)

# key -> (interval option, interval default). Buckets refresh independently so
# alerts can be polled often without dragging the forecast along with them.
SCHEDULE: tuple[tuple[str, str, int], ...] = (
    ("warning", CONF_INTERVAL_WARNING, DEFAULT_INTERVAL_WARNING),
    ("now", CONF_INTERVAL_NOW, DEFAULT_INTERVAL_NOW),
    ("air", CONF_INTERVAL_AIR, DEFAULT_INTERVAL_AIR),
    ("daily", CONF_INTERVAL_FORECAST, DEFAULT_INTERVAL_FORECAST),
    ("hourly", CONF_INTERVAL_FORECAST, DEFAULT_INTERVAL_FORECAST),
    ("indices", CONF_INTERVAL_FORECAST, DEFAULT_INTERVAL_FORECAST),
)

EMPTY_DATA: dict[str, Any] = {
    "now": {},
    "daily": [],
    "hourly": [],
    "air": {},
    "warning": [],
    "indices": [],
}


# QWeather v1 reports wind in m/s and visibility in metres, while the card and
# the sensors present km/h and km. Humidity, cloud cover and precipitation
# probability all come back as 0..1 fractions rather than percentages.
M_S_TO_KM_H = 3.6
M_TO_KM = 0.001


def _value(node: Any, default: Any = None) -> Any:
    """Unwrap a v1 scalar, which may be bare or wrapped as {"value": x}."""
    if isinstance(node, dict):
        return node.get("value", default)
    return default if node is None else node


def _num(
    node: Any, default: float | None = None, ndigits: int = 1, scale: float = 1.0
) -> float | None:
    """Unwrap a v1 scalar and coerce it to a scaled, rounded float."""
    raw = _value(node)
    if raw is None or raw == "":
        return default
    try:
        return round(float(raw) * scale, ndigits)
    except (TypeError, ValueError):
        return default


def _percent(node: Any, default: float | None = None) -> float | None:
    """Convert a 0..1 fraction to a percentage."""
    return _num(node, default, ndigits=0, scale=100)


def _speed(node: Any, default: float | None = None) -> float | None:
    """Convert a wind speed in m/s to km/h."""
    return _num(node, default, ndigits=1, scale=M_S_TO_KM_H)


def _dict(node: Any) -> dict[str, Any]:
    """Return the node if it is a mapping, else an empty one."""
    return node if isinstance(node, dict) else {}


def _local(timestamp: Any) -> datetime | None:
    """Parse a UTC v1 timestamp into Home Assistant's local timezone."""
    if not timestamp:
        return None
    parsed = dt_util.parse_datetime(str(timestamp))
    return dt_util.as_local(parsed) if parsed else None


def _hhmm(timestamp: Any) -> str:
    """Format a v1 timestamp as local HH:MM."""
    local = _local(timestamp)
    return local.strftime("%H:%M") if local else ""


def _condition(node: Any, default_code: str = "100") -> tuple[str, str]:
    """Return (icon code, text) from a v1 condition object."""
    condition = _dict(node)
    if not condition:
        return default_code, ""
    return str(condition.get("code", default_code)), str(condition.get("text", ""))


def _wind(node: Any) -> dict[str, Any]:
    """Flatten a v1 wind object, converting m/s to km/h."""
    wind = _dict(node)
    direction = _dict(wind.get("direction"))
    return {
        "speed": _speed(wind.get("speed")),
        "bearing": _num(direction.get("degree"), ndigits=0),
        "compass": str(direction.get("compass", "")).upper(),
        "scale": str(wind.get("scale", "")),
    }


def _precipitation(node: Any) -> tuple[float | None, float | None]:
    """Return (amount in mm, probability as a percentage)."""
    precipitation = _dict(node)
    return (
        _num(precipitation.get("amount"), 0.0),
        _percent(precipitation.get("probability"), 0.0),
    )


def transform_current(data: dict[str, Any]) -> dict[str, Any]:
    """Flatten /weather/v1/current into the `now` attribute payload."""
    icon, text = _condition(data.get("condition"))
    wind = _wind(data.get("wind"))
    temp = _num(data.get("temperature"))
    precip, _ = _precipitation(data.get("precipitation"))

    return {
        "temp": temp,
        "feelsLike": _num(data.get("feelsLike"), temp),
        "icon": icon,
        "text": text,
        "wind360": wind["bearing"],
        "windDir": wind["compass"],
        "windScale": wind["scale"],
        "windSpeed": wind["speed"],
        "humidity": _percent(data.get("humidity")),
        "precip": precip,
        "pressure": _num(data.get("pressure"), ndigits=0),
        "vis": _num(data.get("visibility"), scale=M_TO_KM),
        "cloud": _percent(data.get("cloudCover")),
        "dew": _num(data.get("dewPoint")),
        # v1 does not report an observation time, so stamp the fetch.
        "obsTime": _dict(data.get("metadata")).get("obsTime") or dt_util.now().isoformat(),
        "uvIndex": _num(data.get("uvIndex"), ndigits=0),
    }


def transform_daily(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten /weather/v1/daily into the `daily` attribute list."""
    result: list[dict[str, Any]] = []
    for day in data.get("days") or []:
        daytime = _dict(day.get("daytime"))
        nighttime = _dict(day.get("nighttime"))
        astro = _dict(day.get("astro"))
        icon_day, text_day = _condition(daytime.get("condition"))
        icon_night, text_night = _condition(nighttime.get("condition"), "150")
        wind = _wind(daytime.get("wind"))
        precip, pop = _precipitation(daytime.get("precipitation"))

        # forecastStartTime is UTC; the card needs the *local* calendar date,
        # and daily[0] must be today.
        start = _local(day.get("forecastStartTime"))

        result.append(
            {
                "fxDate": start.strftime("%Y-%m-%d") if start else "",
                "tempMax": _num(day.get("temperatureMax")),
                "tempMin": _num(day.get("temperatureMin")),
                "iconDay": icon_day,
                "textDay": text_day,
                "iconNight": icon_night,
                "textNight": text_night,
                "windSpeedDay": wind["speed"],
                "windDirDay": wind["compass"],
                "windScaleDay": wind["scale"],
                "humidity": _percent(daytime.get("humidity")),
                "precip": precip,
                "pop": pop,
                "uvIndex": _num(day.get("uvIndexMax"), ndigits=0),
                "sunrise": _hhmm(astro.get("sunrise")),
                "sunset": _hhmm(astro.get("sunset")),
            }
        )
    return result


def transform_hourly(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten /weather/v1/hourly into the `hourly` attribute list."""
    result: list[dict[str, Any]] = []
    for hour in data.get("hours") or []:
        icon, text = _condition(hour.get("condition"))
        wind = _wind(hour.get("wind"))
        precip, pop = _precipitation(hour.get("precipitation"))
        forecast_time = _local(hour.get("forecastTime"))

        result.append(
            {
                "fxTime": forecast_time.isoformat() if forecast_time else "",
                "temp": _num(hour.get("temperature")),
                "icon": icon,
                "text": text,
                "precip": precip,
                "pop": pop,
                "windSpeed": wind["speed"],
                "wind360": wind["bearing"],
                "windDir": wind["compass"],
                "humidity": _percent(hour.get("humidity")),
                "pressure": _num(hour.get("pressure"), ndigits=0),
            }
        )
    return result


def transform_air(data: dict[str, Any]) -> dict[str, Any]:
    """Flatten /airquality/v1/current into the `air` attribute payload."""
    indexes = data.get("indexes") or []
    chosen: dict[str, Any] = {}
    for index in indexes:
        chosen = chosen or index
        if str(index.get("code", "")).lower() in ("qaqi", "cn", "cn-mee", "aqi"):
            chosen = index
            break

    primary = chosen.get("primaryPollutant")
    if isinstance(primary, dict):
        primary_name = primary.get("name") or primary.get("code") or ""
    else:
        primary_name = primary or ""

    air: dict[str, Any] = {
        # Kept as a string: the card renders `attrs.aqi || '--'`, so a numeric
        # zero would display as '--'.
        "aqi": str(chosen.get("aqiDisplay") or chosen.get("aqi", "")),
        "category": str(chosen.get("category", "")),
        "level": str(chosen.get("level", "")),
        "primary": str(primary_name),
        "pubTime": _dict(data.get("metadata")).get("pubTime", ""),
    }

    pollutant_keys = {
        "pm25": "pm2p5", "pm2p5": "pm2p5", "pm10": "pm10",
        "no2": "no2", "so2": "so2", "co": "co", "o3": "o3",
    }
    for pollutant in data.get("pollutants") or []:
        code = str(pollutant.get("code", "")).lower().replace(".", "")
        if key := pollutant_keys.get(code):
            # The card appends the unit itself, so these must stay unitless.
            air[key] = _num(pollutant.get("concentration"))

    return air


def transform_alerts(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten /weatheralert/v1/current into the `alerts` attribute list."""
    result: list[dict[str, Any]] = []
    for alert in data.get("alerts") or []:
        event_type = _dict(alert.get("eventType"))
        type_name = str(event_type.get("name") or alert.get("type") or "")

        # The alert colour lives in `color.code` ("blue"/"yellow"/"orange"/"red"),
        # which is what the card matches on to pick the badge colour and to
        # localise the level. `severity` is a separate CAP field ("minor",
        # "moderate", ...) that the card cannot interpret, so it is only a
        # last resort. Always a string: the card calls .toLowerCase() on it.
        # Title-cased so both card languages resolve it: the English branch
        # passes it through verbatim, the Chinese branch matches on "blue".
        level = str(
            _dict(alert.get("color")).get("code")
            or alert.get("severityColor")
            or alert.get("severity")
            or ""
        ).capitalize()

        issued = _local(
            alert.get("issuedTime")
            or alert.get("onsetTime")
            or alert.get("effectiveTime")
            or alert.get("startTime")
            or alert.get("pubTime")
        )

        result.append(
            {
                "title": str(alert.get("headline") or alert.get("title") or f"{type_name}{level}"),
                # The card reads `type`; `typeName` is kept for templates and
                # automations written against the previous attribute shape.
                "type": type_name,
                "typeName": type_name,
                "level": level,
                "text": str(alert.get("description") or alert.get("text") or ""),
                "pubTime": issued.isoformat() if issued else "",
                "severity": str(alert.get("severity") or ""),
            }
        )
    return result


def transform_indices(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten /v7/indices into the `indices` attribute list.

    Deliberately thin: the payload stays Chinese and the card localises it,
    since the card's translation tables are more complete than any we could
    keep in sync here.
    """
    items = [
        {
            "type": str(item.get("type", "")),
            "name": item.get("name"),
            "category": item.get("category"),
            "text": item.get("text"),
            "level": item.get("level"),
        }
        for item in data.get("daily") or []
    ]
    items.sort(key=lambda item: int(item["type"]) if item["type"].isdigit() else 99)
    return items


class QWeatherDataUpdateCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Fetch QWeather data on independent per-bucket intervals."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialise the coordinator from a config entry."""
        self.entry = entry

        raw_language = (
            entry.options.get(CONF_LANGUAGE)
            or entry.data.get(CONF_LANGUAGE)
            or DEFAULT_LANGUAGE
        )
        if raw_language == "auto":
            self.language = "zh" if is_chinese_system(hass, entry) else "en"
        else:
            self.language = "en" if raw_language == "en" else "zh"

        self.latitude: float = entry.data.get(CONF_LATITUDE) or hass.config.latitude
        self.longitude: float = entry.data.get(CONF_LONGITUDE) or hass.config.longitude

        auth = QWeatherAuth(
            api_key=entry.data.get(CONF_API_KEY),
            private_key=entry.data.get(CONF_JWT_PRIVATE_KEY),
            key_id=entry.data.get(CONF_JWT_KEY_ID),
            project_id=entry.data.get(CONF_JWT_PROJECT_ID),
        )
        self.client = QWeatherClient(
            async_get_clientsession(hass),
            entry.options.get(CONF_API_HOST) or entry.data.get(CONF_API_HOST) or "",
            auth,
            self.language,
        )

        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=entry.title or "QWeather",
            update_interval=timedelta(minutes=5),
        )

        self._last_fetch: dict[str, float] = dict.fromkeys(EMPTY_DATA, 0.0)
        self._cache: dict[str, Any] = {key: value.copy() for key, value in EMPTY_DATA.items()}

    def has_fetched(self, key: str) -> bool:
        """Return True once this bucket has completed at least one fetch.

        Lets entities tell "no alerts right now" apart from "no data yet".
        """
        return self._last_fetch.get(key, 0.0) > 0

    @property
    def indices_types(self) -> list[str]:
        """Return the life-index types the user selected.

        An explicit empty list means "none": it must not fall through to the
        defaults, or deselecting every index would silently re-enable them.
        """
        for source in (self.entry.options, self.entry.data):
            if (types := source.get(CONF_INDICES)) is not None:
                return list(types)
        return list(DEFAULT_INDICES)

    async def _fetch(self, key: str) -> Any:
        """Fetch and transform one bucket."""
        lat, lon = self.latitude, self.longitude
        if key == "now":
            return transform_current(await self.client.get_current(lat, lon))
        if key == "daily":
            return transform_daily(await self.client.get_daily(lat, lon))
        if key == "hourly":
            return transform_hourly(await self.client.get_hourly(lat, lon))
        if key == "air":
            return transform_air(await self.client.get_air(lat, lon))
        if key == "warning":
            return transform_alerts(await self.client.get_alerts(lat, lon))
        # indices: skip the request entirely when the user selected none.
        if types := self.indices_types:
            return transform_indices(await self.client.get_indices(lat, lon, types))
        return []

    async def _async_update_data(self) -> dict[str, Any]:
        """Refresh whichever buckets are due, keeping the last good value."""
        now = time.time()
        due = [
            key
            for key, option, default in SCHEDULE
            if now - self._last_fetch[key] >= self.entry.options.get(option, default) * 60
        ]

        for key in due:
            try:
                result = await self._fetch(key)
            except QWeatherAuthError as err:
                raise ConfigEntryAuthFailed(str(err)) from err
            except QWeatherRateLimitError as err:
                _LOGGER.debug("Skipping %s this cycle: %s", key, err)
                continue
            except QWeatherError as err:
                _LOGGER.warning("Could not update QWeather %s: %s", key, err)
                continue

            # A successful fetch is authoritative, including an empty one:
            # "no active alerts" and "no indices selected" are real answers,
            # and treating them as failures would both re-request them every
            # cycle and leave a cleared alert on screen forever. Stale data is
            # preserved only on the error paths above.
            self._cache[key] = result
            self._last_fetch[key] = now

        if not self._cache["now"]:
            raise UpdateFailed("No current weather data available from QWeather")

        return self._cache
