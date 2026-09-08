"""Shared entity base for the QWeather integration."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_LOCATION_NAME, DOMAIN
from .coordinator import QWeatherDataUpdateCoordinator


class QWeatherEntity(CoordinatorEntity[QWeatherDataUpdateCoordinator]):
    """Common device info and coordinator wiring for all QWeather entities."""

    _attr_has_entity_name = True

    def __init__(
        self, coordinator: QWeatherDataUpdateCoordinator, entry: ConfigEntry
    ) -> None:
        """Initialise the entity and attach it to the integration's device."""
        super().__init__(coordinator)
        self._entry = entry

        location = entry.data.get(CONF_LOCATION_NAME, "QWeather")
        name = (
            f"QWeather ({location})"
            if location and location not in ("和风天气", "QWeather")
            else "QWeather"
        )
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=name,
            manufacturer="QWeather",
            model="QWeather",
            entry_type=DeviceEntryType.SERVICE,
        )
