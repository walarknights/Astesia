import AsyncStorage from '@react-native-async-storage/async-storage';

export const CITY_OPTIONS = ['上海', '广州', '深圳'];

const RECENT_CITIES_STORAGE_KEY = 'recent-weather-cities';
const PENDING_CITY_SELECTION_STORAGE_KEY = 'pending-weather-city-selection';

export function mergeRecentCities(currentCities: string[], cityName: string) {
  const normalizedCity = cityName.trim();

  if (!normalizedCity) {
    return currentCities;
  }

  return [normalizedCity, ...currentCities.filter((item) => item !== normalizedCity)].slice(0, 3);
}

export async function loadRecentCities() {
  try {
    const storedValue = await AsyncStorage.getItem(RECENT_CITIES_STORAGE_KEY);

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
    await AsyncStorage.setItem(RECENT_CITIES_STORAGE_KEY, JSON.stringify(cities));
  } catch {
    // AsyncStorage native module may be unavailable before the client fully reloads.
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
    await AsyncStorage.setItem(PENDING_CITY_SELECTION_STORAGE_KEY, cityName.trim());
  } catch {
    // Ignore storage errors and let the caller continue to navigate back.
  }
}

export async function consumePendingCitySelection() {
  try {
    const cityName = await AsyncStorage.getItem(PENDING_CITY_SELECTION_STORAGE_KEY);

    if (!cityName) {
      return null;
    }

    await AsyncStorage.removeItem(PENDING_CITY_SELECTION_STORAGE_KEY);
    return cityName.trim() || null;
  } catch {
    return null;
  }
}
