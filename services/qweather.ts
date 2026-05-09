import { AirQualitySnapshot, MinutelySnapshot,QWeatherLocation, WeatherSnapshot, QWeatherCityLookupResponse, 
QWeatherDailyResponse, QWeatherIndicesResponse, QWeatherMinutelyResponse, QWeatherNowResponse, WeatherType, 
QWeatherAlertResponse, QWeatherAirCurrentResponse, WeatherDashboard } from './type';



const QWEATHER_KEY = process.env.EXPO_PUBLIC_QWEATHER_KEY;
const API_HOST = normalizeHost(
  process.env.EXPO_PUBLIC_QWEATHER_API_HOST ?? process.env.EXPO_PUBLIC_QWEATHER_WEATHER_HOST
);
const GEO_API_HOST = normalizeHost(process.env.EXPO_PUBLIC_QWEATHER_GEO_HOST) ?? API_HOST;
const WEATHER_API_HOST = API_HOST;
const INDICES_TYPES = '1,3,5';

function normalizeHost(host?: string) {
  if (!host) {
    return undefined;
  }

  return host.startsWith('http') ? host : `https://${host}`;
}

function getRequiredApiKey() {
  if (!QWEATHER_KEY) {
    throw new Error('缺少和风天气 Key，请先在 .env 中配置 EXPO_PUBLIC_QWEATHER_KEY。');
  }

  return QWEATHER_KEY;
}

function getRequiredApiHost() {
  if (!WEATHER_API_HOST || !GEO_API_HOST) {
    throw new Error('缺少和风天气 API Host，请先在 .env 中配置 EXPO_PUBLIC_QWEATHER_API_HOST。');
  }

  return {
    weatherHost: WEATHER_API_HOST,
    geoHost: GEO_API_HOST,
  };
}

async function requestQWeather<T>(
  endpoint: string,
  params: Record<string, string>,
  host: string
): Promise<T> {
  const key = getRequiredApiKey();
  const searchParams = new URLSearchParams(params);
  const response = await fetch(`${host}${endpoint}?${searchParams.toString()}`, {
    headers: {
      'X-QW-Api-Key': key,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`天气服务请求失败（${response.status}）：${errorText}`);
  }

  return (await response.json()) as T;
}

async function requestOptionalQWeather<T>(requester: () => Promise<T>) {
  try {
    return await requester();
  } catch {
    return null;
  }
}
// 城市查询
async function lookupCity(location: string, number = 1) {
  const { geoHost } = getRequiredApiHost();
  const result = await requestQWeather<QWeatherCityLookupResponse>(
    '/geo/v2/city/lookup',
    {
      location,
      number: `${number}`,
      lang: 'zh',
      range: 'cn',
    },
    geoHost
  );

  if (result.code !== '200' || !result.location?.length) {
    throw new Error('没有找到对应的城市信息。');
  }

  return result.location.slice(0, number);
}
// 实时天气
async function getWeatherNow(location: string) {
  const { weatherHost } = getRequiredApiHost();
  const result = await requestQWeather<QWeatherNowResponse>(
    '/v7/weather/now',
    {
      location,
      lang: 'zh',
      unit: 'm',
    },
    weatherHost
  );

  if (result.code !== '200' || !result.now) {
    throw new Error('获取实时天气失败。');
  }

  return result.now;
}
// 3天天气预报
async function getWeatherDaily(location: string) {
  const { weatherHost } = getRequiredApiHost();
  const result = await requestQWeather<QWeatherDailyResponse>(
    '/v7/weather/3d',
    {
      location,
      lang: 'zh',
      unit: 'm',
    },
    weatherHost
  );

  if (result.code !== '200' || !result.daily?.length) {
    throw new Error('获取天气预报失败。');
  }

  return result.daily[0];
}
// 天气指数
async function getWeatherIndices(location: string) {
  const { weatherHost } = getRequiredApiHost();
  const result = await requestQWeather<QWeatherIndicesResponse>(
    '/v7/indices/1d',
    {
      location,
      type: INDICES_TYPES,
      lang: 'zh',
    },
    weatherHost
  );

  if (result.code !== '200') {
    throw new Error('获取天气指数失败。');
  }

  return (
    result.daily?.map((item) => ({
      name: item.name,
      category: item.category,
      text: item.text,
    })) ?? []
  );
}

// 分钟降水
async function getMinutelyPrecipitation(longitude: string, latitude: string) {
  const { weatherHost } = getRequiredApiHost();
  const result = await requestQWeather<QWeatherMinutelyResponse>(
    '/v7/minutely/5m',
    {
      location: `${longitude},${latitude}`,
      lang: 'zh',
    },
    weatherHost
  );

  if (result.code !== '200') {
    throw new Error('获取分钟降水失败。');
  }

  return {
    summary: result.summary ?? '未来两小时暂无降水数据。',
    items:
      result.minutely?.slice(0, 6).map((item) => ({
        time: formatTime(item.fxTime),
        precip: item.precip,
        type: item.type,
      })) ?? [],
  } satisfies MinutelySnapshot;
}

// 空气质量
async function getAirQuality(latitude: string, longitude: string) {
  const { weatherHost } = getRequiredApiHost();
  const result = await requestQWeather<QWeatherAirCurrentResponse>(
    `/airquality/v1/current/${latitude}/${longitude}`,
    {
      lang: 'zh',
    },
    weatherHost
  );

  const primaryIndex = result.indexes?.[0];
  if (!primaryIndex) {
    return null;
  }

  return {
    aqi: primaryIndex.aqiDisplay,
    category: primaryIndex.category ?? '暂无等级',
    primaryPollutant: primaryIndex.primaryPollutant?.name ?? '无',
    advice: primaryIndex.health?.advice?.generalPopulation ?? '当前暂无健康建议。',
    pollutants:
      result.pollutants?.slice(0, 3).map((item) => ({
        name: item.name,
        value: item.concentration
          ? `${formatNumber(item.concentration.value)} ${item.concentration.unit}`
          : '--',
      })) ?? [],
  } satisfies AirQualitySnapshot;
}

// 天气预警
async function getWeatherAlerts(latitude: string, longitude: string) {
  const { weatherHost } = getRequiredApiHost();
  const result = await requestQWeather<QWeatherAlertResponse>(
    `/weatheralert/v1/current/${latitude}/${longitude}`,
    {
      lang: 'zh',
      localTime: 'true',
    },
    weatherHost
  );

  return {
    alertAttributions: result.metadata?.attributions ?? [],
    alerts:
      result.alerts?.map((item) => ({
        id: item.id,
        headline: item.headline ?? '天气预警',
        senderName: item.senderName ?? '官方机构',
        description: item.description ?? '暂无详细描述。',
        instruction: item.instruction ?? '暂无防御指引。',
        severity: item.severity ?? 'unknown',
        colorCode: item.color?.code ?? 'gray',
      })) ?? [],
  };
}

function resolveWeatherType(icon: string, text: string): WeatherType {
  const rainyIcons = new Set([
    '300',
    '301',
    '302',
    '303',
    '304',
    '305',
    '306',
    '307',
    '308',
    '309',
    '310',
    '311',
    '312',
    '313',
    '314',
    '315',
    '316',
    '317',
    '318',
    '399',
  ]);

  if (rainyIcons.has(icon) || text.includes('雨')) {
    return 'rainy';
  }

  const sunnyIcons = new Set(['100', '150']);

  if (sunnyIcons.has(icon) || text.includes('晴')) {
    return 'sunny';
  }

  return 'cloudy';
}

function formatDateLabel(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return '今天';
  }

  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekDays[date.getDay()]}`;
}

function formatTime(dateTime: string) {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function buildSuggestion(weatherText: string, temp: string) {
  const numericTemp = Number(temp);

  if (weatherText.includes('雨')) {
    return '外出记得带伞，注意路面湿滑。';
  }

  if (!Number.isNaN(numericTemp) && numericTemp >= 30) {
    return '体感偏热，建议补水并减少暴晒。';
  }

  if (!Number.isNaN(numericTemp) && numericTemp <= 10) {
    return '天气偏凉，记得及时添衣保暖。';
  }

  return '天气舒适，适合安排今天的计划。';
}

function toSnapshot(
  location: QWeatherLocation,
  now: NonNullable<QWeatherNowResponse['now']>,
  daily: NonNullable<QWeatherDailyResponse['daily']>[number],
  sourceLabel: string
): WeatherSnapshot {
  return {
    city: location.name,
    temperature: `${now.temp}°`,
    weatherType: resolveWeatherType(now.icon, now.text),
    weatherLabel: now.text,
    dateLabel: formatDateLabel(now.obsTime),
    highLow: `最高 ${daily.tempMax}° / 最低 ${daily.tempMin}°`,
    humidity: `湿度 ${now.humidity}%`,
    wind: `${now.windDir} ${now.windScale} 级`,
    suggestion: buildSuggestion(now.text, now.temp),
    sourceLabel,
    locationId: location.id,
    latitude: Number(location.lat),
    longitude: Number(location.lon),
  };
}

async function getWeatherDashboardByLocation(location: QWeatherLocation, sourceLabel: string) {
  const [now, daily, indices, minutely, airQuality, warnings] = await Promise.all([
    getWeatherNow(location.id),
    getWeatherDaily(location.id),
    requestOptionalQWeather(() => getWeatherIndices(location.id)),
    requestOptionalQWeather(() => getMinutelyPrecipitation(location.lon, location.lat)),
    requestOptionalQWeather(() => getAirQuality(location.lat, location.lon)),
    requestOptionalQWeather(() => getWeatherAlerts(location.lat, location.lon)),
  ]);

  return {
    current: toSnapshot(location, now, daily, sourceLabel),
    airQuality,
    alerts: warnings?.alerts ?? [],
    alertAttributions: warnings?.alertAttributions ?? [],
    indices: indices ?? [],
    minutely,
  } satisfies WeatherDashboard;
}

export async function getWeatherByCityName(cityName: string) {
  const [location] = await lookupCity(cityName);
  return getWeatherDashboardByLocation(location, '手动选择');
}

export async function searchCities(keyword: string) {
  return lookupCity(keyword, 8);
}

export async function getWeatherByCoordinates(latitude: number, longitude: number) {
  const coordinate = `${longitude.toFixed(2)},${latitude.toFixed(2)}`;
  const [location] = await lookupCity(coordinate);
  return getWeatherDashboardByLocation(location, '当前位置');
}
