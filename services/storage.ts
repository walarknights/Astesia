import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { KNOWN_STORAGE_KEYS } from '@/services/storage-keys';

const STORAGE_INDEX_KEY = 'astesia-secure-storage-index';
const STORAGE_MIGRATION_KEY = 'astesia-secure-storage-migrated';

const secureStore = Platform.OS === 'web'
  ? null
  : SecureStore;

let initializationPromise: Promise<void> | null = null;

async function ensureInitialized() {
  if (!secureStore) {
    return;
  }

  if (!initializationPromise) {
    initializationPromise = migrateLegacyAsyncStorage();
  }

  await initializationPromise;
}

async function migrateLegacyAsyncStorage() {
  if (!secureStore) {
    return;
  }

  try {
    const hasMigrated = await secureStore.getItemAsync(STORAGE_MIGRATION_KEY);

    if (hasMigrated === '1') {
      return;
    }

    const legacyPairs = await AsyncStorage.multiGet(KNOWN_STORAGE_KEYS);
    const pairsToMigrate = legacyPairs.filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    );

    if (pairsToMigrate.length > 0) {
      await Promise.all(
        pairsToMigrate.map(([key, value]) => secureStore.setItemAsync(key, value))
      );

      const indexedKeys = await getIndexedKeys();
      const mergedKeys = Array.from(
        new Set([...indexedKeys, ...pairsToMigrate.map(([key]) => key)])
      );

      await setIndexedKeys(mergedKeys);
      await AsyncStorage.multiRemove(pairsToMigrate.map(([key]) => key));
    }

    await secureStore.setItemAsync(STORAGE_MIGRATION_KEY, '1');
  } catch {
    // Keep reads/writes available even if migration fails on a specific device.
  }
}

async function getIndexedKeys() {
  if (!secureStore) {
    return [];
  }

  try {
    const rawValue = await secureStore.getItemAsync(STORAGE_INDEX_KEY);

    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue)
      ? parsedValue.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

async function setIndexedKeys(keys: string[]) {
  if (!secureStore) {
    return;
  }

  await secureStore.setItemAsync(
    STORAGE_INDEX_KEY,
    JSON.stringify(Array.from(new Set(keys)))
  );
}

async function addIndexedKey(key: string) {
  if (!secureStore) {
    return;
  }

  const keys = await getIndexedKeys();

  if (!keys.includes(key)) {
    await setIndexedKeys([...keys, key]);
  }
}

async function removeIndexedKeys(keysToRemove: string[]) {
  if (!secureStore) {
    return;
  }

  const currentKeys = await getIndexedKeys();
  await setIndexedKeys(currentKeys.filter((key) => !keysToRemove.includes(key)));
}

function normalizeItemValue(value: string | null | undefined) {
  return typeof value === 'string' ? value : null;
}

async function getItem(key: string) {
  if (!secureStore) {
    return AsyncStorage.getItem(key);
  }

  await ensureInitialized();
  return normalizeItemValue(await secureStore.getItemAsync(key));
}

async function setItem(key: string, value: string) {
  if (!secureStore) {
    return AsyncStorage.setItem(key, value);
  }

  await ensureInitialized();
  await secureStore.setItemAsync(key, value);
  await addIndexedKey(key);
}

async function removeItem(key: string) {
  if (!secureStore) {
    return AsyncStorage.removeItem(key);
  }

  await ensureInitialized();
  await secureStore.deleteItemAsync(key);
  await removeIndexedKeys([key]);
}

async function getAllKeys() {
  if (!secureStore) {
    return AsyncStorage.getAllKeys();
  }

  await ensureInitialized();
  return getIndexedKeys();
}

async function multiGet(keys: string[]) {
  const values = await Promise.all(keys.map(async (key) => [key, await getItem(key)] as const));
  return values.map(([key, value]) => [key, value] as [string, string | null]);
}

async function multiSet(entries: [string, string][]) {
  await Promise.all(entries.map(([key, value]) => setItem(key, value)));
}

async function multiRemove(keys: string[]) {
  await Promise.all(keys.map((key) => removeItem(key)));
}

export const storage = {
  getItem,
  setItem,
  removeItem,
  getAllKeys,
  multiGet,
  multiSet,
  multiRemove,
};
