import type { WeatherDashboard } from './type';

let cachedWeatherDashboard: WeatherDashboard | null = null;

export function getCachedWeatherDashboard() {
  return cachedWeatherDashboard;
}

export function setCachedWeatherDashboard(dashboard: WeatherDashboard) {
  cachedWeatherDashboard = dashboard;
}
