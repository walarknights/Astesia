import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { KNOWN_STORAGE_KEYS } from '@/services/storage-keys';

const STORAGE_INDEX_KEY = 'astesia-secure-storage-index';
const STORAGE_MIGRATION_KEY = 'astesia-secure-storage-migrated';
const AUTH_STORAGE_MIGRATION_KEY = 'astesia-auth-secure-storage-migrated';
const AUTH_IDENTITY_STORAGE_KEYS = ['userToken', 'userId'] as const;

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

    if (hasMigrated !== '1') {
      await migrateStorageKeys(KNOWN_STORAGE_KEYS);
      await secureStore.setItemAsync(STORAGE_MIGRATION_KEY, '1');
    }

    const hasMigratedAuthIdentity = await secureStore.getItemAsync(AUTH_STORAGE_MIGRATION_KEY);

    if (hasMigratedAuthIdentity !== '1') {
      // [变更] 修改前: token 由业务代码持续从 AsyncStorage 回退读取，迁移完成后仍可能保留明文副本
      // [变更] 修改后: 原生端一次性迁移登录凭证到 SecureStore，并删除 AsyncStorage 中的遗留值
      // [原因] 防止绕过系统安全存储直接读取登录 token
      await migrateStorageKeys([...AUTH_IDENTITY_STORAGE_KEYS], { preserveSecureValue: true });
      await secureStore.setItemAsync(AUTH_STORAGE_MIGRATION_KEY, '1');
    }
  } catch {
    // Keep reads/writes available even if migration fails on a specific device.
  }
}

/**
 * 将指定 AsyncStorage 数据迁移到原生 SecureStore，并移除原明文副本。
 *
 * @param keys - 需要迁移的存储键
 * @param options - 是否保留 SecureStore 中已经存在的值
 * @returns Promise<void>
 * @example
 *   await migrateStorageKeys(['userToken'], { preserveSecureValue: true })
 */
async function migrateStorageKeys(
  keys: readonly string[],
  options: { preserveSecureValue?: boolean } = {}
) {
  if (!secureStore) {
    return;
  }

  const legacyPairs = await AsyncStorage.multiGet([...keys]);
  const pairsToMigrate = legacyPairs.filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );

  if (pairsToMigrate.length === 0) {
    return;
  }

  await Promise.all(
    pairsToMigrate.map(async ([key, value]) => {
      const secureValue = options.preserveSecureValue
        ? await secureStore.getItemAsync(key)
        : null;

      if (!secureValue) {
        await secureStore.setItemAsync(key, value);
      }
    })
  );

  const indexedKeys = await getIndexedKeys();
  await setIndexedKeys(Array.from(
    new Set([...indexedKeys, ...pairsToMigrate.map(([key]) => key)])
  ));
  await AsyncStorage.multiRemove(pairsToMigrate.map(([key]) => key));
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
