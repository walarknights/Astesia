export type WeatherType = 'sunny' | 'cloudy' | 'rainy';

export type WeatherSnapshot = {
  city: string;
  temperature: string;
  weatherType: WeatherType;
  weatherLabel: string;
  dateLabel: string;
  highLow: string;
  humidity: string;
  wind: string;
  suggestion: string;
  sourceLabel: string;
  locationId: string;
  latitude: number;
  longitude: number;
};

export type AirQualitySnapshot = {
  aqi: string;
  category: string;
  primaryPollutant: string;
  advice: string;
  pollutants: Array<{
    name: string;
    value: string;
  }>;
};

export type AlertSnapshot = {
  id: string;
  headline: string;
  senderName: string;
  description: string;
  instruction: string;
  severity: string;
  colorCode: string;
};

export type WeatherIndexSnapshot = {
  name: string;
  category: string;
  text: string;
};

export type MinutelySnapshot = {
  summary: string;
  items: Array<{
    time: string;
    precip: string;
    type: string;
  }>;
};

export type WeatherDashboard = {
  current: WeatherSnapshot;
  airQuality: AirQualitySnapshot | null;
  alerts: AlertSnapshot[];
  alertAttributions: string[];
  indices: WeatherIndexSnapshot[];
  minutely: MinutelySnapshot | null;
};

export type QWeatherLocation = {
  id: string;
  name: string;
  lat: string;
  lon: string;
  adm1: string;
  adm2: string;
};

export type QWeatherCityLookupResponse = {
  code: string;
  location?: QWeatherLocation[];
};

export type QWeatherNowResponse = {
  code: string;
  now?: {
    obsTime: string;
    temp: string;
    feelsLike: string;
    icon: string;
    text: string;
    windDir: string;
    windScale: string;
    humidity: string;
  };
};

export type QWeatherDailyResponse = {
  code: string;
  daily?: Array<{
    fxDate: string;
    tempMax: string;
    tempMin: string;
  }>;
};

export type QWeatherIndicesResponse = {
  code: string;
  daily?: Array<{
    name: string;
    category: string;
    text: string;
  }>;
};

export type QWeatherMinutelyResponse = {
  code: string;
  summary?: string;
  minutely?: Array<{
    fxTime: string;
    precip: string;
    type: string;
  }>;
};

export type QWeatherAirCurrentResponse = {
  indexes?: Array<{
    code: string;
    aqiDisplay: string;
    category?: string;
    primaryPollutant?: {
      name?: string;
    } | null;
    health?: {
      advice?: {
        generalPopulation?: string;
      };
    };
  }>;
  pollutants?: Array<{
    name: string;
    concentration?: {
      value: number;
      unit: string;
    };
  }>;
};

export type QWeatherAlertResponse = {
  metadata?: {
    zeroResult?: boolean;
    attributions?: string[];
  };
  alerts?: Array<{
    id: string;
    senderName?: string;
    severity?: string;
    headline?: string;
    description?: string;
    instruction?: string;
    color?: {
      code?: string;
    };
  }>;
};

