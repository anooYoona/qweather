"""Sensor platform for the QWeather integration."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    PERCENTAGE,
    UnitOfPressure,
    UnitOfSpeed,
    UnitOfTemperature,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.typing import StateType

from . import QWeatherConfigEntry
from .coordinator import QWeatherDataUpdateCoordinator
from .entity import QWeatherEntity

Coordinator = QWeatherDataUpdateCoordinator


@dataclass(frozen=True, kw_only=True)
class QWeatherSensorEntityDescription(SensorEntityDescription):
    """Describes a QWeather sensor, including how to derive its state.

    Display names come from `translation_key`, so they follow the Home
    Assistant UI language. Entity IDs are pinned separately in
    `QWeatherSensor.__init__` and stay English regardless.

    Both callables take the coordinator rather than just its data, so a sensor
    can also see the language and whether its bucket has ever been fetched.
    """

    value_fn: Callable[[Coordinator], StateType]
    attr_fn: Callable[[Coordinator], dict[str, Any]] | None = None


def _no_data(coordinator: Coordinator) -> str:
    """State shown before a bucket has ever returned successfully."""
    return "No data" if coordinator.language == "en" else "无数据"


def _now_value(key: str) -> Callable[[Coordinator], StateType]:
    """Build a value function reading one key out of the `now` payload."""

    def _value(coordinator: Coordinator) -> StateType:
        return coordinator.data["now"].get(key)

    return _value


def _count_state(key: str, suffix_en: str, suffix_zh: str) -> Callable[[Coordinator], StateType]:
    """Build a "N available" summary state for a forecast list."""

    def _value(coordinator: Coordinator) -> StateType:
        items = coordinator.data[key]
        if not items:
            return _no_data(coordinator)
        if coordinator.language == "en":
            return f"{len(items)}{suffix_en} Available"
        return f"{len(items)}{suffix_zh} 预测可用"

    return _value


def _air_state(coordinator: Coordinator) -> StateType:
    """Return "category (aqi)" — the card substring-matches on this order."""
    air = coordinator.data["air"]
    if not coordinator.has_fetched("air"):
        return _no_data(coordinator)
    category, aqi = air.get("category"), air.get("aqi")
    if category and aqi:
        return f"{category} ({aqi})"
    return category or aqi or _no_data(coordinator)


def _warning_state(coordinator: Coordinator) -> StateType:
    """Summarise the active alerts.

    "无预警" means the API was queried and reported nothing active; "无数据"
    means the alert endpoint has not answered yet.
    """
    is_en = coordinator.language == "en"
    if not coordinator.has_fetched("warning"):
        return _no_data(coordinator)

    alerts = coordinator.data["warning"]
    if not alerts:
        return "No alerts" if is_en else "无预警"

    title = alerts[0].get("title") or ""
    if len(alerts) == 1:
        return title
    return f"{title} ({len(alerts)} alerts)" if is_en else f"{title} (共{len(alerts)}条)"


def _indices_state(coordinator: Coordinator) -> StateType:
    """Return the clothing index category, which the card localises."""
    indices = coordinator.data["indices"]
    if not indices:
        return _no_data(coordinator)
    for item in indices:
        if item.get("type") == "3":
            return item.get("category")
    return indices[0].get("category")


def _indices_attrs(coordinator: Coordinator) -> dict[str, Any]:
    """Expose indices both as a list and as flat "name -> category - text" keys.

    The card prefers the list, but uses the flat keys as a discovery
    fingerprint and as a fallback renderer, where the " - " separator and the
    string type are both load-bearing.
    """
    indices = coordinator.data["indices"]
    attrs: dict[str, Any] = {}
    for item in indices:
        name, category, text = item.get("name"), item.get("category"), item.get("text")
        if name:
            attrs[name] = f"{category} - {text}" if text else category
    attrs["indices"] = indices
    return attrs


SENSORS: tuple[QWeatherSensorEntityDescription, ...] = (
    QWeatherSensorEntityDescription(
        key="now",
        translation_key="now",
        icon="mdi:weather-partly-cloudy",
        value_fn=lambda c: c.data["now"].get("text") or _no_data(c),
        attr_fn=lambda c: {**c.data["now"], "language": c.language},
    ),
    QWeatherSensorEntityDescription(
        key="hourly",
        translation_key="hourly",
        icon="mdi:chart-timeline-variant",
        value_fn=_count_state("hourly", "h", "h"),
        attr_fn=lambda c: {"hourly": c.data["hourly"]},
    ),
    QWeatherSensorEntityDescription(
        key="forecast",
        translation_key="forecast",
        icon="mdi:calendar-week",
        value_fn=_count_state("daily", "d", "天"),
        attr_fn=lambda c: {"daily": c.data["daily"]},
    ),
    QWeatherSensorEntityDescription(
        key="air",
        translation_key="air",
        icon="mdi:air-filter",
        value_fn=_air_state,
        attr_fn=lambda c: {**c.data["air"], "language": c.language},
    ),
    QWeatherSensorEntityDescription(
        key="warning",
        translation_key="warning",
        icon="mdi:alert-circle-outline",
        value_fn=_warning_state,
        attr_fn=lambda c: {
            "count": len(c.data["warning"]),
            "alerts": c.data["warning"],
            "language": c.language,
        },
    ),
    QWeatherSensorEntityDescription(
        key="indices",
        translation_key="indices",
        icon="mdi:tshirt-crew-outline",
        value_fn=_indices_state,
        attr_fn=_indices_attrs,
    ),
    QWeatherSensorEntityDescription(
        key="temperature",
        translation_key="temperature",
        device_class=SensorDeviceClass.TEMPERATURE,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        suggested_display_precision=1,
        value_fn=_now_value("temp"),
    ),
    QWeatherSensorEntityDescription(
        key="humidity",
        translation_key="humidity",
        device_class=SensorDeviceClass.HUMIDITY,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=PERCENTAGE,
        suggested_display_precision=0,
        value_fn=_now_value("humidity"),
    ),
    QWeatherSensorEntityDescription(
        key="pressure",
        translation_key="pressure",
        device_class=SensorDeviceClass.ATMOSPHERIC_PRESSURE,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfPressure.HPA,
        suggested_display_precision=0,
        value_fn=_now_value("pressure"),
    ),
    QWeatherSensorEntityDescription(
        key="wind_speed",
        translation_key="wind_speed",
        device_class=SensorDeviceClass.WIND_SPEED,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfSpeed.KILOMETERS_PER_HOUR,
        suggested_display_precision=1,
        value_fn=_now_value("windSpeed"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: QWeatherConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the QWeather sensor entities."""
    async_add_entities(
        QWeatherSensor(entry.runtime_data, entry, description) for description in SENSORS
    )


class QWeatherSensor(QWeatherEntity, SensorEntity):
    """A QWeather sensor driven entirely by its entity description."""

    entity_description: QWeatherSensorEntityDescription

    def __init__(
        self,
        coordinator: Coordinator,
        entry: ConfigEntry,
        description: QWeatherSensorEntityDescription,
    ) -> None:
        """Initialise the sensor from its description."""
        super().__init__(coordinator, entry)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        # Pinned rather than suggested: the custom card falls back to this
        # exact entity_id when it cannot discover the entity.
        self.entity_id = f"sensor.qweather_{description.key}"

    @property
    def native_value(self) -> StateType:
        """Return the sensor state."""
        return self.entity_description.value_fn(self.coordinator)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the sensor attributes, if this sensor exposes any."""
        if (attr_fn := self.entity_description.attr_fn) is None:
            return None
        return attr_fn(self.coordinator)
