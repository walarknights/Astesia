import {
  PENDING_CITY_SELECTION_STORAGE_KEY,
  RECENT_CITIES_STORAGE_KEY,
} from '@/services/storage-keys';
import { storage } from '@/services/storage';

export const CITY_OPTIONS = ['上海', '广州', '深圳'];

export function mergeRecentCities(currentCities: string[], cityName: string) {
  const normalizedCity = cityName.trim();

  if (!normalizedCity) {
    return currentCities;
  }

  return [normalizedCity, ...currentCities.filter((item) => item !== normalizedCity)].slice(0, 3);
}

export async function loadRecentCities() {
  try {
    const storedValue = await storage.getItem(RECENT_CITIES_STORAGE_KEY);

    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function saveRecentCities(cities: string[]) {
  try {
    await storage.setItem(RECENT_CITIES_STORAGE_KEY, JSON.stringify(cities));
  } catch {
    // Ignore storage bootstrap errors during early app startup.
  }
}

export async function addRecentCity(cityName: string) {
  const currentCities = await loadRecentCities();
  const nextCities = mergeRecentCities(currentCities, cityName);

  await saveRecentCities(nextCities);
  return nextCities;
}

export async function savePendingCitySelection(cityName: string) {
  try {
    await storage.setItem(PENDING_CITY_SELECTION_STORAGE_KEY, cityName.trim());
  } catch {
    // Ignore storage errors and let the caller continue to navigate back.
  }
}

export async function consumePendingCitySelection() {
  try {
    const cityName = await storage.getItem(PENDING_CITY_SELECTION_STORAGE_KEY);

    if (!cityName) {
      return null;
    }

    await storage.removeItem(PENDING_CITY_SELECTION_STORAGE_KEY);
    return cityName.trim() || null;
  } catch {
    return null;
  }
}
