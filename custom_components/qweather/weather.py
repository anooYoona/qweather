"""Weather platform for the QWeather integration."""
from __future__ import annotations

from typing import Any

from homeassistant.components.weather import (
    Forecast,
    WeatherEntity,
    WeatherEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    UnitOfLength,
    UnitOfPressure,
    UnitOfSpeed,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import QWeatherConfigEntry
from .const import CONDITION_MAP
from .coordinator import QWeatherDataUpdateCoordinator
from .entity import QWeatherEntity

# Forecast field -> source key, per forecast granularity.
DAILY_KEYS = {
    "datetime": "fxDate",
    "native_temperature": "tempMax",
    "native_templow": "tempMin",
    "native_precipitation": "precip",
    "humidity": "humidity",
    "native_wind_speed": "windSpeedDay",
    "wind_bearing": "windDirDay",
    "uv_index": "uvIndex",
}
HOURLY_KEYS = {
    "datetime": "fxTime",
    "native_temperature": "temp",
    "native_precipitation": "precip",
    "humidity": "humidity",
    "native_wind_speed": "windSpeed",
    "wind_bearing": "windDir",
    "native_pressure": "pressure",
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: QWeatherConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the QWeather weather entity."""
    async_add_entities([QWeatherWeather(entry.runtime_data, entry)])


def _map_forecast(
    items: list[dict[str, Any]], keys: dict[str, str], icon_key: str
) -> list[Forecast]:
    """Project coordinator items onto Home Assistant Forecast dicts."""
    forecasts: list[Forecast] = []
    for item in items:
        if not (when := item.get(keys["datetime"])):
            continue
        forecast: Forecast = {
            "datetime": when,
            "condition": CONDITION_MAP.get(str(item.get(icon_key)), "sunny"),
        }
        for field, source in keys.items():
            if field != "datetime":
                forecast[field] = item.get(source)  # type: ignore[literal-required]
        forecasts.append(forecast)
    return forecasts


class QWeatherWeather(QWeatherEntity, WeatherEntity):
    """The QWeather weather entity."""

    _attr_name = None  # Inherits the device name
    _attr_native_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_pressure_unit = UnitOfPressure.HPA
    _attr_native_wind_speed_unit = UnitOfSpeed.KILOMETERS_PER_HOUR
    _attr_native_visibility_unit = UnitOfLength.KILOMETERS
    _attr_supported_features = (
        WeatherEntityFeature.FORECAST_DAILY | WeatherEntityFeature.FORECAST_HOURLY
    )

    def __init__(
        self, coordinator: QWeatherDataUpdateCoordinator, entry: ConfigEntry
    ) -> None:
        """Initialise the weather entity."""
        super().__init__(coordinator, entry)
        self._attr_unique_id = f"{entry.entry_id}_weather"
        # Pinned rather than suggested: the custom card looks this up by name.
        self.entity_id = "weather.qweather"

    @property
    def _now(self) -> dict[str, Any]:
        """Return the current-conditions payload."""
        return self.coordinator.data["now"]

    @property
    def condition(self) -> str | None:
        """Return the current condition."""
        return CONDITION_MAP.get(str(self._now.get("icon", "")), "sunny")

    @property
    def native_temperature(self) -> float | None:
        """Return the current temperature."""
        return self._now.get("temp")

    @property
    def native_apparent_temperature(self) -> float | None:
        """Return the apparent (feels-like) temperature."""
        return self._now.get("feelsLike")

    @property
    def humidity(self) -> float | None:
        """Return the current humidity."""
        return self._now.get("humidity")

    @property
    def native_pressure(self) -> float | None:
        """Return the current barometric pressure."""
        return self._now.get("pressure")

    @property
    def native_wind_speed(self) -> float | None:
        """Return the current wind speed."""
        return self._now.get("windSpeed")

    @property
    def wind_bearing(self) -> float | str | None:
        """Return the wind bearing in degrees, falling back to the compass point."""
        bearing = self._now.get("wind360")
        return bearing if bearing is not None else self._now.get("windDir")

    @property
    def native_visibility(self) -> float | None:
        """Return the current visibility."""
        return self._now.get("vis")

    @property
    def uv_index(self) -> float | None:
        """Return today's UV index.

        Sourced from the daily forecast rather than the life indices, so it
        keeps working when the user deselects the UV life index.
        """
        if daily := self.coordinator.data["daily"]:
            return daily[0].get("uvIndex")
        return None

    async def async_forecast_daily(self) -> list[Forecast] | None:
        """Return the daily forecast."""
        return _map_forecast(self.coordinator.data["daily"], DAILY_KEYS, "iconDay")

    async def async_forecast_hourly(self) -> list[Forecast] | None:
        """Return the hourly forecast."""
        return _map_forecast(self.coordinator.data["hourly"], HOURLY_KEYS, "icon")
