import { NativeModules, Platform } from 'react-native';

export type AndroidNativeLocationPosition = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
  };
  provider?: string;
  source?: string;
  timestamp?: number;
};

type AndroidNativeLocationOptions = {
  timeoutMs: number;
  maxAgeMs: number;
  requiredAccuracyMeters: number;
};

type AstesiaNativeLocationModule = {
  getCurrentPosition(options: AndroidNativeLocationOptions): Promise<AndroidNativeLocationPosition>;
};

const nativeLocationModule = NativeModules.AstesiaNativeLocation as AstesiaNativeLocationModule | undefined;

/**
 * 判断当前 Android 包是否已经注册原生定位桥接。
 *
 * @returns 原生模块可用时返回 true
 * @example
 *   if (isAndroidNativeLocationAvailable()) await requestAndroidNativePosition(options)
 */
export function isAndroidNativeLocationAvailable() {
  return Platform.OS === 'android' && typeof nativeLocationModule?.getCurrentPosition === 'function';
}

/**
 * 通过 Android Framework LocationManager 读取系统定位。
 *
 * @param options - 定位超时、缓存时效与城市级精度要求
 * @returns 原生定位返回的经纬度坐标
 * @example
 *   await requestAndroidNativePosition({ timeoutMs: 15000, maxAgeMs: 1800000, requiredAccuracyMeters: 50000 })
 */
export async function requestAndroidNativePosition(options: AndroidNativeLocationOptions) {
  const module = nativeLocationModule;

  if (Platform.OS !== 'android' || typeof module?.getCurrentPosition !== 'function') {
    throw new Error('Android 原生定位模块未注册。');
  }

  const position = await module.getCurrentPosition(options);
  const latitude = Number(position?.coords?.latitude);
  const longitude = Number(position?.coords?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Android 原生定位返回了无效坐标。');
  }

  return {
    ...position,
    coords: {
      ...position.coords,
      latitude,
      longitude,
    },
  };
}
