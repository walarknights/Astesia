import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { APP_SETTINGS_STORAGE_KEY } from '@/services/storage-keys';
import { storage } from '@/services/storage';

export { APP_SETTINGS_STORAGE_KEY } from '@/services/storage-keys';

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSizeMode = 'small' | 'medium' | 'large';
export type HomeLayout = 'weather' | 'notes' | 'accounting' | 'todo';
export type PersonalBackground = 'person' | 'sunny' | 'cloudy' | 'rainy';

export type AppSettings = {
  themeMode: ThemeMode;
  fontSize: FontSizeMode;
  homeLayout: HomeLayout;
  personalBackground: PersonalBackground;
  experimentalFeatures: boolean;
};

type AppSettingsContextValue = {
  settings: AppSettings;
  resolvedColorScheme: 'light' | 'dark';
  updateSettings: (settings: Partial<AppSettings>) => void;
  resetSettings: () => void;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  themeMode: 'system',
  fontSize: 'medium',
  homeLayout: 'weather',
  personalBackground: 'person',
  experimentalFeatures: false,
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: PropsWithChildren) {
  const systemColorScheme = useSystemColorScheme();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const storedSettings = await storage.getItem(APP_SETTINGS_STORAGE_KEY);

        if (!storedSettings || !isMounted) {
          return;
        }

        setSettings(normalizeSettings(JSON.parse(storedSettings)));
      } catch {
        // Invalid local settings should not block the app from opening.
      }
    };

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const updateSettings = useCallback((nextSettings: Partial<AppSettings>) => {
    setSettings((currentSettings) => {
      const updatedSettings = normalizeSettings({ ...currentSettings, ...nextSettings });

      void storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(updatedSettings));

      return updatedSettings;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
    void storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_APP_SETTINGS));
  }, []);

  const resolvedColorScheme = settings.themeMode === 'system'
    ? systemColorScheme ?? 'light'
    : settings.themeMode;

  const contextValue = useMemo(
    () => ({
      settings,
      resolvedColorScheme,
      updateSettings,
      resetSettings,
    }),
    [resolvedColorScheme, resetSettings, settings, updateSettings]
  );

  return <AppSettingsContext.Provider value={contextValue}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);

  if (!context) {
    throw new Error('useAppSettings must be used within AppSettingsProvider');
  }

  return context;
}

export function useAppColorScheme() {
  const context = useContext(AppSettingsContext);
  const systemColorScheme = useSystemColorScheme();

  return context?.resolvedColorScheme ?? systemColorScheme ?? 'light';
}

function normalizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    return DEFAULT_APP_SETTINGS;
  }

  return {
    themeMode: isThemeMode(value.themeMode) ? value.themeMode : DEFAULT_APP_SETTINGS.themeMode,
    fontSize: isFontSizeMode(value.fontSize) ? value.fontSize : DEFAULT_APP_SETTINGS.fontSize,
    homeLayout: isHomeLayout(value.homeLayout) ? value.homeLayout : DEFAULT_APP_SETTINGS.homeLayout,
    personalBackground: isPersonalBackground(value.personalBackground)
      ? value.personalBackground
      : DEFAULT_APP_SETTINGS.personalBackground,
    experimentalFeatures: typeof value.experimentalFeatures === 'boolean'
      ? value.experimentalFeatures
      : DEFAULT_APP_SETTINGS.experimentalFeatures,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isFontSizeMode(value: unknown): value is FontSizeMode {
  return value === 'small' || value === 'medium' || value === 'large';
}

function isHomeLayout(value: unknown): value is HomeLayout {
  return value === 'weather' || value === 'notes' || value === 'accounting' || value === 'todo';
}

function isPersonalBackground(value: unknown): value is PersonalBackground {
  return value === 'person' || value === 'sunny' || value === 'cloudy' || value === 'rainy';
}
