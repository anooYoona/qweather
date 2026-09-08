/**
 * 和风天气专属全能卡片 (QWeather Card) - 官方原生 UI 风格定制版
 * 深度遵循 Home Assistant 官方设计规范 (Material Design 3 & Lovelace Theme)
 * 功能特性：
 * 1. 实时天气看板 (天气状况、体感温度、实时气温与紧贴下方的今日最高/最低温)
 * 2. 官方 Tile 风格 6 大物理环境指标网格 (湿度、气压、风速、空气质量、灾害预警、生活穿衣)
 * 3. 未来 24 小时平滑贝塞尔气温曲线与降水柱状图 (原生矢量 SVG 渲染)
 * 4. 未来 5 天逐日天气预报 (星期、日期、天气图标、状况及高低温)
 */
(() => {
  if (customElements.get('qweather-card')) {
    return;
  }

  const TRANSLATIONS = {
  zh: {
    feels_like: '体感',
    outdoor_humidity: '室外湿度',
    barometric_pressure: '大气压强',
    wind_speed: '实时风速',
    air_quality: '空气质量',
    air_quality_need_api: '需API权限',
    air_quality_403: '空气质量 (403)',
    weather_warning: '气象预警',
    normal_no_warning: '正常 (无预警)',
    life_index: '生活穿衣',
    normal: '舒适',
    forecast_loading: '⏳ 逐日天气预报数据载入中...',
    use_relative_days: true,
    today: '今天',
    tomorrow: '明天',
    day_after_tomorrow: '后天',
    weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    chart_title: '未来 24 小时气温与降雨趋势',
    chart_loading: '⏳ 24小时气温与降雨预测数据载入中...',
    temp: '气温',
    scale: '标尺',
    air_drawer_title: '实时空气质量详情',
    primary_pollutant: '首要污染物',
    warning_drawer_title: '气象灾害预警详情',
    warning_safe_title: '当前暂无突发气象预警',
    warning_safe_desc: '气象安全平稳，未检测到暴雨、雷电、大风等官方灾害警报',
    warning_default_title: '官方气象预警',
    warning_default_type: '预警',
    warning_default_text: '请密切留意天气变化并做好应急防御措施。',
    warning_published: '发布',
    indices_drawer_title: '生活指数详细建议',
    indices_loading: '⏳ 暂无生活指数详细建议数据',
    entity_details: '⚙️ 实体详情',
    entity_details_tooltip: '点击查看该传感器原生实体详情与历史走势',
    station_default: '和风气象台',
  },
  en: {
    feels_like: 'Feels like',
    outdoor_humidity: 'Humidity',
    barometric_pressure: 'Pressure',
    wind_speed: 'Wind Speed',
    air_quality: 'Air Quality',
    air_quality_need_api: 'Auth Required',
    air_quality_403: 'Air Quality (403)',
    weather_warning: 'Weather Alerts',
    normal_no_warning: 'Normal (No alerts)',
    life_index: 'Life Index',
    normal: 'Comfortable',
    forecast_loading: '⏳ Loading daily forecast data...',
    use_relative_days: false,
    today: 'Today',
    tomorrow: 'Tomorrow',
    day_after_tomorrow: 'In 2 Days',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    chart_title: '24-Hour Temp & Rain Trend',
    chart_loading: '⏳ Loading 24h temp & rain forecast data...',
    temp: 'Temp',
    scale: 'Scale',
    air_drawer_title: 'Air Quality Details',
    primary_pollutant: 'Primary Pollutant',
    warning_drawer_title: 'Weather Alerts Details',
    warning_safe_title: 'No Active Weather Alerts',
    warning_safe_desc: 'Conditions are safe and stable. No severe weather warnings active.',
    warning_default_title: 'Weather Alert',
    warning_default_type: 'Alert',
    warning_default_text: 'Please monitor local weather updates and take precautions.',
    warning_published: 'Issued',
    indices_drawer_title: 'Life Indices & Recommendations',
    indices_loading: '⏳ No life indices recommendations available',
    entity_details: '⚙️ Entity Details',
    entity_details_tooltip: 'Click to view native sensor entity details and history',
    station_default: 'QWeather Station',
  },
};

// Format a Home Assistant state or attribute that may be missing.
// Returns null for null/undefined/''/'unknown'/'unavailable' and for anything
// else that is not a number, so callers can fall back with `?? '--'`.
const fmtNum = (raw, fmt) => {
  const value = parseFloat(raw);
  return raw == null || raw === '' || isNaN(value) ? null : fmt(value);
};

const FORECAST_DAY_CHOICES = [3, 5, 7];
const DEFAULT_FORECAST_DAYS = 5;

const COMPASS_ORDER = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                       'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

const COMPASS = {
  N:   { zh: '北',     en: 'N' },
  NNE: { zh: '北东北', en: 'NNE' },
  NE:  { zh: '东北',   en: 'NE' },
  ENE: { zh: '东东北', en: 'ENE' },
  E:   { zh: '东',     en: 'E' },
  ESE: { zh: '东东南', en: 'ESE' },
  SE:  { zh: '东南',   en: 'SE' },
  SSE: { zh: '南东南', en: 'SSE' },
  S:   { zh: '南',     en: 'S' },
  SSW: { zh: '南西南', en: 'SSW' },
  SW:  { zh: '西南',   en: 'SW' },
  WSW: { zh: '西西南', en: 'WSW' },
  W:   { zh: '西',     en: 'W' },
  WNW: { zh: '西西北', en: 'WNW' },
  NW:  { zh: '西北',   en: 'NW' },
  NNW: { zh: '北西北', en: 'NNW' },
};

// Everything keyed by Home Assistant condition slug: display text, icon, colour.
const CONDITION_I18N = {
  'sunny': { zh: '晴', en: 'Sunny', icon: 'mdi:weather-sunny', color: 'var(--warning-color, #ff9800)' },
  'clear-night': { zh: '晴朗夜间', en: 'Clear Night', icon: 'mdi:weather-night', color: '#5c6bc0' },
  'cloudy': { zh: '阴', en: 'Cloudy', icon: 'mdi:weather-cloudy', color: '#78909c' },
  'partlycloudy': { zh: '多云', en: 'Partly Cloudy', icon: 'mdi:weather-partly-cloudy', color: '#ffa726' },
  'rainy': { zh: '雨', en: 'Rainy', icon: 'mdi:weather-rainy', color: 'var(--info-color, #2196f3)' },
  'pouring': { zh: '暴雨', en: 'Pouring', icon: 'mdi:weather-pouring', color: '#1565c0' },
  'lightning-rainy': { zh: '雷阵雨', en: 'Thunderstorm', icon: 'mdi:weather-lightning-rainy', color: '#ab47bc' },
  'snowy': { zh: '雪', en: 'Snowy', icon: 'mdi:weather-snowy', color: '#00bcd4' },
  'snowy-rainy': { zh: '雨夹雪', en: 'Sleet', icon: 'mdi:weather-snowy-rainy', color: '#0097a7' },
  'fog': { zh: '雾', en: 'Foggy', icon: 'mdi:weather-fog', color: '#9e9e9e' },
  'windy': { zh: '大风', en: 'Windy', icon: 'mdi:weather-windy', color: '#009688' },
  'hail': { zh: '冰雹', en: 'Hail', icon: 'mdi:weather-hail', color: '#00838f' },
  'exceptional': { zh: '异常', en: 'Exceptional', icon: 'mdi:alert-circle-outline', color: '#e91e63' },
};

class QWeatherCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._forecastDaily = null;
    this._subscribedDaily = false;
    this._activeDrawer = null;
    this._handleClick = this._handleClick.bind(this);
    this.shadowRoot.addEventListener('click', this._handleClick);
  }

  _handleClick(ev) {
    const path = ev.composedPath();

    // 检查是否点击了带展开抽屉的磁贴 (空气质量、气象灾害预警、生活穿衣)
    const toggleTarget = path.find(
      (el) => el instanceof HTMLElement && el.dataset && el.dataset.action && el.dataset.action.startsWith('toggle-')
    );
    if (toggleTarget) {
      ev.stopPropagation();
      const drawerName = toggleTarget.dataset.action.replace('toggle-', '');
      this._activeDrawer = this._activeDrawer === drawerName ? null : drawerName;
      this.render();
      return;
    }

    const target = path.find(
      (el) => el instanceof HTMLElement && el.dataset && el.dataset.entityId
    );
    if (target && target.dataset.entityId) {
      ev.stopPropagation();
      this._openMoreInfo(target.dataset.entityId);
    }
  }

  _openMoreInfo(entityId) {
    if (!entityId || !this._hass) return;
    const event = new CustomEvent('hass-more-info', {
      bubbles: true,
      composed: true,
      detail: { entityId },
    });    this.dispatchEvent(event);  }

  static getConfigElement() {
    return document.createElement('qweather-card-editor');  }

  static getStubConfig() {
    return {
      type: 'custom:qweather-card',
      entity: '',
      forecast_days: DEFAULT_FORECAST_DAYS,
    };
  }

  setConfig(config) {
    this._config = {
      ...config,
    };
    this.render();  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) {
      this._config = {};
    }

    if (!this._config.entity && hass && hass.states) {
      const weatherState = this._getWeatherState(null);
      if (weatherState) {
        this._config.entity = weatherState.entity_id;
      }
    }

    const weatherEntityId = this._config.entity || this._getWeatherState(null)?.entity_id;
    if (hass && hass.connection && weatherEntityId && !this._subscribedDaily) {
      this._subscribedDaily = true;
      try {
        hass.connection.subscribeMessage(
          (msg) => {
            if (msg && msg.forecast) {
              this._forecastDaily = msg.forecast;
              this.render();
            }
          },
          {
            type: 'weather/subscribe_forecast',
            forecast_type: 'daily',
            entity_id: weatherEntityId,
          }
        ).catch(() => {
          this._subscribedDaily = false;
        });
      } catch (e) {
        this._subscribedDaily = false;
      }
    }

    this.render();
  }

  getCardSize() {
    return 6;
  }

  _getWeatherState(entityId) {
    if (!this._hass || !this._hass.states) return null;
    if (entityId && this._hass.states[entityId]) {
      return this._hass.states[entityId];
    }
    if (this._hass.states['weather.qweather']) {
      return this._hass.states['weather.qweather'];
    }
    const match = Object.keys(this._hass.states).find(
      (k) => k.startsWith('weather.') && k.includes('qweather')
    ) || Object.keys(this._hass.states).find((k) => k.startsWith('weather.'));
    return match ? this._hass.states[match] : null;
  }

  _getSensorState(suffix) {
    if (!this._hass || !this._hass.states) return null;
    const states = this._hass.states;

    // The integration pins these entity IDs, so this is the path taken.
    const canonical = states[`sensor.qweather_${suffix}`];
    if (canonical) return canonical;

    // Fallback for a user who renamed the entity but kept `qweather` in the ID.
    const match = Object.keys(states).find(
      (k) =>
        k.startsWith('sensor.') &&
        k.includes('qweather') &&
        (k.endsWith(`_${suffix}`) || k.endsWith(suffix) || k.includes(suffix))
    );
    return match ? states[match] : null;
  }

  _getSensorEntityId(suffix) {
    const st = this._getSensorState(suffix);
    if (st && st.entity_id) return st.entity_id;
    return `sensor.qweather_${suffix}`;
  }

  // 16-point compass, keyed by the abbreviation the backend reports.
  // How many forecast columns to show. Configurable in the card editor
  // because the daily endpoint always returns seven days regardless.
  _forecastDays() {
    const configured = parseInt(this._config?.forecast_days, 10);
    return FORECAST_DAY_CHOICES.includes(configured) ? configured : DEFAULT_FORECAST_DAYS;
  }

  _getWindDirection(nowSensor, weather, lang = 'zh') {
    const raw = nowSensor?.attributes?.windDir;
    let code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';

    // Fall back to the weather entity's bearing in degrees.
    if (!COMPASS[code]) {
      const bearing = weather?.attributes?.wind_bearing;
      if (bearing !== undefined && bearing !== null && !isNaN(parseFloat(bearing))) {
        const idx = Math.round((((parseFloat(bearing) % 360) + 360) % 360) / 22.5) % 16;
        code = COMPASS_ORDER[idx];
      }
    }

    if (COMPASS[code]) return COMPASS[code][lang] || code;
    // Anything else (e.g. a localised name like 东北风) is shown as-is.
    return typeof raw === 'string' ? raw.trim() : '';
  }

  _getWeatherIcon(condition) {
    return CONDITION_I18N[condition]?.icon || 'mdi:weather-cloudy';
  }

  _getIconColor(condition) {
    return CONDITION_I18N[condition]?.color || 'var(--primary-color, #ff9800)';
  }

  _getLanguage() {
    const configured = this._config?.language;
    if (configured === 'zh' || configured === 'en') return configured;

    // 优先读取后端传感器返回的当前数据语言
    const nowSensor = this._getSensorState('now');
    const backendLang = nowSensor?.attributes?.language;
    if (backendLang === 'zh' || backendLang === 'en') return backendLang;

    // 跟随 Home Assistant 系统全局语言
    const haLang = (this._hass?.language || 'zh').toLowerCase();
    return haLang.startsWith('zh') ? 'zh' : 'en';
  }

  _getConditionName(condOrText, lang = 'zh') {
    if (!condOrText) return lang === 'en' ? 'Sunny' : '晴';
    const text = String(condOrText).trim();
    const lower = text.toLowerCase();

    // 1. Direct match in standard conditions
    if (CONDITION_I18N[lower]) {
      return CONDITION_I18N[lower][lang] || text;
    }

    // 2. Keyword identification
    let standardKey = null;
    if (text.includes('雷') || lower.includes('thunder') || lower.includes('lightning')) {
      standardKey = 'lightning-rainy';
    } else if (text.includes('特大暴雨') || text.includes('大暴雨') || text.includes('暴雨') || lower.includes('pouring') || lower.includes('heavy rain') || lower.includes('storm')) {
      standardKey = 'pouring';
    } else if (text.includes('雨夹雪') || lower.includes('sleet')) {
      standardKey = 'snowy-rainy';
    } else if (text.includes('雨') || lower.includes('rain') || lower.includes('drizzle') || lower.includes('shower')) {
      standardKey = 'rainy';
    } else if (text.includes('雪') || lower.includes('snow') || lower.includes('blizzard') || lower.includes('flurry')) {
      standardKey = 'snowy';
    } else if (text.includes('阴') || lower.includes('overcast')) {
      standardKey = 'cloudy';
    } else if (text.includes('多云') || text.includes('少云') || lower.includes('partly') || lower.includes('cloudy')) {
      standardKey = 'partlycloudy';
    } else if (text.includes('晴') || lower.includes('sunny') || lower.includes('clear')) {
      standardKey = (lower.includes('night') || text.includes('夜')) ? 'clear-night' : 'sunny';
    } else if (text.includes('雾') || text.includes('霾') || lower.includes('fog') || lower.includes('haze') || lower.includes('mist')) {
      standardKey = 'fog';
    } else if (text.includes('风') || text.includes('沙') || lower.includes('wind') || lower.includes('dust') || lower.includes('sand')) {
      standardKey = 'windy';
    } else if (text.includes('雹') || lower.includes('hail')) {
      standardKey = 'hail';
    }

    if (standardKey && CONDITION_I18N[standardKey]) {
      return CONDITION_I18N[standardKey][lang];
    }

    return text;
  }

  _translateAirCategory(cat, lang = 'zh') {
    if (!cat) return '';
    const text = String(cat).trim();
    const lower = text.toLowerCase();
    if (lang === 'en') {
      if (text.includes('优')) return 'Good';
      if (text.includes('良')) return 'Moderate';
      if (text.includes('轻度')) return 'Unhealthy (Mild)';
      if (text.includes('中度')) return 'Unhealthy';
      if (text.includes('重度')) return 'Very Unhealthy';
      if (text.includes('严重')) return 'Hazardous';
      return text;
    }
    if (lang === 'zh') {
      if (lower.includes('good') || lower.includes('excellent')) return '优';
      if (lower.includes('moderate')) return '良';
      if (lower.includes('mild') || lower.includes('sensitive')) return '轻度污染';
      if (lower.includes('very unhealthy')) return '重度污染';
      if (lower.includes('unhealthy')) return '中度污染';
      if (lower.includes('hazardous')) return '严重污染';
      return text;
    }
    return text;
  }

  _translatePrimaryPollutant(pri, lang = 'zh') {
    if (!pri || pri === 'NA' || pri === 'None' || pri === '无') {
      return lang === 'en' ? 'None' : '无';
    }
    const text = String(pri).trim();
    if (lang === 'en') {
      if (text.includes('颗粒物') || text.includes('PM2.5')) return 'PM2.5';
      if (text.includes('PM10')) return 'PM10';
      if (text.includes('臭氧')) return 'O₃ Ozone';
      if (text.includes('二氧化氮')) return 'NO₂ Nitrogen Dioxide';
      if (text.includes('二氧化硫')) return 'SO₂ Sulfur Dioxide';
      if (text.includes('一氧化碳')) return 'CO Carbon Monoxide';
      return text;
    }
    if (lang === 'zh') {
      if (text.toLowerCase().includes('ozone')) return 'O₃ 臭氧';
      if (text.toLowerCase().includes('nitrogen')) return 'NO₂ 二氧化氮';
      if (text.toLowerCase().includes('sulfur')) return 'SO₂ 二氧化硫';
      if (text.toLowerCase().includes('carbon')) return 'CO 一氧化碳';
      return text;
    }
    return text;
  }

  _translateAlertLevel(level, lang = 'zh') {
    if (!level) return lang === 'en' ? 'Notice' : '提示';
    const text = String(level).trim();
    const lower = text.toLowerCase();
    if (lang === 'en') {
      if (text.includes('蓝')) return 'Blue';
      if (text.includes('黄')) return 'Yellow';
      if (text.includes('橙')) return 'Orange';
      if (text.includes('红')) return 'Red';
      if (text.includes('白')) return 'White';
      return text;
    }
    if (lang === 'zh') {
      if (lower.includes('blue')) return '蓝色';
      if (lower.includes('yellow')) return '黄色';
      if (lower.includes('orange')) return '橙色';
      if (lower.includes('red')) return '红色';
      if (lower.includes('white')) return '白色';
      return text;
    }
    return text;
  }

  _translateIndexCategory(category, lang = 'zh') {
    if (!category) return '';
    const text = String(category).trim();
    const lower = text.toLowerCase();

    if (lang === 'en') {
      const map = {
        '舒适': 'Comfortable',
        '较舒适': 'Fairly Comfortable',
        '不舒适': 'Uncomfortable',
        '适宜': 'Suitable',
        '较适宜': 'Fairly Suitable',
        '较不宜': 'Less Suitable',
        '较不适宜': 'Less Suitable',
        '不宜': 'Unsuitable',
        '不适宜': 'Unsuitable',
        '极不适宜': 'Very Unsuitable',
        '热': 'Hot',
        '较热': 'Warm',
        '极热': 'Very Hot',
        '冷': 'Cold',
        '较冷': 'Cool',
        '极冷': 'Freezing',
        '弱': 'Weak',
        '最弱': 'Minimal',
        '中等': 'Moderate',
        '强': 'Strong',
        '极强': 'Very Strong',
        '少发': 'Low Risk',
        '较易发': 'Moderate Risk',
        '易发': 'High Risk',
        '极易发': 'Very High Risk',
      };
      return map[text] || text;
    }

    if (lang === 'zh') {
      const reverseMap = {
        'comfortable': '舒适',
        'fairly comfortable': '较舒适',
        'uncomfortable': '不舒适',
        'suitable': '适宜',
        'fairly suitable': '较适宜',
        'less suitable': '较不宜',
        'unsuitable': '不适宜',
        'very unsuitable': '极不适宜',
        'hot': '热',
        'warm': '较热/温暖',
        'cold': '冷',
        'cool': '凉爽',
        'freezing': '极冷',
        'weak': '弱',
        'moderate': '中等',
        'strong': '强',
        'low risk': '少发',
        'moderate risk': '较易发',
        'high risk': '易发',
        'very high risk': '极易发',
      };
      return reverseMap[lower] || text;
    }

    return text;
  }

  _translateIndexDesc(rawName, category, desc) {
    const raw = String(rawName || '').toLowerCase();
    const cat = String(category || '').toLowerCase();

    if (raw.includes('穿衣') || raw.includes('cloth')) {
      if (cat.includes('cold') || cat.includes('cool') || cat.includes('chilly') || cat.includes('冷') || cat.includes('凉')) {
        return 'Cool weather. Warm clothing such as jackets, coats, or sweaters recommended.';
      }
      if (cat.includes('comfort') || cat.includes('舒适')) {
        return 'Comfortable temperatures. Shirts, light jackets, or long sleeves recommended.';
      }
      if (cat.includes('warm') || cat.includes('breezy') || cat.includes('温')) {
        return 'Pleasant weather. Light clothing with an extra layer recommended.';
      }
      if (cat.includes('hot') || cat.includes('muggy') || cat.includes('热')) {
        return 'Hot weather. Breathable, light summer clothing recommended.';
      }
      return 'Dress comfortably according to current local conditions.';
    }

    if (raw.includes('洗车') || raw.includes('car') || raw.includes('wash')) {
      if (cat.includes('ideal') || cat.includes('suitable') || cat.includes('适宜')) {
        return 'Great weather for washing your car. No rain expected soon.';
      }
      if (cat.includes('less') || cat.includes('不宜')) {
        return 'Less suitable for car washing. Weather conditions may dirty your car soon.';
      }
      return 'Car wash conditions are favorable.';
    }

    if (raw.includes('运动') || raw.includes('sport')) {
      if (cat.includes('ideal') || cat.includes('suitable') || cat.includes('适宜')) {
        return 'Weather conditions are great for outdoor sports and activities.';
      }
      if (cat.includes('less') || cat.includes('不宜')) {
        return 'Weather conditions are less favorable for outdoor sports. Indoor exercise recommended.';
      }
      return 'Outdoor activities are suitable under current weather conditions.';
    }

    if (raw.includes('紫外线') || raw.includes('uv')) {
      if (cat.includes('weak') || cat.includes('弱')) {
        return 'Low UV levels. Minimal sun protection required.';
      }
      if (cat.includes('moderate') || cat.includes('中等')) {
        return 'Moderate UV levels. Sunscreen, sunglasses, and hat recommended when outdoors.';
      }
      if (cat.includes('strong') || cat.includes('extreme') || cat.includes('强')) {
        return 'High UV levels. Seek shade, wear UV-blocking clothing and SPF sunscreen.';
      }
      return 'UV radiation is present. Take standard sun protection precautions.';
    }

    if (raw.includes('感冒') || raw.includes('cold') || raw.includes('flu')) {
      if (cat.includes('low') || cat.includes('少发')) {
        return 'Low risk of catching a cold. Stay hydrated and well-rested.';
      }
      return 'Increased risk of catching a cold. Keep warm and avoid abrupt temperature changes.';
    }

    return `${category || 'Normal'} conditions. Please check local advice.`;
  }

  _resolveIndexMeta(rawName, lang = 'zh') {
    const raw = String(rawName).trim();
    const lower = raw.toLowerCase();

    let icon = 'mdi:information-outline';
    let iconBg = 'rgba(92, 107, 192, 0.12)';
    let iconColor = '#5c6bc0';
    let name = raw;

    if (raw.includes('穿衣') || lower.includes('cloth')) {
      icon = 'mdi:tshirt-crew-outline';
      iconBg = 'rgba(171, 71, 188, 0.12)';
      iconColor = '#ab47bc';
      name = lang === 'en' ? 'Clothing' : '穿衣指数';
    } else if (raw.includes('洗车') || lower.includes('car') || lower.includes('wash')) {
      icon = 'mdi:car-wash';
      iconBg = 'rgba(33, 150, 243, 0.12)';
      iconColor = '#2196f3';
      name = lang === 'en' ? 'Car Wash' : '洗车指数';
    } else if (raw.includes('紫外线') || lower.includes('uv') || lower.includes('ultraviolet')) {
      icon = 'mdi:weather-sunny-alert';
      iconBg = 'rgba(255, 152, 0, 0.12)';
      iconColor = '#ff9800';
      name = lang === 'en' ? 'UV Index' : '紫外线指数';
    } else if (raw.includes('运动') || lower.includes('sport')) {
      icon = 'mdi:run';
      iconBg = 'rgba(76, 175, 80, 0.12)';
      iconColor = '#4caf50';
      name = lang === 'en' ? 'Sports' : '运动指数';
    } else if (raw.includes('感冒') || lower.includes('cold') || lower.includes('flu')) {
      icon = 'mdi:pill';
      iconBg = 'rgba(233, 30, 99, 0.12)';
      iconColor = '#e91e63';
      name = lang === 'en' ? 'Cold & Flu' : '感冒指数';
    } else if (raw.includes('舒适') || lower.includes('comfort')) {
      icon = 'mdi:emoticon-happy-outline';
      iconBg = 'rgba(0, 150, 136, 0.12)';
      iconColor = '#009688';
      name = lang === 'en' ? 'Comfort' : '舒适度指数';
    } else if (raw.includes('晾晒') || lower.includes('dry')) {
      icon = 'mdi:weather-sunny';
      iconBg = 'rgba(255, 179, 0, 0.12)';
      iconColor = '#ffb300';
      name = lang === 'en' ? 'Drying' : '晾晒指数';
    } else if (raw.includes('雨伞') || raw.includes('伞') || lower.includes('umbrella')) {
      icon = 'mdi:umbrella';
      iconBg = 'rgba(3, 169, 244, 0.12)';
      iconColor = '#03a9f4';
      name = lang === 'en' ? 'Umbrella' : '雨伞指数';
    } else if (raw.includes('交通') || lower.includes('traffic')) {
      icon = 'mdi:car';
      iconBg = 'rgba(96, 125, 139, 0.12)';
      iconColor = '#607d8b';
      name = lang === 'en' ? 'Traffic' : '交通指数';
    } else if (raw.includes('空调') || lower.includes('air condition')) {
      icon = 'mdi:air-conditioner';
      iconBg = 'rgba(0, 188, 212, 0.12)';
      iconColor = '#00bcd4';
      name = lang === 'en' ? 'Air Conditioning' : '空调指数';
    } else if (raw.includes('过敏') || lower.includes('allergy')) {
      icon = 'mdi:flower-pollen';
      iconBg = 'rgba(224, 64, 251, 0.12)';
      iconColor = '#e040fb';
      name = lang === 'en' ? 'Allergy' : '过敏指数';
    } else if (raw.includes('太阳镜') || lower.includes('sunglass')) {
      icon = 'mdi:sunglasses';
      iconBg = 'rgba(255, 87, 34, 0.12)';
      iconColor = '#ff5722';
      name = lang === 'en' ? 'Sunglasses' : '太阳镜指数';
    } else if (raw.includes('晨练') || lower.includes('exercise')) {
      icon = 'mdi:walk';
      iconBg = 'rgba(139, 195, 74, 0.12)';
      iconColor = '#8bc34a';
      name = lang === 'en' ? 'Exercise' : '晨练指数';
    } else if (raw.includes('钓鱼') || lower.includes('fish')) {
      icon = 'mdi:fish';
      iconBg = 'rgba(0, 172, 193, 0.12)';
      iconColor = '#00acc1';
      name = lang === 'en' ? 'Fishing' : '钓鱼指数';
    }

    return { name, icon, iconBg, iconColor };
  }

  _getDailyForecast(lang = 'zh') {
    if (this._forecastDaily && Array.isArray(this._forecastDaily) && this._forecastDaily.length > 0) {
      return this._mapHaForecast(this._forecastDaily, lang);
    }
    const forecastSensor = this._getSensorState('forecast');
    if (forecastSensor?.attributes?.daily && Array.isArray(forecastSensor.attributes.daily) && forecastSensor.attributes.daily.length > 0) {
      return this._mapQWeatherForecast(forecastSensor.attributes.daily, lang);
    }
    if (this._hass && this._hass.states) {
      const anyDailySensor = Object.values(this._hass.states).find(
        (st) => st.entity_id.startsWith('sensor.') && Array.isArray(st.attributes?.daily) && st.attributes.daily.length > 0
      );
      if (anyDailySensor) {
        return this._mapQWeatherForecast(anyDailySensor.attributes.daily, lang);
      }
    }
    const weather = this._getWeatherState(this._config.entity);
    if (weather?.attributes?.forecast && Array.isArray(weather.attributes.forecast) && weather.attributes.forecast.length > 0) {
      return this._mapHaForecast(weather.attributes.forecast, lang);
    }
    return [];
  }

  _mapHaForecast(list, lang = 'zh') {
    return list.map((item) => {
      const rawDate = item.datetime || item.date || item.fxDate;
      const rawHigh = item.temperature !== undefined ? item.temperature : item.native_temperature;
      const rawLow = item.templow !== undefined ? item.templow : item.native_templow;
      const cond = item.condition || 'sunny';
      return {
        dateStr: rawDate,
        high: (rawHigh !== undefined && rawHigh !== null && !isNaN(parseFloat(rawHigh))) ? Math.round(parseFloat(rawHigh)) : '--',
        low: (rawLow !== undefined && rawLow !== null && !isNaN(parseFloat(rawLow))) ? Math.round(parseFloat(rawLow)) : '--',
        condition: cond,
        conditionText: this._getConditionName(cond, lang),
        icon: this._getWeatherIcon(cond),
      };
    });
  }

  _mapQWeatherIconToCondition(iconCode, text = '') {
    const code = String(iconCode || '').trim();
    const map = {
      '100': 'sunny',
      '150': 'clear-night',
      '101': 'partlycloudy',
      '102': 'partlycloudy',
      '103': 'partlycloudy',
      '151': 'partlycloudy',
      '152': 'partlycloudy',
      '153': 'partlycloudy',
      '104': 'cloudy',
      '300': 'rainy',
      '301': 'rainy',
      '302': 'lightning-rainy',
      '303': 'lightning-rainy',
      '304': 'hail',
      '305': 'rainy',
      '306': 'rainy',
      '307': 'rainy',
      '308': 'pouring',
      '309': 'rainy',
      '310': 'pouring',
      '311': 'pouring',
      '312': 'pouring',
      '313': 'rainy',
      '314': 'rainy',
      '315': 'rainy',
      '316': 'pouring',
      '317': 'pouring',
      '318': 'pouring',
      '399': 'rainy',
      '400': 'snowy',
      '401': 'snowy',
      '402': 'snowy',
      '403': 'snowy',
      '404': 'snowy-rainy',
      '405': 'snowy-rainy',
      '406': 'snowy-rainy',
      '407': 'snowy',
      '408': 'snowy',
      '409': 'snowy',
      '410': 'snowy',
      '499': 'snowy',
      '500': 'fog',
      '501': 'fog',
      '502': 'fog',
      '503': 'windy',
      '504': 'windy',
      '507': 'windy',
      '508': 'windy',
      '509': 'fog',
      '510': 'fog',
      '511': 'fog',
      '512': 'fog',
      '513': 'fog',
      '514': 'fog',
      '515': 'fog',
      '900': 'sunny',
      '901': 'snowy',
      '999': 'exceptional',
    };
    if (map[code]) return map[code];

    const t = String(text || '').toLowerCase();
    if (t.includes('雷') || t.includes('thunder') || t.includes('lightning')) return 'lightning-rainy';
    if (t.includes('暴雨') || t.includes('pouring') || t.includes('storm')) return 'pouring';
    if (t.includes('雨夹雪') || t.includes('sleet')) return 'snowy-rainy';
    if (t.includes('雨') || t.includes('rain')) return 'rainy';
    if (t.includes('雪') || t.includes('snow')) return 'snowy';
    if (t.includes('阴') || t.includes('overcast')) return 'cloudy';
    if (t.includes('多云') || t.includes('cloud')) return 'partlycloudy';
    if (t.includes('晴') || t.includes('sun') || t.includes('clear')) return 'sunny';
    if (t.includes('雾') || t.includes('霾') || t.includes('fog')) return 'fog';
    if (t.includes('风') || t.includes('wind')) return 'windy';
    return 'sunny';
  }

  _mapQWeatherForecast(list, lang = 'zh') {
    return list.map((item) => {
      const rawDate = item.fxDate || item.date || item.datetime;
      const cond = this._mapQWeatherIconToCondition(item.iconDay || item.icon, item.textDay || item.condition);
      const rawHigh = item.tempMax !== undefined ? item.tempMax : (item.temperature !== undefined ? item.temperature : item.native_temperature);
      const rawLow = item.tempMin !== undefined ? item.tempMin : (item.templow !== undefined ? item.templow : item.native_templow);
      const high = (rawHigh !== undefined && rawHigh !== null && !isNaN(parseFloat(rawHigh))) ? Math.round(parseFloat(rawHigh)) : '--';
      const low = (rawLow !== undefined && rawLow !== null && !isNaN(parseFloat(rawLow))) ? Math.round(parseFloat(rawLow)) : '--';
      return {
        dateStr: rawDate,
        high,
        low,
        condition: cond,
        conditionText: this._getConditionName(item.textDay || item.text || cond, lang),
        icon: this._getWeatherIcon(cond),
      };
    });
  }

  _formatDayAndDate(dateStr, index, lang = 'zh') {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    if (!dateStr) {
      const fallbackDays = lang === 'en'
        ? ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']
        : ['今天', '明天', '后天', '第4天', '第5天', '第6天', '第7天'];
      return { dayLabel: fallbackDays[index] || `+${index}d`, dateLabel: '--' };
    }

    let dateObj;
    if (typeof dateStr === 'string' && dateStr.includes('-')) {
      const parts = dateStr.split('T')[0].split('-');
      if (parts.length === 3) {
        dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        dateObj = new Date(dateStr);
      }
    } else {
      dateObj = new Date(dateStr);
    }

    // Relative labels are only used where they stay as short as a weekday
    // abbreviation. "Tomorrow" overflows a forecast column, so English uses
    // weekday names throughout and marks today with `is-today` instead.
    let dayLabel = t.weekdays[dateObj.getDay()];
    if (t.use_relative_days) {
      if (index === 0) dayLabel = t.today;
      else if (index === 1) dayLabel = t.tomorrow;
      else if (index === 2) dayLabel = t.day_after_tomorrow;
    }

    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const dateLabel = `${month}/${day}`;

    return { dayLabel, dateLabel };
  }

  render() {
    if (!this.shadowRoot || !this._config) return;

    try {
      this._renderCard();
    } catch (err) {
      console.error('QWeatherCard render error:', err);
      this.shadowRoot.innerHTML = `
        <ha-card style="padding: 16px; color: var(--error-color, #f44336); background: var(--card-background-color, #fff); border-radius: var(--ha-card-border-radius, 12px);">
          <div style="font-weight: 600; margin-bottom: 6px;">⚠️ 和风天气卡片状态提示 (Notice)</div>
          <div style="font-size: 13px; color: var(--secondary-text-color, #666); margin-bottom: 8px;">气象数据更新中或等待初始化：</div>
          <div style="font-size: 11.5px; font-family: monospace; background: rgba(0,0,0,0.05); padding: 8px; border-radius: 6px; word-break: break-all;">${err.message || err}</div>
        </ha-card>
      `;
    }
  }

  _renderCard() {
    const lang = this._getLanguage();
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;

    const weather = this._getWeatherState(this._config.entity);
    const nowSensor = this._getSensorState('now');
    const hourlySensor = this._getSensorState('hourly');
    const airSensor = this._getSensorState('air');
    const warningSensor = this._getSensorState('warning');
    const humiditySensor = this._getSensorState('humidity');
    const pressureSensor = this._getSensorState('pressure');
    const windSensor = this._getSensorState('wind_speed');
    const indicesSensor = this._getSensorState('indices');

    const temp = fmtNum(weather?.attributes?.temperature, (v) => v)
      ?? fmtNum(nowSensor?.attributes?.temp, (v) => v)
      ?? '--';
    const condition = weather ? weather.state : (nowSensor?.state || 'sunny');
    const conditionText = this._getConditionName(nowSensor?.state || condition, lang);
    const icon = this._getWeatherIcon(condition);
    const mainIconColor = this._getIconColor(condition);

    // 提取并优雅格式化 6 大环境物理指标
    const humRaw = humiditySensor?.state ?? weather?.attributes?.humidity;
    const humidity = fmtNum(humRaw, (v) => `${Math.round(v)}%`) ?? '--';

    const pressRaw = pressureSensor?.state ?? weather?.attributes?.pressure;
    const pressure = fmtNum(pressRaw, (v) => `${Math.round(v)} hPa`) ?? '--';

    const windRaw = windSensor?.state ?? weather?.attributes?.wind_speed;
    const windDir = this._getWindDirection(nowSensor, weather, lang);
    const windSpeed = fmtNum(
      windRaw,
      (v) => `${v.toFixed(1)} km/h${windDir ? ` ${windDir}` : ''}`
    ) ?? '--';

    // 空气质量状态处理与 403 优雅提示
    const airRaw = airSensor ? airSensor.state : '--';
    let airDisplay;
    let airLabel = t.air_quality;
    if (!airSensor || airRaw === 'unknown' || airRaw === 'unavailable' || airRaw === '--') {
      airDisplay = t.air_quality_need_api;
      airLabel = t.air_quality_403;
    } else {
      airDisplay = this._translateAirCategory(airRaw, lang);
    }

    // 预警与生活指数
    let warningVal = warningSensor?.state && warningSensor.state !== 'unknown' ? warningSensor.state : t.normal_no_warning;
    // Only rewrite the quiet state when the backend and card languages
    // disagree; when they match, show the backend string as-is.
    const quietZh = warningVal.includes('正常') || warningVal.includes('无预警');
    const quietEn = warningVal.includes('Normal') || warningVal.includes('No alerts');
    if ((quietZh && lang === 'en') || (quietEn && lang === 'zh')) {
      warningVal = t.normal_no_warning;
    }

    let indicesVal = indicesSensor?.state && indicesSensor.state !== 'unknown' ? indicesSensor.state : t.normal;
    if (indicesVal === '正常' || indicesVal === 'Normal') {
      indicesVal = t.normal;
    } else {
      indicesVal = this._translateIndexCategory(indicesVal, lang);
    }

    const title = this._config.title || weather?.attributes?.friendly_name || t.station_default;
    const hourlyData = hourlySensor?.attributes?.hourly || [];

    // 解析各模块对应的精确实体 ID (用于点击弹窗)
    const weatherEntityId = this._config.entity || (this._hass?.states?.['weather.qweather'] ? 'weather.qweather' : null);
    const nowEntityId = this._getSensorEntityId('now');
    const humEntityId = this._getSensorEntityId('humidity');
    const pressEntityId = this._getSensorEntityId('pressure');
    const windEntityId = this._getSensorEntityId('wind_speed');
    const airEntityId = this._getSensorEntityId('air');
    const warningEntityId = this._getSensorEntityId('warning');
    const indicesEntityId = this._getSensorEntityId('indices');
    const hourlyEntityId = this._getSensorEntityId('hourly') || weatherEntityId;
    const forecastEntityId = this._getSensorEntityId('forecast') || weatherEntityId;

    // 获取逐日天气预报 (包含今日最高最低温与未来5天)
    const dailyForecast = this._getDailyForecast(lang);
    // 气温下方的今日最高与最低温显示
    let todayHighLowHtml = '';
    if (dailyForecast.length > 0) {
      const today = dailyForecast[0];
      if (today.high !== '--' || today.low !== '--') {
        todayHighLowHtml = `
          <div class="temp-high-low">
            <span class="high-tag">↑ ${today.high}°</span>
            <span class="sep">/</span>
            <span class="low-tag">↓ ${today.low}°</span>
          </div>
        `;
      }
    }

    // 主天气左侧的副标题 (优先展示体感温度)
    const feelsLikeRaw = nowSensor?.attributes?.feelsLike ?? weather?.attributes?.apparent_temperature;
    const feelsLikeText = fmtNum(feelsLikeRaw, (v) => `${t.feels_like} ${Math.round(v)}°C`)
      ?? (lang === 'en' ? 'Outdoor' : '今日室外');

    const tipWeather = lang === 'en' ? 'Click to view weather details' : '点击查看天气详情与预报';
    const tipTrend = lang === 'en' ? 'Click to view history and trends' : '点击查看详情与趋势';
    const tipAir = lang === 'en' ? 'Click to expand/collapse air quality details' : '点击展开/收起空气质量与细分污染物详情';
    const tipWarning = lang === 'en' ? 'Click to expand/collapse weather warning details' : '点击展开/收起气象灾害预警与防御指南';
    const tipIndices = lang === 'en' ? 'Click to expand/collapse life index details' : '点击展开/收起生活指数详细建议';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          padding: 16px;
          border-radius: var(--ha-card-border-radius, 12px);          box-shadow: var(--ha-card-box-shadow, none);          border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));          background: var(--ha-card-background, var(--card-background-color, #fff));          color: var(--primary-text-color, #212121);          font-family: var(--paper-font-common-base_-_font-family, Roboto, sans-serif);          box-sizing: border-box;
        }

        /* 可交互点击动效 */
        .clickable {
          cursor: pointer;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          transition: background-color 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease;
        }
        .clickable:hover {
          background-color: var(--state-hover-color, rgba(125, 125, 125, 0.1));        }
        .clickable:active {
          transform: scale(0.98);          background-color: var(--state-active-color, rgba(125, 125, 125, 0.18));        }

        /* 顶部卡片标题栏 */
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .header-title {
          font-size: var(--ha-card-header-font-size, 16px);          font-weight: 600;
          color: var(--primary-text-color, #212121);          letter-spacing: 0.1px;
        }

        /* 官方原生主要天气信息行 */
        .main-weather {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 8px 10px 8px;
          margin: -2px -8px 2px -8px;
          border-radius: 8px;
        }
        .weather-status {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .main-icon {
          --mdc-icon-size: 56px;
        }
        .status-text {
          display: flex;
          flex-direction: column;
        }
        .condition-title {
          font-size: 22px;
          font-weight: 500;
          color: var(--primary-text-color, #212121);          line-height: 1.2;
        }
        .sub-condition {
          font-size: 13px;
          color: var(--secondary-text-color, #727272);          margin-top: 4px;
        }

        /* 气温展示区与紧贴下方的最高最低温 */
        .temp-container {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }
        .temp-box {
          font-size: 46px;
          font-weight: 400;
          line-height: 1;
          color: var(--primary-text-color, #212121);          display: flex;
          align-items: flex-start;
        }
        .temp-unit {
          font-size: 22px;
          margin-top: 4px;
          margin-left: 2px;
          color: var(--secondary-text-color, #727272);        }
        .temp-high-low {
          font-size: 13px;
          font-weight: 500;
          color: var(--secondary-text-color, #727272);          margin-top: 5px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .temp-high-low .high-tag {
          color: var(--warning-color, #e65100);          font-weight: 600;
        }
        .temp-high-low .sep {
          opacity: 0.35;
        }
        .temp-high-low .low-tag {
          color: var(--info-color, #1976d2);          font-weight: 600;
        }

        /* 官方 Tile 规范的 6 大物理环境指标网格 (2 列布局，杜绝文本截断) */
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);          gap: 9px 12px;
          margin-top: 12px;
          padding-top: 14px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.08));        }
        .metric-tile {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: var(--ha-card-border-radius, 10px);          background: var(--secondary-background-color, rgba(128,128,128,0.06));          box-sizing: border-box;
          min-width: 0;
        }
        .metric-tile.clickable:hover {
          box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);        }
        .tile-icon-badge {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .tile-icon-badge ha-icon {
          --mdc-icon-size: 20px;
        }
        .tile-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
          overflow: hidden;
          flex: 1;
        }
        .tile-value {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--primary-text-color, #212121);          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tile-label {
          font-size: 11px;
          color: var(--secondary-text-color, #727272);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .active-tile {
          box-shadow: 0 0 0 1.5px var(--primary-color, #0288d1), 0 2px 8px rgba(0, 0, 0, 0.08) !important;
          background: var(--primary-background-color, rgba(2, 136, 209, 0.08)) !important;
        }

        /* 生活指数原地抽屉 */
        .indices-drawer {
          margin-top: 12px;
          padding: 12px 14px;
          border-radius: var(--ha-card-border-radius, 10px);
          background: var(--secondary-background-color, rgba(128, 128, 128, 0.06));
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
          animation: fadeInDown 0.22s ease-out;
        }
        @keyframes fadeInDown {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .drawer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.06));
        }
        .drawer-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color, #212121);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .drawer-title-icon {
          --mdc-icon-size: 17px;
          color: var(--warning-color, #ff9800);
        }
        .drawer-entity-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          font-size: 11.5px;
          font-weight: 500;
          border-radius: 6px;
          color: var(--primary-color, #0288d1);
          background: var(--primary-background-color, rgba(2, 136, 209, 0.08));
          border: 1px solid rgba(2, 136, 209, 0.2);
          transition: background-color 0.15s ease, transform 0.12s ease;
        }
        .drawer-entity-btn:hover {
          background: rgba(2, 136, 209, 0.18);
        }
        .drawer-entity-btn:active {
          transform: scale(0.96);
        }
        .indices-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .indices-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 8px;
          background: var(--card-background-color, rgba(255, 255, 255, 0.7));
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }
        .indices-item-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .indices-item-icon ha-icon {
          --mdc-icon-size: 18px;
        }
        .indices-item-body {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
        }
        .indices-item-top {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 3px;
        }
        .indices-item-name {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--primary-text-color, #212121);
        }
        .indices-item-cat {
          font-size: 10.5px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 4px;
        }
        .indices-item-desc {
          font-size: 11.5px;
          color: var(--secondary-text-color, #616161);
          line-height: 1.4;
        }
        .indices-empty {
          font-size: 12px;
          color: var(--secondary-text-color, #727272);
          text-align: center;
          padding: 8px 0;
        }

        /* 空气质量抽屉专有样式 */
        .air-summary-box {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          border-radius: 8px;
          background: var(--card-background-color, rgba(255, 255, 255, 0.7));
          margin-bottom: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }
        .air-aqi-group {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .air-aqi-num {
          font-size: 24px;
          font-weight: 700;
          color: var(--primary-text-color, #212121);
          line-height: 1;
        }
        .air-aqi-cat {
          font-size: 11.5px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 4px;
        }
        .air-sub-info {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          font-size: 11px;
          color: var(--secondary-text-color, #727272);
          gap: 2px;
        }
        .air-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .air-tile {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 6px 4px;
          border-radius: 7px;
          background: var(--card-background-color, rgba(255, 255, 255, 0.6));
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
        }
        .air-tile-label {
          font-size: 10px;
          color: var(--secondary-text-color, #727272);
        }
        .air-tile-val {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color, #212121);
          margin-top: 1px;
        }

        /* 气象预警抽屉专有样式 */
        .warning-safe {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          background: var(--card-background-color, rgba(255, 255, 255, 0.7));
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }
        .warning-safe-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .warning-alert-item {
          padding: 10px 12px;
          border-radius: 8px;
          background: var(--card-background-color, rgba(255, 255, 255, 0.8));
          border-left: 4px solid var(--warning-color, #ff9800);
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
        }
        .warning-alert-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .warning-alert-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color, #212121);
        }
        .warning-alert-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 4px;
          white-space: nowrap;
        }
        .warning-alert-text {
          font-size: 12px;
          color: var(--secondary-text-color, #424242);
          line-height: 1.45;
        }
        .warning-alert-time {
          font-size: 10.5px;
          color: var(--secondary-text-color, #9e9e9e);
          align-self: flex-end;
        }

        /* 官方历史图表风格：24小时气温与降雨预测 */
        .chart-section,
        .forecast-section {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid var(--divider-color, rgba(0,0,0,0.08));
        }
        .chart-section.clickable,
        .forecast-section.clickable {
          border-radius: 8px;
          padding: 8px;
          margin-left: -8px;
          margin-right: -8px;
        }
        .chart-header {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 10px;
        }
        .chart-title,
        .forecast-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--primary-text-color, #212121);
          letter-spacing: 0.1px;
        }
        .chart-legend {
          display: flex;
          align-items: center;
          gap: 16px;
          font-size: 11.5px;
          color: var(--secondary-text-color, #727272);        }
        .legend-tag {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .dot-temp {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--warning-color, #ff9800);        }
        .dot-rain {
          width: 8px;
          height: 8px;
          border-radius: 2px;
          background: var(--info-color, #2196f3);        }
        .chart-wrapper {
          width: 100%;
          overflow: hidden;
        }

        /* 官方 5 天逐日天气预报展示区 */
        .forecast-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .forecast-grid {
          display: grid;
          gap: 6px;
          width: 100%;
          box-sizing: border-box;
        }
        .forecast-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 10px 4px 8px 4px;
          border-radius: var(--ha-card-border-radius, 10px);          background: var(--secondary-background-color, rgba(128, 128, 128, 0.05));          min-width: 0;
          box-sizing: border-box;
          transition: background-color 0.18s ease;
        }
        .forecast-col:hover {
          background: var(--state-hover-color, rgba(125, 125, 125, 0.12));        }
        .forecast-day {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--primary-text-color, #212121);
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .forecast-day.is-today {
          font-weight: 700;
          color: var(--primary-color, #03a9f4);
        }
        .forecast-date {
          font-size: 10px;
          color: var(--secondary-text-color, #727272);          margin-top: 2px;
          margin-bottom: 7px;
          line-height: 1;
        }
        .forecast-icon {
          --mdc-icon-size: 28px;
          margin-bottom: 5px;
        }
        .forecast-condition {
          font-size: 11px;
          color: var(--secondary-text-color, #727272);          margin-bottom: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
          text-align: center;
        }
        .forecast-temps {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .forecast-high {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--primary-text-color, #212121);        }
        .forecast-low {
          font-size: 11.5px;
          color: var(--secondary-text-color, #727272);        }
      </style>

      <ha-card>
        <!-- 顶部卡片标题栏 -->
        <div class="card-header">
          <div class="header-title ${weatherEntityId ? 'clickable' : ''}" data-entity-id="${weatherEntityId || ''}" title="${tipWeather}">
            <span>${title}</span>
          </div>
        </div>

        <!-- 官方原生主天气展示区 -->
        <div class="main-weather clickable" data-entity-id="${weatherEntityId || nowEntityId}" title="${tipWeather}">
          <div class="weather-status">
            <ha-icon class="main-icon" icon="${icon}" style="color: ${mainIconColor};"></ha-icon>
            <div class="status-text">
              <span class="condition-title">${conditionText}</span>
              <span class="sub-condition">${feelsLikeText}</span>
            </div>
          </div>
          <div class="temp-container">
            <div class="temp-box">
              <span>${temp}</span>
              <span class="temp-unit">°C</span>
            </div>
            ${todayHighLowHtml}
          </div>
        </div>

        <!-- 官方质感未来 5 天逐日天气预报 (置于主天气下方、指标网格上方) -->
        ${this._renderDailyForecastSection(dailyForecast, forecastEntityId, weatherEntityId, lang)}

        <!-- 官方 Tile 风格 6 大环境物理指标网格 (支持点击打开实体详情弹窗) -->
        <div class="metrics-grid">
          <!-- 湿度 / 气压 / 风速：点击打开实体详情 -->
          ${this._metricTile({ icon: 'mdi:water-percent', bg: 'rgba(33, 150, 243, 0.12)', color: '#2196f3', value: humidity, label: t.outdoor_humidity, title: tipTrend, entityId: humEntityId })}
          ${this._metricTile({ icon: 'mdi:gauge', bg: 'rgba(92, 107, 192, 0.12)', color: '#5c6bc0', value: pressure, label: t.barometric_pressure, title: tipTrend, entityId: pressEntityId })}
          ${this._metricTile({ icon: 'mdi:weather-windy', bg: 'rgba(0, 150, 136, 0.12)', color: '#009688', value: windSpeed, label: t.wind_speed, title: tipTrend, entityId: windEntityId })}
          <!-- 空气质量 / 气象预警 / 生活穿衣：点击原位展开抽屉 -->
          ${this._metricTile({ icon: 'mdi:air-filter', bg: 'rgba(76, 175, 80, 0.12)', color: '#4caf50', value: airDisplay, label: airLabel, title: tipAir, drawer: 'air' })}
          ${this._metricTile({ icon: 'mdi:alert-circle-outline', bg: 'rgba(255, 152, 0, 0.12)', color: '#ff9800', value: warningVal, label: t.weather_warning, title: tipWarning, drawer: 'warning' })}
          ${this._metricTile({ icon: 'mdi:tshirt-crew-outline', bg: 'rgba(171, 71, 188, 0.12)', color: '#ab47bc', value: indicesVal, label: t.life_index, title: tipIndices, drawer: 'indices' })}
        </div>

        <!-- 原位展开抽屉 (空气质量 / 气象预警 / 生活指数) -->
        ${this._renderActiveDrawer({
          airSensor, airEntityId,
          warningSensor, warningEntityId,
          indicesSensor, indicesEntityId,
          lang,
        })}

        <!-- 官方图表质感 24 小时气温折线图与降水柱状图 -->
        ${this._renderNativeStyleChart(hourlyData, hourlyEntityId, lang)}
      </ha-card>
    `;
  }

  _renderActiveDrawer(params) {
    if (!this._activeDrawer) return '';
    if (this._activeDrawer === 'air') {
      return this._renderAirDrawer(params.airSensor, params.airEntityId, params.lang);
    }
    if (this._activeDrawer === 'warning') {
      return this._renderWarningDrawer(params.warningSensor, params.warningEntityId, params.lang);
    }
    if (this._activeDrawer === 'indices') {
      return this._renderIndicesDrawer(params.indicesSensor, params.indicesEntityId, params.lang);
    }
    return '';
  }

  // One of the six tiles in the metrics grid. Pass `entityId` for a tile that
  // opens more-info, or `drawer` for one that expands a drawer in place.
  _metricTile({ icon, bg, color, value, label, title, entityId, drawer }) {
    const open = drawer && this._activeDrawer === drawer;
    const tileAttrs = drawer
      ? `class="metric-tile clickable ${open ? 'active-tile' : ''}" data-action="toggle-${drawer}"`
      : `class="metric-tile clickable" data-entity-id="${entityId}"`;
    return `
          <div ${tileAttrs} title="${title}">
            <div class="tile-icon-badge" style="background: ${bg}; color: ${color};">
              <ha-icon icon="${icon}"></ha-icon>
            </div>
            <div class="tile-info">
              <span class="tile-value">${value}</span>
              <span class="tile-label">${label}${drawer ? ` ${open ? '▲' : '▼'}` : ''}</span>
            </div>
          </div>`;
  }

  // Shared chrome for the air / warning / indices drawers. `iconStyle` is
  // omitted rather than emitted empty, matching the indices drawer's markup.
  _drawerShell({ icon, iconStyle, title, entityId, lang, body }) {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    return `
      <div class="indices-drawer">
        <div class="drawer-header">
          <div class="drawer-title">
            <ha-icon class="drawer-title-icon" icon="${icon}"${iconStyle ? ` style="${iconStyle}"` : ''}></ha-icon>
            <span>${title}</span>
          </div>
          <div class="drawer-entity-btn clickable" data-entity-id="${entityId || ''}" title="${t.entity_details_tooltip}">
            <span>${t.entity_details}</span>
          </div>
        </div>
        ${body}
      </div>
    `;
  }

  _renderAirDrawer(airSensor, airEntityId, lang = 'zh') {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    const attrs = airSensor?.attributes || {};
    const hasAqi = attrs.aqi !== undefined && attrs.aqi !== null && attrs.aqi !== 'unknown';

    if (!hasAqi) {
      return this._drawerShell({
        icon: 'mdi:air-filter',
        iconStyle: 'color: #4caf50;',
        title: t.air_drawer_title,
        entityId: airEntityId,
        lang,
        body: `
          <div class="indices-empty" style="color: var(--warning-color, #ff9800); text-align: left; padding: 6px 4px; line-height: 1.5;">
            ⚠️ ${lang === 'en' ? 'No air quality detail data available.' : '暂无空气质量明细数据。'}<br />
            <span style="font-size: 11px; color: var(--secondary-text-color);">${lang === 'en' ? 'Note: Please ensure your QWeather API Key has permissions for Air Quality service in console.' : '注：和风天气官方 API 需确保当前 Key 拥有空气质量数据权限，可在控制台勾选开通。'}</span>
          </div>`,
      });
    }

    const aqi = attrs.aqi || '--';
    const category = this._translateAirCategory(attrs.category || '优', lang);
    const primary = this._translatePrimaryPollutant(attrs.primary, lang);
    let catBg = 'rgba(76, 175, 80, 0.15)';
    let catColor = '#4caf50';
    const catLower = (attrs.category || '').toLowerCase();
    if (catLower.includes('优') || catLower.includes('good') || catLower.includes('excellent')) {
      catBg = 'rgba(76, 175, 80, 0.15)';
      catColor = '#4caf50';
    } else if (catLower.includes('良') || catLower.includes('moderate')) {
      catBg = 'rgba(255, 193, 7, 0.18)';
      catColor = '#f57f17';
    } else if (catLower.includes('轻度') || catLower.includes('mild')) {
      catBg = 'rgba(255, 152, 0, 0.18)';
      catColor = '#ff9800';
    } else if (catLower.includes('中度') || catLower.includes('重度') || catLower.includes('unhealthy') || catLower.includes('hazardous')) {
      catBg = 'rgba(244, 67, 54, 0.18)';
      catColor = '#e53935';
    }

    let pubTimeStr = '';
    if (attrs.pubTime) {
      try {
        const d = new Date(attrs.pubTime);
        const timeVal = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        pubTimeStr = !isNaN(d.getHours()) ? (lang === 'en' ? `Updated ${timeVal}` : `${timeVal} 更新`) : '';
      } catch (e) {}
    }

    const o3Label = lang === 'en' ? 'O₃ Ozone' : 'O₃ 臭氧';
    const no2Label = lang === 'en' ? 'NO₂ Nitrogen Dioxide' : 'NO₂ 二氧化氮';
    const so2Label = lang === 'en' ? 'SO₂ Sulfur Dioxide' : 'SO₂ 二氧化硫';
    const coLabel = lang === 'en' ? 'CO Carbon Monoxide' : 'CO 一氧化碳';

    // The backend sends these unitless; the unit is appended here.
    const airTiles = [
      ['PM2.5', attrs.pm2p5, 'μg'],
      ['PM10', attrs.pm10, 'μg'],
      [o3Label, attrs.o3, 'μg'],
      [no2Label, attrs.no2, 'μg'],
      [so2Label, attrs.so2, 'μg'],
      [coLabel, attrs.co, 'mg'],
    ].map(([label, value, unit]) => `
          <div class="air-tile">
            <span class="air-tile-label">${label}</span>
            <span class="air-tile-val">${fmtNum(value, (v) => `${v} ${unit}`) ?? '--'}</span>
          </div>`).join('');

    return this._drawerShell({
      icon: 'mdi:air-filter',
      iconStyle: `color: ${catColor};`,
      title: t.air_drawer_title,
      entityId: airEntityId,
      lang,
      body: `
        <div class="air-summary-box">
          <div class="air-aqi-group">
            <span class="air-aqi-num">${aqi}</span>
            <span class="air-aqi-cat" style="background: ${catBg}; color: ${catColor};">${category}</span>
          </div>
          <div class="air-sub-info">
            <span>${t.primary_pollutant}: ${primary}</span>
            ${pubTimeStr ? `<span>${pubTimeStr}</span>` : ''}
          </div>
        </div>

        <div class="air-grid">${airTiles}
        </div>`,
    });
  }

  _renderWarningDrawer(warningSensor, warningEntityId, lang = 'zh') {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    const alerts = warningSensor?.attributes?.alerts || [];

    if (!alerts || alerts.length === 0) {
      return this._drawerShell({
        icon: 'mdi:shield-check-outline',
        iconStyle: 'color: #4caf50;',
        title: t.warning_drawer_title,
        entityId: warningEntityId,
        lang,
        body: `
          <div class="warning-safe">
            <ha-icon icon="mdi:shield-check" style="color: #4caf50; --mdc-icon-size: 28px;"></ha-icon>
            <div class="warning-safe-text">
              <span style="font-size: 13px; font-weight: 600; color: var(--primary-text-color);">${t.warning_safe_title}</span>
              <span style="font-size: 11.5px; color: var(--secondary-text-color);">${t.warning_safe_desc}</span>
            </div>
          </div>`,
      });
    }

    const alertItemsHtml = alerts.map((alert) => {
      const level = alert.level || '';
      const levelLower = level.toLowerCase();
      let badgeBg = 'rgba(255, 152, 0, 0.15)';
      let badgeColor = '#ff9800';
      let borderLeftColor = '#ff9800';

      if (level.includes('蓝') || levelLower.includes('blue')) {
        badgeBg = 'rgba(33, 150, 243, 0.15)';
        badgeColor = '#1e88e5';
        borderLeftColor = '#1e88e5';
      } else if (level.includes('黄') || levelLower.includes('yellow')) {
        badgeBg = 'rgba(255, 193, 7, 0.2)';
        badgeColor = '#f57f17';
        borderLeftColor = '#fbc02d';
      } else if (level.includes('橙') || levelLower.includes('orange')) {
        badgeBg = 'rgba(255, 152, 0, 0.2)';
        badgeColor = '#ef6c00';
        borderLeftColor = '#fb8c00';
      } else if (level.includes('红') || levelLower.includes('red')) {
        badgeBg = 'rgba(244, 67, 54, 0.2)';
        badgeColor = '#d32f2f';
        borderLeftColor = '#e53935';
      }

      let timeStr = '';
      if (alert.pubTime) {
        try {
          const d = new Date(alert.pubTime);
          if (!isNaN(d.getHours())) {
            const timeVal = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
            timeStr = lang === 'en'
              ? `${t.warning_published} on ${d.getMonth() + 1}/${d.getDate()} ${timeVal}`
              : `${d.getMonth() + 1}月${d.getDate()}日 ${timeVal} ${t.warning_published}`;
          } else {
            timeStr = alert.pubTime;
          }
        } catch (e) {
          timeStr = alert.pubTime;
        }
      }

      const alertTitle = alert.title || t.warning_default_title;
      const alertType = alert.type || t.warning_default_type;
      const alertLevel = this._translateAlertLevel(level, lang);
      const alertText = alert.text || t.warning_default_text;

      return `
        <div class="warning-alert-item" style="border-left-color: ${borderLeftColor};">
          <div class="warning-alert-header">
            <span class="warning-alert-title">${alertTitle}</span>
            <span class="warning-alert-badge" style="background: ${badgeBg}; color: ${badgeColor};">${alertType} · ${alertLevel}</span>
          </div>
          <div class="warning-alert-text">${alertText}</div>
          ${timeStr ? `<span class="warning-alert-time">${timeStr}</span>` : ''}
        </div>
      `;
    }).join('');

    const titleCount = lang === 'en'
      ? `${t.warning_drawer_title} (${alerts.length} active)`
      : `${t.warning_drawer_title} (共${alerts.length}条)`;

    return this._drawerShell({
      icon: 'mdi:alert-circle-outline',
      iconStyle: 'color: #ff9800;',
      title: titleCount,
      entityId: warningEntityId,
      lang,
      body: `
        <div style="display: flex; flex-direction: column;">
          ${alertItemsHtml}
        </div>`,
    });
  }

  _renderIndicesDrawer(indicesSensor, indicesEntityId, lang = 'zh') {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;

    const attrs = indicesSensor?.attributes || {};
    let items = [];

    if (attrs.indices && Array.isArray(attrs.indices) && attrs.indices.length > 0) {
      items = attrs.indices.map((item) => {
        const rawName = item.name || item.type || '';
        const { name, icon, iconBg, iconColor } = this._resolveIndexMeta(rawName, lang);
        let category = this._translateIndexCategory(item.category || '', lang);
        let desc = item.text || item.category || '';
        if (lang === 'en' && /[\u4e00-\u9fa5]/.test(desc)) {
          desc = this._translateIndexDesc(rawName, category, desc);
        }
        return { name, icon, iconBg, iconColor, category, desc };
      });
    } else {
      const internalKeys = ['friendly_name', 'icon', 'device_class', 'state_class', 'unit_of_measurement', 'restored', 'language', 'indices'];
      const indexEntries = Object.entries(attrs).filter(
        ([k, v]) => !internalKeys.includes(k) && !k.startsWith('_') && typeof v === 'string'
      );
      items = indexEntries.map(([rawName, val]) => {
        const { name, icon, iconBg, iconColor } = this._resolveIndexMeta(rawName, lang);
        let category = '';
        let desc = val;
        if (typeof val === 'string' && val.includes(' - ')) {
          const parts = val.split(' - ');
          category = parts[0];
          desc = parts.slice(1).join(' - ');
        } else if (typeof val === 'string' && val.includes('-')) {
          const parts = val.split('-');
          category = parts[0];
          desc = parts.slice(1).join('-');
        }
        category = this._translateIndexCategory(category, lang);
        if (lang === 'en' && /[\u4e00-\u9fa5]/.test(desc)) {
          desc = this._translateIndexDesc(rawName, category, desc);
        }
        return { name, icon, iconBg, iconColor, category, desc };
      });
    }

    if (items.length === 0) {
      return this._drawerShell({
        icon: 'mdi:lightbulb-on-outline',
        title: t.indices_drawer_title,
        entityId: indicesEntityId,
        lang,
        body: `<div class="indices-empty">${t.indices_loading}</div>`,
      });
    }

    const itemsHtml = items.map((it) => `
      <div class="indices-item">
        <div class="indices-item-icon" style="background: ${it.iconBg}; color: ${it.iconColor};">
          <ha-icon icon="${it.icon}"></ha-icon>
        </div>
        <div class="indices-item-body">
          <div class="indices-item-top">
            <span class="indices-item-name">${it.name}</span>
            ${it.category ? `<span class="indices-item-cat" style="color: ${it.iconColor}; background: ${it.iconBg};">${it.category}</span>` : ''}
          </div>
          <div class="indices-item-desc">${it.desc}</div>
        </div>
      </div>
    `).join('');

    return this._drawerShell({
      icon: 'mdi:lightbulb-on-outline',
      title: t.indices_drawer_title,
      entityId: indicesEntityId,
      lang,
      body: `
        <div class="indices-list">
          ${itemsHtml}
        </div>`,
    });
  }

  _renderNativeStyleChart(hourly, hourlyEntityId, lang = 'zh') {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    const tipChart = lang === 'en' ? 'Click to view 24-hour forecast details' : '点击查看未来预测详情';
    const emptyChart = `
        <div class="chart-section clickable" data-entity-id="${hourlyEntityId || ''}" title="${tipChart}">
          <div style="font-size: 12px; color: var(--secondary-text-color); text-align: center; padding: 14px 0;">
            ${t.chart_loading}
          </div>
        </div>
      `;
    if (!hourly || hourly.length === 0) {
      return emptyChart;
    }

    const width = 460;
    const height = 145;
    const padX = 22;
    const padY = 20;
    const chartW = width - padX * 2;

    const dataSlice = hourly.slice(0, 24);
    const validData = dataSlice.filter((d) => d && !isNaN(parseFloat(d.temp)));
    if (validData.length === 0) {
      return emptyChart;
    }

    const temps = validData.map((d) => parseFloat(d.temp));
    const precips = validData.map((d) => parseFloat(d.precip) || 0);
    const minT = Math.min(...temps) - 1;
    const maxT = Math.max(...temps) + 1;
    const rangeT = maxT - minT || 1;

    // 动态自适应计算雨量标尺刻度
    const rawMaxRain = Math.max(...precips, 0);
    let maxRainScale = 1.0;
    if (rawMaxRain <= 0) {
      maxRainScale = 1.0;
    } else if (rawMaxRain <= 0.5) {
      maxRainScale = 0.5;
    } else if (rawMaxRain <= 1.0) {
      maxRainScale = 1.0;
    } else if (rawMaxRain <= 2.0) {
      maxRainScale = 2.0;
    } else if (rawMaxRain <= 5.0) {
      maxRainScale = 5.0;
    } else if (rawMaxRain <= 10.0) {
      maxRainScale = 10.0;
    } else if (rawMaxRain <= 20.0) {
      maxRainScale = 20.0;
    } else {
      maxRainScale = Math.ceil(rawMaxRain * 1.2 / 5) * 5;
    }

    const rainBaseY = height - 18;
    const rainMaxHeight = 40;
    const rainScaleY = rainBaseY - rainMaxHeight;

    // 气温曲线映射范围
    const tempPlotTop = padY;
    const tempPlotBottom = 92;
    const tempRangeH = tempPlotBottom - tempPlotTop;

    // 计算平滑曲线坐标点
    const pts = validData.map((d, i) => {
      const x = padX + (i / Math.max(1, validData.length - 1)) * chartW;
      const y = tempPlotBottom - ((parseFloat(d.temp) - minT) / rangeT) * tempRangeH;
      return { x, y, temp: d.temp, precip: parseFloat(d.precip) || 0, time: d.fxTime };
    });
    // 绘制三次贝塞尔平滑气温曲线
    let pathD = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const cx = (p0.x + p1.x) / 2;
      pathD += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }

    const fillD = `${pathD} L ${pts[pts.length - 1].x} ${rainBaseY} L ${pts[0].x} ${rainBaseY} Z`;

    // 降水柱绘制
    let rainBars = '';
    pts.forEach((p) => {
      if (p.precip > 0) {
        const barH = Math.max(3, (p.precip / maxRainScale) * rainMaxHeight);
        const barY = rainBaseY - barH;
        rainBars += `<rect x="${p.x - 3.5}" y="${barY}" width="7" height="${barH}" rx="2" fill="var(--info-color, #2196f3)" opacity="0.55" />`;
      }
    });
    // 仅寻找 24 小时内的最大降雨峰值点标出数值
    const rainPoints = pts.filter((p) => p.precip > 0);
    const peakP = rainPoints.length > 0
      ? rainPoints.reduce((max, p) => (p.precip > max.precip ? p : max), rainPoints[0])
      : null;

    let rainLabels = '';
    if (peakP && peakP.precip > 0) {
      const barH = Math.max(3, (peakP.precip / maxRainScale) * rainMaxHeight);
      const barY = rainBaseY - barH;
      const labelY = Math.max(16, barY - 4);
      const maxPrefix = lang === 'en' ? 'Max' : '最高';
      rainLabels = `<text x="${peakP.x}" y="${labelY}" font-size="9" font-weight="600" fill="var(--info-color, #2196f3)" text-anchor="middle">${maxPrefix} ${peakP.precip}mm</text>`;
    }

    // 右侧雨量刻度线与标尺
    const scaleText = `${maxRainScale} mm/h ${t.scale}`;
    const rainScaleLine = `
      <line x1="${padX}" y1="${rainBaseY}" x2="${width - padX}" y2="${rainBaseY}" stroke="var(--divider-color, rgba(128,128,128,0.18))" stroke-width="1" />
      <line x1="${padX}" y1="${rainScaleY}" x2="${width - padX}" y2="${rainScaleY}" stroke="var(--info-color, #2196f3)" stroke-dasharray="2,3" stroke-width="0.7" opacity="0.25" />
      <text x="${width - padX}" y="${rainScaleY - 3}" font-size="8.5" fill="var(--info-color, #2196f3)" opacity="0.85" text-anchor="end">${scaleText}</text>
      <text x="${width - padX}" y="${rainBaseY - 3}" font-size="7.5" fill="var(--secondary-text-color, #727272)" opacity="0.6" text-anchor="end">0 mm</text>
    `;

    // 时间刻度轴 (每隔 4 小时标注)
    const timeLabels = pts.map((p, i) => {
      if (i % 4 !== 0 && i !== pts.length - 1) return '';
      const d = new Date(p.time);
      const hourStr = !isNaN(d.getHours()) ? `${d.getHours().toString().padStart(2, '0')}:00` : '';
      return `<text x="${p.x}" y="${height - 2}" font-size="9.5" fill="var(--secondary-text-color, #727272)" text-anchor="middle">${hourStr}</text>`;
    }).join('');
    // 关键气温标注与数据圆点
    const tempLabels = pts.map((p, i) => {
      if (i % 4 !== 0 && i !== pts.length - 1) return '';
      return `
        <circle cx="${p.x}" cy="${p.y}" r="2.5" fill="var(--warning-color, #ff9800)" />
        <text x="${p.x}" y="${p.y - 6}" font-size="10.5" font-weight="600" fill="var(--warning-color, #ff9800)" text-anchor="middle">${p.temp}°</text>
      `;
    }).join('');
    const totalRain = precips.reduce((a, b) => a + b, 0).toFixed(1);
    let rainLegendText = '';
    if (lang === 'en') {
      rainLegendText = totalRain > 0
        ? `Rain (0~${maxRainScale}mm/h, Total ${totalRain}mm)`
        : `Rain (0~${maxRainScale}mm/h, No rain)`;
    } else {
      rainLegendText = totalRain > 0
        ? `雨量 (刻度 0~${maxRainScale}mm/h，累计 ${totalRain}mm)`
        : `雨量 (刻度 0~${maxRainScale}mm/h，未来24h无雨)`;
    }

    return `
      <div class="chart-section clickable" data-entity-id="${hourlyEntityId || ''}" title="${lang === 'en' ? 'Click to view 24-hour forecast details' : '点击查看未来预测详情'}">
        <div class="chart-header">
          <div class="chart-title">${t.chart_title}</div>
          <div class="chart-legend">
            <span class="legend-tag"><span class="dot-temp"></span> ${t.temp}</span>
            <span class="legend-tag"><span class="dot-rain"></span> ${rainLegendText}</span>
          </div>
        </div>
        <div class="chart-wrapper">
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width: 100%; height: 145px; overflow: visible;">
            <defs>
              <linearGradient id="haWeatherGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--warning-color, #ff9800)" stop-opacity="0.25" />
                <stop offset="100%" stop-color="var(--warning-color, #ff9800)" stop-opacity="0.0" />
              </linearGradient>
            </defs>
            <!-- 雨量 Y 轴刻度线与指示 -->
            ${rainScaleLine}
            <!-- 降雨量柱状图 -->
            ${rainBars}
            <!-- 降雨量具体数值 -->
            ${rainLabels}
            <!-- 气温曲线区域渐变阴影 -->
            <path d="${fillD}" fill="url(#haWeatherGrad)" />
            <!-- 气温平滑折线 -->
            <path d="${pathD}" fill="none" stroke="var(--warning-color, #ff9800)" stroke-width="2.5" stroke-linecap="round" />
            <!-- 气温数字标签与数据点 -->
            ${tempLabels}
            <!-- 底部时间轴刻度 -->
            ${timeLabels}
          </svg>
        </div>
      </div>
    `;
  }

  _renderDailyForecastSection(dailyList, forecastEntityId, weatherEntityId, lang = 'zh') {
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    const dayCount = this._forecastDays();
    const emptyTitle = lang === 'en'
      ? `${dayCount}-Day Forecast`
      : `未来 ${dayCount} 天天气预报`;
    if (!dailyList || dailyList.length === 0) {
      return `
        <div class="forecast-section clickable" data-entity-id="${forecastEntityId || weatherEntityId || ''}" title="${lang === 'en' ? 'Click to view daily forecast details' : '点击查看未来天气预报详情'}">
          <div class="forecast-header">
            <span class="forecast-title">${emptyTitle}</span>
          </div>
          <div style="font-size: 12px; color: var(--secondary-text-color); text-align: center; padding: 14px 0;">
            ${t.forecast_loading}
          </div>
        </div>
      `;
    }

    const displayDays = dailyList.slice(0, this._forecastDays());
    const titleText = lang === 'en'
      ? `${displayDays.length}-Day Forecast`
      : `未来 ${displayDays.length} 天天气预报`;

    const cols = displayDays.map((item, idx) => {
      const { dayLabel, dateLabel } = this._formatDayAndDate(item.dateStr, idx, lang);
      const iconColor = this._getIconColor(item.condition);
      return `
        <div class="forecast-col">
          <span class="forecast-day${idx === 0 ? ' is-today' : ''}">${dayLabel}</span>
          <span class="forecast-date">${dateLabel}</span>
          <ha-icon class="forecast-icon" icon="${item.icon}" style="color: ${iconColor};"></ha-icon>
          <span class="forecast-condition" title="${item.conditionText}">${item.conditionText}</span>
          <div class="forecast-temps">
            <span class="forecast-high">${item.high}°</span>
            <span class="forecast-low">${item.low}°</span>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="forecast-section clickable" data-entity-id="${forecastEntityId || weatherEntityId || ''}" title="${lang === 'en' ? 'Click to view daily forecast details' : '点击查看未来天气预报详情'}">
        <div class="forecast-header">
          <span class="forecast-title">${titleText}</span>
        </div>
        <div class="forecast-grid" style="grid-template-columns: repeat(${displayDays.length}, 1fr);">
          ${cols}
        </div>
      </div>
    `;
  }
}

// 官方可视化卡片编辑器
class QWeatherCardEditor extends HTMLElement {
  constructor() {
    super();    this.attachShadow({ mode: 'open' });  }

  setConfig(config) {
    this._config = config;
    this.render();  }

  set hass(hass) {
    this._hass = hass;
    this.render();  }

  _isChinese() {
    const lang = (this._hass?.language || this._hass?.locale?.language || 'zh').toLowerCase();
    return lang.startsWith('zh');
  }

  _valueChanged(ev) {
    if (!this._config) return;
    const target = ev.target;
    const field = target.dataset.field;
    const value = target.value;

    const newConfig = {
      ...this._config,
      [field]: field === 'forecast_days' ? parseInt(value, 10) : value,
    };

    if (field === 'language' && this._hass && this._hass.callService) {
      this._hass.callService('qweather', 'set_language', { language: value })
        .catch((err) => console.debug('Sync language to backend:', err));
    }

    const event = new CustomEvent('config-changed', {
      detail: { config: newConfig },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  render() {
    if (!this.shadowRoot) return;

    const isZh = this._isChinese();

    const weatherEntities = (this._hass && this._hass.states)
      ? Object.keys(this._hass.states).filter((e) => e.startsWith('weather.'))
      : [];

    const currentEntity = this._config?.entity || (weatherEntities[0] || '');
    const currentTitle = this._config?.title || '';
    const currentLang = this._config?.language || 'auto';
    const currentDays = this._config?.forecast_days || DEFAULT_FORECAST_DAYS;

    const lblTitle = isZh ? '卡片标题 (可选)' : 'Card Title (Optional)';
    const phTitle = isZh ? '留空则自动显示城市/家庭名称' : 'Leave blank for default location name';
    const lblEntity = isZh ? '天气实体' : 'Weather Entity';
    const helpEntity = isZh
      ? '💡 和风天气专属全功能卡片，已原生整合 6 大物理环境指标、24 小时平滑温降水曲线与未来 5 天逐日天气预报。'
      : '💡 QWeather official full-featured weather card with 6 environmental metrics, 24-hour temperature & rain charts, and 5-day daily forecast.';
    const lblDays = isZh ? '天气预报天数' : 'Forecast Days';
    const helpDays = isZh
      ? '选择逐日预报显示的天数（接口始终返回 7 天，此处仅控制卡片展示）。'
      : 'How many daily forecast columns to show (the API always returns 7 days).';
    const lblLang = isZh ? '语言设置' : 'Language';
    const helpLang = isZh ? '选择卡片界面的显示语言。' : 'Select display language for the weather card.';

    const langOptions = isZh
      ? [
          { value: 'auto', label: '自动跟随系统' },
          { value: 'zh', label: '中文' },
          { value: 'en', label: 'English' },
        ]
      : [
          { value: 'auto', label: 'Auto' },
          { value: 'en', label: 'English' },
          { value: 'zh', label: '中文' },
        ];

    this.shadowRoot.innerHTML = `
      <style>
        .form-row {
          display: flex;
          flex-direction: column;
          margin-bottom: 16px;
        }
        label {
          font-weight: 500;
          font-size: 13px;
          margin-bottom: 6px;
          color: var(--primary-text-color, #212121);
        }
        select, input {
          padding: 10px 12px;
          border-radius: var(--ha-card-border-radius, 8px);
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #212121);
          font-size: 14px;
          box-sizing: border-box;
          width: 100%;
        }
        .help-text {
          font-size: 12px;
          color: var(--secondary-text-color, #727272);
          margin-top: 4px;
          line-height: 1.4;
        }
      </style>

      <div class="form-row">
        <label>${lblTitle}</label>
        <input type="text" data-field="title" value="${currentTitle}" placeholder="${phTitle}" />
      </div>

      <div class="form-row">
        <label>${lblEntity}</label>
        <select data-field="entity">
          ${weatherEntities
            .map(
              (e) =>
                `<option value="${e}" ${e === currentEntity ? 'selected' : ''}>${e}</option>`
            )
            .join('')}
        </select>
        <div class="help-text">
          ${helpEntity}
        </div>
      </div>

      <div class="form-row">
        <label>${lblDays}</label>
        <select data-field="forecast_days">
          ${FORECAST_DAY_CHOICES
            .map(
              (d) =>
                `<option value="${d}" ${Number(currentDays) === d ? 'selected' : ''}>${isZh ? d + ' 天' : d + ' days'}</option>`
            )
            .join('')}
        </select>
        <div class="help-text">
          ${helpDays}
        </div>
      </div>

      <div class="form-row">
        <label>${lblLang}</label>
        <select data-field="language">
          ${langOptions
            .map(
              (o) =>
                `<option value="${o.value}" ${currentLang === o.value ? 'selected' : ''}>${o.label}</option>`
            )
            .join('')}
        </select>
        <div class="help-text">
          ${helpLang}
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll('select, input').forEach((el) => {
      el.addEventListener('change', this._valueChanged.bind(this));
    });
  }
}

if (!customElements.get('qweather-card')) {
  customElements.define('qweather-card', QWeatherCard);
}
if (!customElements.get('qweather-card-editor')) {
  customElements.define('qweather-card-editor', QWeatherCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'qweather-card')) {
  const isZhEnv = (typeof window !== 'undefined' && window.navigator && window.navigator.language)
    ? window.navigator.language.toLowerCase().startsWith('zh')
    : true;
  window.customCards.push({
    type: 'qweather-card',
    name: isZhEnv ? '和风天气专属气象卡片' : 'QWeather Card',
    description: isZhEnv
      ? '官方原生 UI 风格，集成物理环境指标、24小时平滑温降水预测与5天逐日天气预报'
      : 'Official style weather card with 6 environmental metrics, 24h temp & rain charts, and 5-day forecast',
    preview: true,
    documentationURL: 'https://www.qweather.com',
  });
}

  // 触发 Lovelace 自动重建通知，彻底解决刷新时竞态导致的 Configuration Error
  try {
    window.dispatchEvent(new CustomEvent('ll-rebuild'));
    window.dispatchEvent(new CustomEvent('ll-custom'));
    const notifyRebuild = () => {
      const root = document.querySelector('home-assistant')?.shadowRoot
        ?.querySelector('home-assistant-main')?.shadowRoot
        ?.querySelector('ha-panel-lovelace')?.shadowRoot
        ?.querySelector('hui-root');
      if (root) {
        root.dispatchEvent(new CustomEvent('ll-rebuild', { bubbles: true, composed: true }));
      }
    };
    notifyRebuild();
    setTimeout(notifyRebuild, 300);
    setTimeout(notifyRebuild, 1000);
  } catch (e) {}
})();

