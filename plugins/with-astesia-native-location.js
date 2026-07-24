const fs = require('fs');
const path = require('path');
// [变更] 修改前: 直接依赖 @expo/config-plugins，EAS 云端未安装该包时会解析失败
// [变更] 修改后: 使用 expo/config-plugins 入口，由项目的 expo 依赖稳定提供
// [原因] 保证本地未提交插件在 EAS 云构建环境中也能被正常加载
const { withDangerousMod } = require('expo/config-plugins');

const MODULE_FILE_NAME = 'AstesiaLocationModule.kt';
const PACKAGE_FILE_NAME = 'AstesiaLocationPackage.kt';
const PACKAGE_REGISTRATION = 'add(AstesiaLocationPackage())';

function getAndroidPackageName(config) {
  const packageName = config.android?.package;

  if (!packageName) {
    throw new Error('Astesia native location plugin requires expo.android.package.');
  }

  return packageName;
}

function getPackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AstesiaLocationPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
      listOf(AstesiaLocationModule(reactContext))

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
`;
}

function getModuleSource(packageName) {
  return `package ${packageName}

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap

class AstesiaLocationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun getName(): String = "AstesiaNativeLocation"

  @ReactMethod
  fun getCurrentPosition(options: ReadableMap, promise: Promise) {
    if (!hasAnyLocationPermission()) {
      promise.reject("ERR_LOCATION_PERMISSION", "Android 定位权限未授予。")
      return
    }

    mainHandler.post {
      startCurrentPositionRequest(
          timeoutMs = readLongOption(options, "timeoutMs", 15000L),
          maxAgeMs = readLongOption(options, "maxAgeMs", 30 * 60 * 1000L),
          requiredAccuracyMeters = readFloatOption(options, "requiredAccuracyMeters", 50000f),
          promise = promise)
    }
  }

  private fun startCurrentPositionRequest(
      timeoutMs: Long,
      maxAgeMs: Long,
      requiredAccuracyMeters: Float,
      promise: Promise
  ) {
    val locationManager =
        reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (locationManager == null) {
      promise.reject("ERR_LOCATION_MANAGER_UNAVAILABLE", "Android 系统定位服务不可用。")
      return
    }

    if (!isLocationEnabled(locationManager)) {
      promise.reject("ERR_LOCATION_DISABLED", "系统定位服务未开启。")
      return
    }

    getBestLastKnownLocation(locationManager, maxAgeMs, requiredAccuracyMeters)?.let {
      promise.resolve(locationToMap(it, "lastKnown"))
      return
    }

    val providers = getEnabledRequestProviders(locationManager)
    if (providers.isEmpty()) {
      promise.reject("ERR_LOCATION_PROVIDER_UNAVAILABLE", "系统没有可用的 Android 定位提供方。")
      return
    }

    val listeners = mutableListOf<LocationListener>()
    var settled = false
    var bestObservedLocation: Location? = null

    fun cleanup() {
      listeners.forEach { listener ->
        try {
          locationManager.removeUpdates(listener)
        } catch (_: RuntimeException) {
          // 忽略清理阶段的系统异常，避免覆盖已经拿到的定位结果。
        }
      }
    }

    fun resolve(location: Location, source: String) {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      promise.resolve(locationToMap(location, source))
    }

    fun reject(code: String, message: String) {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      promise.reject(code, message)
    }

    val timeoutRunnable = Runnable {
      bestObservedLocation?.let {
        resolve(it, "bestObserved")
        return@Runnable
      }

      reject("ERR_LOCATION_TIMEOUT", "Android 原生定位请求超时。")
    }

    val registrationErrors = mutableListOf<Pair<String, String>>()

    providers.forEach { provider ->
      val listener =
          object : LocationListener {
            override fun onLocationChanged(location: Location) {
              bestObservedLocation = chooseBetterLocation(location, bestObservedLocation)

              if (isAccurateEnough(location, requiredAccuracyMeters)) {
                mainHandler.removeCallbacks(timeoutRunnable)
                resolve(location, provider)
              }
            }

            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

            override fun onProviderEnabled(provider: String) = Unit

            override fun onProviderDisabled(provider: String) = Unit
          }

      try {
        locationManager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
        listeners.add(listener)
      } catch (error: SecurityException) {
        registrationErrors.add(
            "ERR_LOCATION_PERMISSION" to (error.message ?: "Android 定位权限未授予。"))
      } catch (error: RuntimeException) {
        registrationErrors.add(
            "ERR_LOCATION_PROVIDER_UNAVAILABLE" to (error.message ?: "Android 定位提供方不可用。"))
      }
    }

    if (!settled && listeners.isEmpty()) {
      val firstError = registrationErrors.firstOrNull()
      reject(
          firstError?.first ?: "ERR_LOCATION_PROVIDER_UNAVAILABLE",
          firstError?.second ?: "Android 定位提供方不可用。")
      return
    }

    if (!settled) {
      mainHandler.postDelayed(timeoutRunnable, timeoutMs.coerceAtLeast(1000L))
    }
  }

  private fun getEnabledRequestProviders(locationManager: LocationManager): List<String> {
    val providers = mutableListOf<String>()

    if (hasCoarseOrFineLocationPermission() &&
        isProviderEnabled(locationManager, LocationManager.NETWORK_PROVIDER)) {
      providers.add(LocationManager.NETWORK_PROVIDER)
    }

    if (hasFineLocationPermission() &&
        isProviderEnabled(locationManager, LocationManager.GPS_PROVIDER)) {
      providers.add(LocationManager.GPS_PROVIDER)
    }

    return providers
  }

  private fun getReadableProviders(locationManager: LocationManager): List<String> {
    val providers = mutableListOf<String>()

    if (hasCoarseOrFineLocationPermission()) {
      providers.add(LocationManager.NETWORK_PROVIDER)
      providers.add(LocationManager.PASSIVE_PROVIDER)
    }

    if (hasFineLocationPermission()) {
      providers.add(LocationManager.GPS_PROVIDER)
    }

    return providers.filter { isProviderAvailable(locationManager, it) }
  }

  private fun getBestLastKnownLocation(
      locationManager: LocationManager,
      maxAgeMs: Long,
      requiredAccuracyMeters: Float
  ): Location? {
    val now = System.currentTimeMillis()

    return getReadableProviders(locationManager)
        .mapNotNull { provider ->
          try {
            locationManager.getLastKnownLocation(provider)
          } catch (_: SecurityException) {
            null
          } catch (_: RuntimeException) {
            null
          }
        }
        .filter { location ->
          now - location.time <= maxAgeMs && isAccurateEnough(location, requiredAccuracyMeters)
        }
        .fold<Location, Location?>(null) { best, location -> chooseBetterLocation(location, best) }
  }

  private fun isLocationEnabled(locationManager: LocationManager): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      return locationManager.isLocationEnabled
    }

    return isProviderEnabled(locationManager, LocationManager.NETWORK_PROVIDER) ||
        isProviderEnabled(locationManager, LocationManager.GPS_PROVIDER)
  }

  private fun isProviderEnabled(locationManager: LocationManager, provider: String): Boolean =
      try {
        locationManager.isProviderEnabled(provider)
      } catch (_: RuntimeException) {
        false
      }

  private fun isProviderAvailable(locationManager: LocationManager, provider: String): Boolean =
      try {
        locationManager.allProviders.contains(provider)
      } catch (_: RuntimeException) {
        false
      }

  private fun chooseBetterLocation(candidate: Location, current: Location?): Location {
    if (current == null) {
      return candidate
    }

    val timeDelta = candidate.time - current.time
    val candidateAccuracy = if (candidate.hasAccuracy()) candidate.accuracy else Float.MAX_VALUE
    val currentAccuracy = if (current.hasAccuracy()) current.accuracy else Float.MAX_VALUE

    if (timeDelta > 120000L) {
      return candidate
    }

    if (timeDelta < -120000L) {
      return current
    }

    if (candidateAccuracy < currentAccuracy) {
      return candidate
    }

    if (timeDelta > 0 && candidateAccuracy <= currentAccuracy + 200f) {
      return candidate
    }

    return current
  }

  private fun isAccurateEnough(location: Location, requiredAccuracyMeters: Float): Boolean =
      !location.hasAccuracy() || location.accuracy <= requiredAccuracyMeters

  private fun locationToMap(location: Location, source: String): WritableMap {
    val coords = Arguments.createMap()
    coords.putDouble("latitude", location.latitude)
    coords.putDouble("longitude", location.longitude)

    if (location.hasAccuracy()) {
      coords.putDouble("accuracy", location.accuracy.toDouble())
    } else {
      coords.putNull("accuracy")
    }

    val result = Arguments.createMap()
    result.putMap("coords", coords)
    result.putDouble("timestamp", location.time.toDouble())
    result.putString("provider", location.provider ?: "unknown")
    result.putString("source", source)
    return result
  }

  private fun hasAnyLocationPermission(): Boolean = hasCoarseOrFineLocationPermission()

  private fun hasCoarseOrFineLocationPermission(): Boolean =
      hasCoarseLocationPermission() || hasFineLocationPermission()

  private fun hasCoarseLocationPermission(): Boolean =
      reactContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
          PackageManager.PERMISSION_GRANTED

  private fun hasFineLocationPermission(): Boolean =
      reactContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
          PackageManager.PERMISSION_GRANTED

  private fun readLongOption(options: ReadableMap, key: String, fallback: Long): Long {
    if (!options.hasKey(key) || options.isNull(key)) {
      return fallback
    }

    return options.getDouble(key).toLong()
  }

  private fun readFloatOption(options: ReadableMap, key: String, fallback: Float): Float {
    if (!options.hasKey(key) || options.isNull(key)) {
      return fallback
    }

    return options.getDouble(key).toFloat()
  }
}
`;
}

function addPackageRegistration(mainApplicationSource) {
  if (mainApplicationSource.includes(PACKAGE_REGISTRATION)) {
    return mainApplicationSource;
  }

  const packageListPattern = /PackageList\(this\)\.packages\.apply\s*\{/;

  if (!packageListPattern.test(mainApplicationSource)) {
    throw new Error('Unable to find PackageList registration block in MainApplication.kt.');
  }

  return mainApplicationSource.replace(
    packageListPattern,
    (matched) => `${matched}\n              ${PACKAGE_REGISTRATION}`
  );
}

async function writeFileIfChanged(filePath, source) {
  try {
    const currentSource = await fs.promises.readFile(filePath, 'utf8');

    if (currentSource === source) {
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.promises.writeFile(filePath, source);
}

module.exports = function withAstesiaNativeLocation(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = getAndroidPackageName(config);
      const packagePath = packageName.replace(/\./g, path.sep);
      const sourceRoot = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java', packagePath);
      const mainApplicationPath = path.join(sourceRoot, 'MainApplication.kt');

      await fs.promises.mkdir(sourceRoot, { recursive: true });
      await writeFileIfChanged(path.join(sourceRoot, MODULE_FILE_NAME), getModuleSource(packageName));
      await writeFileIfChanged(path.join(sourceRoot, PACKAGE_FILE_NAME), getPackageSource(packageName));

      const mainApplicationSource = await fs.promises.readFile(mainApplicationPath, 'utf8');
      await writeFileIfChanged(mainApplicationPath, addPackageRegistration(mainApplicationSource));

      return config;
    },
  ]);
};
