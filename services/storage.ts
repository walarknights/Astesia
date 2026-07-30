import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { KNOWN_STORAGE_KEYS } from '@/services/storage-keys';

const STORAGE_INDEX_KEY = 'astesia-secure-storage-index';
const AUTH_STORAGE_MIGRATION_KEY = 'astesia-auth-secure-storage-migrated';
const ASYNC_STORAGE_MIGRATION_KEY = 'astesia-async-storage-migrated';
const AUTH_IDENTITY_STORAGE_KEYS = ['userToken', 'userId'] as const;
const SECURE_STORAGE_KEYS = new Set<string>(AUTH_IDENTITY_STORAGE_KEYS);

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
    const hasMigratedAsyncData = await secureStore.getItemAsync(ASYNC_STORAGE_MIGRATION_KEY);

    if (hasMigratedAsyncData !== '1') {
      await migrateAsyncStorageKeysFromSecureStore();
      await secureStore.setItemAsync(ASYNC_STORAGE_MIGRATION_KEY, '1');
    }
  } catch {
    // Keep reads/writes available even if business data migration fails on a specific device.
  }

  try {
    const hasMigratedAuthIdentity = await secureStore.getItemAsync(AUTH_STORAGE_MIGRATION_KEY);

    if (hasMigratedAuthIdentity !== '1') {
      // [变更] 修改前: token 由业务代码持续从 AsyncStorage 回退读取，迁移完成后仍可能保留明文副本
      // [变更] 修改后: 原生端一次性迁移登录凭证到 SecureStore，并删除 AsyncStorage 中的遗留值
      // [原因] 防止绕过系统安全存储直接读取登录 token
      await migrateSecureStorageKeysFromAsyncStorage([...AUTH_IDENTITY_STORAGE_KEYS], { preserveSecureValue: true });
      await secureStore.setItemAsync(AUTH_STORAGE_MIGRATION_KEY, '1');
    }
  } catch {
    // Auth migration failure should not prevent the app from opening.
  }
}

/**
 * 将登录凭证从 AsyncStorage 迁移到原生 SecureStore，并移除原明文副本。
 *
 * @param keys - 需要迁移的安全存储键
 * @param options - 是否保留 SecureStore 中已经存在的值
 * @returns Promise<void>
 * @example
 *   await migrateSecureStorageKeysFromAsyncStorage(['userToken'], { preserveSecureValue: true })
 */
async function migrateSecureStorageKeysFromAsyncStorage(
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

/**
 * 将历史版本写入 SecureStore 的用户配置与业务数据迁回 AsyncStorage。
 *
 * @returns Promise<void>
 * @example
 *   await migrateAsyncStorageKeysFromSecureStore()
 */
async function migrateAsyncStorageKeysFromSecureStore() {
  if (!secureStore) {
    return;
  }

  const indexedKeys = await getIndexedKeys();
  const candidateKeys = Array.from(new Set([...KNOWN_STORAGE_KEYS, ...indexedKeys]))
    .filter((key) => !shouldUseSecureStorageKey(key) && !isInternalSecureStoreKey(key));

  if (candidateKeys.length === 0) {
    return;
  }

  const migratedKeys = await Promise.all(
    candidateKeys.map(async (key) => {
      try {
        const secureValue = await secureStore.getItemAsync(key);

        if (typeof secureValue !== 'string') {
          return null;
        }

        const asyncValue = await AsyncStorage.getItem(key);

        if (typeof asyncValue !== 'string') {
          await AsyncStorage.setItem(key, secureValue);
        }

        await secureStore.deleteItemAsync(key);
        return key;
      } catch {
        return null;
      }
    })
  );

  await removeIndexedKeys(migratedKeys.filter((key): key is string => typeof key === 'string'));
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

function shouldUseSecureStorageKey(key: string) {
  return SECURE_STORAGE_KEYS.has(key);
}

function isInternalSecureStoreKey(key: string) {
  return key === STORAGE_INDEX_KEY
    || key === AUTH_STORAGE_MIGRATION_KEY
    || key === ASYNC_STORAGE_MIGRATION_KEY;
}

async function removeLegacySecureItem(key: string) {
  if (!secureStore) {
    return;
  }

  try {
    await secureStore.deleteItemAsync(key);
    await removeIndexedKeys([key]);
  } catch {
    // AsyncStorage remains the source of truth for non-sensitive user data.
  }
}

async function readLegacySecureItem(key: string) {
  if (!secureStore) {
    return null;
  }

  try {
    return normalizeItemValue(await secureStore.getItemAsync(key));
  } catch {
    return null;
  }
}

async function getItem(key: string) {
  if (!secureStore || !shouldUseSecureStorageKey(key)) {
    if (secureStore) {
      await ensureInitialized();
    }

    const asyncValue = await AsyncStorage.getItem(key);

    if (asyncValue !== null || !secureStore) {
      return asyncValue;
    }

    const legacySecureValue = await readLegacySecureItem(key);

    if (legacySecureValue !== null) {
      await AsyncStorage.setItem(key, legacySecureValue);
      await removeLegacySecureItem(key);
    }

    return legacySecureValue;
  }

  await ensureInitialized();
  return normalizeItemValue(await secureStore.getItemAsync(key));
}

async function setItem(key: string, value: string) {
  if (!secureStore || !shouldUseSecureStorageKey(key)) {
    if (secureStore) {
      await ensureInitialized();
    }

    // [变更] 修改前: 原生端所有用户配置和业务数据都会落入 SecureStore，超过 2KB 时可能保存失败
    // [变更] 修改后: 仅登录凭证使用 SecureStore，其他本地数据统一写入 AsyncStorage
    // [原因] SecureStore 适合小型敏感值，AsyncStorage 更适合大体积用户配置与缓存
    await AsyncStorage.setItem(key, value);
    await removeLegacySecureItem(key);
    return;
  }

  await ensureInitialized();
  await secureStore.setItemAsync(key, value);
  await addIndexedKey(key);
  await AsyncStorage.removeItem(key);
}

async function removeItem(key: string) {
  if (!secureStore || !shouldUseSecureStorageKey(key)) {
    if (secureStore) {
      await ensureInitialized();
    }

    await AsyncStorage.removeItem(key);
    await removeLegacySecureItem(key);
    return;
  }

  await ensureInitialized();
  await secureStore.deleteItemAsync(key);
  await removeIndexedKeys([key]);
  await AsyncStorage.removeItem(key);
}

async function getAllKeys() {
  if (!secureStore) {
    return AsyncStorage.getAllKeys();
  }

  await ensureInitialized();
  const [asyncKeys, secureKeys] = await Promise.all([
    AsyncStorage.getAllKeys(),
    getIndexedKeys(),
  ]);

  return Array.from(new Set([...asyncKeys, ...secureKeys]));
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
