"""The QWeather integration."""
from __future__ import annotations

import logging
import os

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.const import LOVELACE_DATA
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import QWeatherAuth, QWeatherClient
from .const import (
    CONF_API_HOST,
    CONF_API_KEY,
    CONF_JWT_KEY_ID,
    CONF_JWT_PRIVATE_KEY,
    CONF_JWT_PROJECT_ID,
    CONF_LANGUAGE,
    CONF_LATITUDE,
    CONF_LOCATION,
    CONF_LONGITUDE,
    DOMAIN,
    PLATFORMS,
)
from .coordinator import QWeatherDataUpdateCoordinator

_LOGGER = logging.getLogger(__name__)

type QWeatherConfigEntry = ConfigEntry[QWeatherDataUpdateCoordinator]

FRONTEND_URL = "/qweather_static"
FRONTEND_FILE = "qweather-card.js"


def _register_services(hass: HomeAssistant) -> None:
    """Register the domain-level set_language service.

    Called by the custom card's visual editor, so it must stay registered.
    """
    if hass.services.has_service(DOMAIN, "set_language"):
        return

    async def async_set_language(call: ServiceCall) -> None:
        """Persist a new language preference on every QWeather entry."""
        language = call.data.get("language")
        if language not in ("auto", "zh", "en"):
            _LOGGER.warning("Invalid language %r; expected auto, zh or en", language)
            return

        for entry in hass.config_entries.async_entries(DOMAIN):
            hass.config_entries.async_update_entry(
                entry, options={**entry.options, CONF_LANGUAGE: language}
            )

    hass.services.async_register(DOMAIN, "set_language", async_set_language)


async def _register_lovelace_resource(hass: HomeAssistant) -> None:
    """Register the custom card in the Lovelace resource list.

    The card already works via `add_extra_js_url`; this makes it visible and
    manageable under Settings -> Dashboards -> Resources.
    """
    url = f"{FRONTEND_URL}/{FRONTEND_FILE}"
    try:
        lovelace = hass.data.get(LOVELACE_DATA)
        if lovelace is None:
            _LOGGER.debug("Lovelace is not set up; skipping resource registration")
            return

        if getattr(lovelace, "resource_mode", "storage") == "yaml":
            # Resources are declared in YAML and are read-only here; the card
            # is injected via add_extra_js_url instead.
            return

        resources = lovelace.resources
        if not hasattr(resources, "async_create_item"):
            _LOGGER.debug("Lovelace resources are not editable; skipping")
            return

        # Storage-mode resources are loaded lazily by the frontend.
        # async_get_info() loads them and maintains the `loaded` flag, which a
        # bare async_load() would leave unset and cause a second load later.
        await resources.async_get_info()

        existing = [
            item
            for item in resources.async_items()
            if FRONTEND_URL in item.get("url", "") or "qweather-card" in item.get("url", "")
        ]

        # Note: create/update take "res_type"; Home Assistant renames it to
        # "type" before storing, which is why reads above look at "url" only.
        if not existing:
            await resources.async_create_item({"res_type": "module", "url": url})
            _LOGGER.info("Registered the QWeather card as a Lovelace resource")
            return

        if existing[0].get("url") != url:
            await resources.async_update_item(
                existing[0]["id"], {"res_type": "module", "url": url}
            )
        for duplicate in existing[1:]:
            await resources.async_delete_item(duplicate["id"])
    except Exception as err:  # noqa: BLE001 - never block setup on the dashboard
        _LOGGER.warning(
            "Could not auto-register the QWeather Lovelace resource (%s). "
            "The card still loads, but will not be listed under "
            "Settings > Dashboards > Resources",
            err,
        )


async def _register_frontend(hass: HomeAssistant) -> None:
    """Serve the custom card and add it to the frontend."""
    frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
    if not os.path.isdir(frontend_dir):
        return

    if not hass.data.get(f"{DOMAIN}_frontend_registered"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL, frontend_dir, False)]
        )

        card_path = os.path.join(frontend_dir, FRONTEND_FILE)
        version = int(os.path.getmtime(card_path)) if os.path.exists(card_path) else 0
        add_extra_js_url(hass, f"{FRONTEND_URL}/{FRONTEND_FILE}?v={version}")
        hass.data[f"{DOMAIN}_frontend_registered"] = True

    async def _register_resource(*_: object) -> None:
        await _register_lovelace_resource(hass)

    if hass.is_running:
        hass.async_create_task(_register_resource())
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _register_resource)


async def async_setup_entry(hass: HomeAssistant, entry: QWeatherConfigEntry) -> bool:
    """Set up QWeather from a config entry."""
    _register_services(hass)
    await _register_frontend(hass)

    coordinator = QWeatherDataUpdateCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_update_listener))
    return True


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate a v1 entry to v2 by resolving and storing its coordinates."""
    if entry.version >= 2:
        return True

    data = {**entry.data}
    if CONF_LATITUDE not in data or CONF_LONGITUDE not in data:
        auth = QWeatherAuth(
            api_key=data.get(CONF_API_KEY),
            private_key=data.get(CONF_JWT_PRIVATE_KEY),
            key_id=data.get(CONF_JWT_KEY_ID),
            project_id=data.get(CONF_JWT_PROJECT_ID),
        )
        client = QWeatherClient(
            async_get_clientsession(hass), data.get(CONF_API_HOST, ""), auth
        )

        latitude, longitude = hass.config.latitude, hass.config.longitude
        if (location := str(data.get(CONF_LOCATION, "")).strip()) and (
            resolved := await client.lookup_city(location)
        ):
            latitude, longitude, _ = resolved

        data[CONF_LATITUDE] = round(latitude, 2)
        data[CONF_LONGITUDE] = round(longitude, 2)

    _migrate_legacy_entity_ids(hass, entry)
    hass.config_entries.async_update_entry(entry, data=data, version=2)
    return True


def _migrate_legacy_entity_ids(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Rename pre-1.0 Chinese/pinyin entity IDs to their English equivalents.

    The custom card falls back to these exact IDs when discovery fails, so
    stale registry entries would leave its tiles wired to nothing.

    Runs once, from async_migrate_entry. A rename that cannot be applied is
    therefore never retried, so it is logged rather than skipped silently.
    """
    registry = er.async_get(hass)
    targets = {
        f"{entry.entry_id}_{key}": f"sensor.qweather_{key}"
        for key in (
            "now", "hourly", "forecast", "air", "warning", "indices",
            "temperature", "humidity", "pressure", "wind_speed",
        )
    }
    targets[f"{entry.entry_id}_weather"] = "weather.qweather"

    for registry_entry in er.async_entries_for_config_entry(registry, entry.entry_id):
        target = targets.get(registry_entry.unique_id)
        if not target or registry_entry.entity_id == target:
            continue
        existing = registry.async_get(target)
        if existing and existing.unique_id != registry_entry.unique_id:
            _LOGGER.warning(
                "Cannot rename %s to %s: that entity ID is already taken by %s. "
                "Rename or remove it and reload the integration, otherwise the "
                "QWeather card may not find this sensor",
                registry_entry.entity_id,
                target,
                existing.entity_id,
            )
            continue
        try:
            registry.async_update_entity(registry_entry.entity_id, new_entity_id=target)
        except ValueError as err:
            _LOGGER.warning("Could not rename %s to %s: %s", registry_entry.entity_id, target, err)
            continue
        _LOGGER.info("Migrated %s -> %s", registry_entry.entity_id, target)


async def async_unload_entry(hass: HomeAssistant, entry: QWeatherConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _update_listener(hass: HomeAssistant, entry: QWeatherConfigEntry) -> None:
    """Reload the entry when its options change."""
    await hass.config_entries.async_reload(entry.entry_id)
