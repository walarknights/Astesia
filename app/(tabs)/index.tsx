import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { setCachedWeatherDashboard } from '@/services/weather-dashboard-store';
import {
  type WeatherDashboard,
  type WeatherSnapshot,
  type WeatherType,
} from '@/services/type';
import { getWeatherByCityName, getWeatherByCoordinates } from '@/services/qweather';
import { consumePendingCitySelection } from '@/services/weather-city';
import { useAppSettings } from '@/services/app-settings';


// 占位天气数据
const PLACEHOLDER_WEATHER: WeatherSnapshot = {
  city: '天气加载中',
  temperature: '--',
  weatherType: 'cloudy',
  weatherLabel: '等待查询',
  dateLabel: '今天',
  highLow: '最高 -- / 最低 --',
  humidity: '湿度 --',
  wind: '风力 --',
  suggestion: '请稍候，正在获取实时天气数据。',
  sourceLabel: '初始化',
  locationId: 'placeholder',
  latitude: 39.90499,
  longitude: 116.40529,
};

const PLACEHOLDER_DASHBOARD: WeatherDashboard = {
  current: PLACEHOLDER_WEATHER,
  airQuality: null,
  alerts: [],
  alertAttributions: [],
  indices: [],
  minutely: null,
  dailyForecasts: [],
};


// 天气背景图片

const WEATHER_BACKGROUNDS: Record<WeatherType, string> = {
  sunny: require('../../assets/images/sunny.jpg'),
  cloudy: require('../../assets/images/cloudy.jpg'),
  rainy: require('../../assets/images/rainy.jpg'),
};


// 功能卡片
const FEATURE_CARDS = [
  {
    href: '/notes' as const,
    title: '笔记',
    description: '记录灵感，也可切换待办',
    icon: 'edit-note' as const,
    backgroundColor: '#FFF7ED',
    iconColor: '#EA580C',
  },
  {
    href: '/accounting' as const,
    title: '记账',
    description: '整理收支，查看消费节奏',
    icon: 'account-balance-wallet' as const,
    backgroundColor: '#ECFDF5',
    iconColor: '#059669',
  },
];
// 首页
export default function HomeScreen() {
  const { settings } = useAppSettings();
  const [dashboard, setDashboard] = useState<WeatherDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const displayDashboard = dashboard ?? PLACEHOLDER_DASHBOARD;
  const displayWeather = displayDashboard.current;
  const displayFeatureCards = useMemo(
    () => getDisplayFeatureCards(settings.homeLayout),
    [settings.homeLayout]
  );

  const weatherBackground = useMemo(
    () => WEATHER_BACKGROUNDS[displayWeather.weatherType],
    [displayWeather.weatherType]
  );


  // 更新缓存天气数据
  useEffect(() => {
    setCachedWeatherDashboard(displayDashboard);
  }, [displayDashboard]);

  // 初始化天气数据
  useEffect(() => {
    let cancelled = false;

    const initializeWeather = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const locationWeather = await requestLocationWeather();
        if (!cancelled) {
          setDashboard(locationWeather);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void initializeWeather();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefreshLocation = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextDashboard = await requestLocationWeather();
      setDashboard(nextDashboard);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSelectCity = useCallback(async (cityName: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextDashboard = await getWeatherByCityName(cityName);
      setDashboard(nextDashboard);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const syncPendingCity = async () => {
        const pendingCity = await consumePendingCitySelection();

        if (!pendingCity || !active) {
          return;
        }

        await handleSelectCity(pendingCity);
      };

      void syncPendingCity();

      return () => {
        active = false;
      };
    }, [handleSelectCity])
  );

  return (
    <>
      <ParallaxScrollView
        headerBackgroundColor={{ light: '#0c82eaff', dark: '#0F172A' }}
        headerImage={
          <View style={styles.weatherHero}>
            <Image
              source={weatherBackground}
              contentFit="cover"
              style={[StyleSheet.absoluteFillObject, styles.weatherBackgroundImage]}
            />
            <View style={styles.weatherOverlay} />

            <View style={styles.weatherContent}>
              <View style={styles.headerTopRow}>
                {isLoading ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
              </View>

              <View style={styles.weatherRow}>
                <View style={styles.weatherPrimary}>
                  <ThemedText style={styles.weatherDate}>{displayWeather.dateLabel}</ThemedText>
                  <Link href="/weather-search" asChild>
                    <Pressable accessibilityRole="button" style={styles.cityButton}>
                      <ThemedText style={styles.cityText}>{displayWeather.city}</ThemedText>
                      <MaterialIcons name="search" size={20} color="#FFFFFF" />
                    </Pressable>
                  </Link>
                  <ThemedText style={styles.temperatureText}>{displayWeather.temperature}</ThemedText>
                  <ThemedText style={styles.weatherLabel}>{displayWeather.weatherLabel}</ThemedText>
                </View>

                <View style={styles.weatherSecondary}>
                  <ThemedText style={styles.summaryTitle}>实时天气</ThemedText>
                  <ThemedText style={styles.summaryText}>{displayWeather.highLow}</ThemedText>
                  <ThemedText style={styles.summaryText}>{displayWeather.humidity}</ThemedText>
                  <ThemedText style={styles.summaryText}>{displayWeather.wind}</ThemedText>
                  <ThemedText style={styles.suggestionText}>{displayWeather.suggestion}</ThemedText>
                </View>
              </View>
            </View>
          </View>
        }>
        <ThemedView style={styles.contentSection}>
          <View style={styles.sectionHeaderRow}>
            <Link href="/weather-overview" asChild>
              <Pressable accessibilityRole="button" style={styles.overviewEntryCard}>
                <View style={styles.overviewEntryHeader}>
                  <View style={styles.sectionHeaderText}>
                    <ThemedText type="title" style={styles.sectionTitle}>
                      今日天气概览
                    </ThemedText>
                    <ThemedText style={styles.sectionDescription}>
                      点击进入统一查看空气质量、天气预警、生活指数和分钟降水。
                    </ThemedText>
                  </View>
                  <View style={styles.overviewArrowBadge}>
                    <MaterialIcons name="arrow-forward-ios" size={16} color="#0F766E" />
                  </View>
                </View>

              </Pressable>
            </Link>
            <Pressable onPress={() => void handleRefreshLocation()} style={styles.refreshButton}>
              <MaterialIcons name="my-location" size={18} color="#0F766E" />
              <ThemedText style={styles.refreshButtonText}>定位刷新</ThemedText>
            </Pressable>
          </View>

          {errorMessage ? (
            <View style={styles.errorBanner}>
              <MaterialIcons name="info-outline" size={18} color="#B45309" />
              <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
              <Pressable
                accessibilityLabel="关闭错误提示"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setErrorMessage(null)}
                style={styles.errorCloseButton}>
                <MaterialIcons name="close" size={18} color="#B45309" />
              </Pressable>
            </View>
          ) : null}
        </ThemedView>

        
        <View style={styles.featureList}>
          {displayFeatureCards.map((feature) => (
            <View key={feature.href} style={styles.featureCardShadow}>
              <Link href={feature.href} asChild>
                <Pressable style={[styles.featureCard, { backgroundColor: feature.backgroundColor }]}>
                  <View style={[styles.featureIconWrapper, { backgroundColor: '#FFFFFFCC' }]}>
                    <MaterialIcons name={feature.icon} size={34} color={feature.iconColor} />
                  </View>
                  <ThemedText type="subtitle" style={styles.featureTitle}>
                    {feature.title}
                  </ThemedText>
                  <ThemedText style={styles.featureDescription}>{feature.description}</ThemedText>
                </Pressable>
              </Link>
            </View>
          ))}
        </View>
      </ParallaxScrollView>
    </>
  );
}

async function requestLocationWeather() {
  const permission = await Location.requestForegroundPermissionsAsync();

  if (permission.status !== 'granted') {
    throw new Error('未获得定位权限，请先允许定位或改用手动切换城市。');
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return getWeatherByCoordinates(position.coords.latitude, position.coords.longitude);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return '获取天气失败，请稍后重试。';
}

function getDisplayFeatureCards(homeLayout: string) {
  const preferredFeature = FEATURE_CARDS.find((feature) => feature.href === `/${homeLayout}`);

  if (!preferredFeature) {
    return FEATURE_CARDS;
  }

  return [preferredFeature, ...FEATURE_CARDS.filter((feature) => feature !== preferredFeature)];
}



const styles = StyleSheet.create({
  weatherHero: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  weatherBackgroundImage: {
    height: '110%',
    width: '100%',
  },
  weatherOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  weatherContent: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  sourceBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
  },
  weatherRow: {
    flexDirection: 'row',
    gap: 16,
  },
  weatherPrimary: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  weatherSecondary: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'flex-end',
    gap: 6,
  },
  weatherDate: {
    color: '#E2E8F0',
    fontSize: 14,
    marginBottom: 10,
  },
  cityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 12,
    gap: 2,
  },
  cityText: {
    color: '#FFFFFF',
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '700',
  },
  temperatureText: {
    color: '#FFFFFF',
    fontSize: 54,
    lineHeight: 60,
    fontWeight: '700',
  },
  weatherLabel: {
    color: '#F8FAFC',
    fontSize: 16,
    lineHeight: 24,
  },
  summaryTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  summaryText: {
    color: '#E2E8F0',
    fontSize: 14,
    lineHeight: 20,
  },
  suggestionText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  contentSection: {
    gap: 12,
    borderRadius: 24,
    padding: 20,
    backgroundColor: '#F8FAFC',
  },
  sectionHeaderRow: {
    gap: 16,
  },
  sectionHeaderText: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 28,
    lineHeight: 32,
  },
  sectionDescription: {
    color: '#475569',
  },
  overviewEntryCard: {
    gap: 16,
    borderRadius: 24,
    padding: 20,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  overviewEntryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  overviewArrowBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#CCFBF1',
  },
  overviewMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  overviewMetricCard: {
    flex: 1,
    minWidth: 130,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#F8FAFC',
    gap: 4,
  },
  overviewMetricLabel: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
  },
  overviewMetricValue: {
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 22,
  },
  overviewMetricMeta: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 18,
  },
  refreshButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#CCFBF1',
  },
  refreshButtonText: {
    color: '#0F766E',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#FEF3C7',
  },
  errorText: {
    flex: 1,
    color: '#92400E',
    fontSize: 14,
    lineHeight: 20,
  },
  errorCloseButton: {
    padding: 2,
  },
  dataSection: {
    gap: 16,
  },
  dataCard: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: '#FFFFFF',
    gap: 10,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  airBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#DCFCE7',
  },
  airBadgeText: {
    color: '#166534',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  warningBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FEE2E2',
  },
  warningBadgeText: {
    color: '#B91C1C',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  cardHeadline: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardDescription: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 21,
  },
  cardFootnote: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricPill: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
    minWidth: 88,
  },
  metricLabel: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
  },
  metricValue: {
    color: '#0F172A',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  indexList: {
    gap: 12,
  },
  indexItem: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#F8FAFC',
    gap: 6,
  },
  indexTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  indexCategory: {
    color: '#7C3AED',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  precipBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 104,
  },
  precipColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  precipBar: {
    width: 20,
    borderRadius: 999,
    backgroundColor: '#60A5FA',
  },
  precipValue: {
    color: '#334155',
    fontSize: 11,
    lineHeight: 14,
  },
  precipTime: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 14,
  },
  featureList: {
    gap: 16,
    paddingHorizontal: 24,

    alignItems: 'stretch',
    borderRadius: 24,
  },
  featureCardShadow: {
    width: '100%',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    borderRadius: 28,
    padding: 20,
    backgroundColor: '#FFFFFF',
  },
  featureCard: {
    width: '100%',
    aspectRatio: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 32,
    borderRadius: 28,
  
  },
  featureIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  featureTitle: {
    marginBottom: 12,
    fontSize: 28,
    lineHeight: 30,
  },
  featureDescription: {
    color: '#334155',
    fontSize: 15,
    lineHeight: 22,
  },
});
