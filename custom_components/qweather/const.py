"""Constants for the QWeather integration."""
from __future__ import annotations

from typing import Any

from homeassistant.const import Platform

DOMAIN = "qweather"
PLATFORMS = [Platform.WEATHER, Platform.SENSOR]

CONF_API_KEY = "api_key"
CONF_API_HOST = "api_host"
CONF_LOCATION = "location"
CONF_LOCATION_NAME = "location_name"
CONF_LATITUDE = "latitude"
CONF_LONGITUDE = "longitude"

CONF_LANGUAGE = "language"

# Authentication
CONF_AUTH_METHOD = "auth_method"
CONF_JWT_PRIVATE_KEY = "jwt_private_key"
CONF_JWT_KEY_ID = "jwt_key_id"
CONF_JWT_PROJECT_ID = "jwt_project_id"

AUTH_API_KEY = "api_key"
AUTH_JWT = "jwt"
AUTH_METHODS = [AUTH_API_KEY, AUTH_JWT]

CONF_INTERVAL_NOW = "interval_now"
CONF_INTERVAL_WARNING = "interval_warning"
CONF_INTERVAL_AIR = "interval_air"
CONF_INTERVAL_FORECAST = "interval_forecast"

DEFAULT_GEOAPI_HOST = "geoapi.qweather.com"
DEFAULT_LANGUAGE = "auto"
LANGUAGES = ["auto", "zh", "en"]

DEFAULT_INTERVAL_NOW = 20        # minutes (1200s)
DEFAULT_INTERVAL_WARNING = 10    # minutes (600s)
DEFAULT_INTERVAL_AIR = 30        # minutes (1800s)
DEFAULT_INTERVAL_FORECAST = 60   # minutes (3600s)

# Life indices (/v7/indices). Selected by the user in the config/options flow;
# the selection is sent as the  query parameter, so deselecting a type
# removes it from both the request and the card's drawer.
CONF_INDICES = "indices"
DEFAULT_INDICES = ["1", "2", "3", "5"]

# type id -> (english label, chinese label)
INDEX_TYPES: dict[str, tuple[str, str]] = {
    "1": ("Sports", "运动指数"),
    "2": ("Car Wash", "洗车指数"),
    "3": ("Clothing", "穿衣指数"),
    "4": ("Fishing", "钓鱼指数"),
    "5": ("UV Index", "紫外线指数"),
    "6": ("Tourism", "旅游指数"),
    "7": ("Allergy", "过敏指数"),
    "8": ("Comfort", "舒适度指数"),
    "9": ("Cold Risk", "感冒指数"),
    "10": ("Air Pollution Dispersion", "空气污染扩散条件指数"),
    "11": ("Air Conditioning", "空调开启指数"),
    "12": ("Sunglasses", "太阳镜指数"),
    "13": ("Makeup", "化妆指数"),
    "14": ("Drying", "晾晒指数"),
    "15": ("Traffic", "交通指数"),
    "16": ("Sunscreen", "防晒指数"),
}

_CN_TIMEZONES = ("Shanghai", "Chongqing", "Harbin", "Urumqi", "Kashgar", "PRC", "Beijing")


def is_chinese_system(hass: Any, entry: Any = None) -> bool:
    """Return True when the Home Assistant environment looks Chinese.

    Used only to pick the label language for config/options flow dropdowns.
    """
    config = getattr(hass, "config", None)
    if config is not None:
        if str(getattr(config, "language", "") or "").lower().startswith("zh"):
            return True
        if str(getattr(config, "country", "") or "").upper() == "CN":
            return True
        time_zone = str(getattr(config, "time_zone", "") or "")
        if any(tz in time_zone for tz in _CN_TIMEZONES):
            return True

    data = getattr(entry, "data", None) if entry is not None else None
    if data:
        text = f"{data.get(CONF_LOCATION, '')}{data.get(CONF_LOCATION_NAME, '')}"
        return any("一" <= char <= "鿿" for char in text)

    return False

# QWeather weather icon/condition codes mapping to Home Assistant conditions
CONDITION_MAP = {
    # 晴天
    "100": "sunny",
    "150": "clear-night",
    # 多云 / 少云 / 晴间多云
    "101": "partlycloudy",
    "102": "partlycloudy",
    "103": "partlycloudy",
    "151": "partlycloudy",
    "152": "partlycloudy",
    "153": "partlycloudy",
    # 阴天
    "104": "cloudy",
    # 阵雨
    "300": "rainy",
    "301": "rainy",
    # 雷阵雨
    "302": "lightning-rainy",
    "303": "lightning-rainy",
    "304": "hail",
    # 雨
    "305": "rainy",  # 小雨
    "306": "rainy",  # 中雨
    "307": "rainy",  # 大雨
    "308": "pouring",  # 极端降雨
    "309": "rainy",  # 毛毛雨
    "310": "pouring",  # 暴雨
    "311": "pouring",  # 大暴雨
    "312": "pouring",  # 特大暴雨
    "313": "rainy",  # 冻雨
    "314": "rainy",  # 小到中雨
    "315": "rainy",  # 中到大雨
    "316": "pouring",  # 大到暴雨
    "317": "pouring",  # 暴雨到大暴雨
    "318": "pouring",  # 大暴雨到特大暴雨
    "399": "rainy",
    # 雪
    "400": "snowy",  # 小雪
    "401": "snowy",  # 中雪
    "402": "snowy",  # 大雪
    "403": "snowy",  # 暴雪
    "404": "snowy-rainy",  # 雨夹雪
    "405": "snowy-rainy",  # 雨雪天气
    "406": "snowy-rainy",  # 阵雨夹雪
    "407": "snowy",  # 阵雪
    "408": "snowy",  # 小到中雪
    "409": "snowy",  # 中到大雪
    "410": "snowy",  # 大到暴雪
    "499": "snowy",
    # 雾 / 霾 / 沙尘
    "500": "fog",  # 薄雾
    "501": "fog",  # 雾
    "502": "fog",  # 霾
    "503": "windy",  # 扬沙
    "504": "windy",  # 浮尘
    "507": "windy",  # 沙尘暴
    "508": "windy",  # 强沙尘暴
    "509": "fog",  # 浓雾
    "510": "fog",  # 强浓雾
    "511": "fog",  # 中度霾
    "512": "fog",  # 重度霾
    "513": "fog",  # 严重霾
    "514": "fog",  # 大雾
    "515": "fog",  # 特强浓雾
    # 极端
    "900": "sunny",  # 热
    "901": "snowy",  # 冷
    "999": "exceptional",  # 未知
}
