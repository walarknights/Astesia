import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppPalette } from '@/constants/theme';
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


const HOME_DARK_THEME = {
  background: AppPalette.background,
  panel: AppPalette.surfaceSoft,
  border: AppPalette.border,
  borderStrong: AppPalette.borderStrong,
  shadow: AppPalette.shadow,
  text: AppPalette.text,
  textMuted: AppPalette.textMuted,
  weatherOverlay: 'rgba(15, 15, 26, 0.48)',
  weatherPanel: 'rgba(15,15,26,0.42)',
  actionBackground: 'rgba(99, 102, 241, 0.14)',
  actionText: AppPalette.brandLight,
  featureCard: '#171723',
  featureIconBackground: '#273053',
  featureIconBorder: 'rgba(129, 140, 248, 0.28)',
  featureTagBackground: 'rgba(99, 102, 241, 0.14)',
  featureTagText: '#B8C1FF',
} as const;

const HOME_LIGHT_THEME = {
  background: '#F8FAFC',
  panel: '#FFFFFF',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',
  shadow: '#0F172A',
  text: '#0F172A',
  textMuted: '#64748B',
  weatherOverlay: 'rgba(15, 23, 42, 0.22)',
  weatherPanel: 'rgba(255,255,255,0.22)',
  actionBackground: '#EFF6FF',
  actionText: '#2563EB',
  featureCard: '#FFFFFF',
  featureIconBackground: '#EEF2FF',
  featureIconBorder: '#C7D2FE',
  featureTagBackground: '#EEF2FF',
  featureTagText: '#4338CA',
} as const;

// 功能卡片
const FEATURE_CARDS = [
  {
    href: '/notes' as const,
    title: '笔记',
    description: '基于 TipTap 的富文本编辑器，支持图文混排、实时草稿保存，灵感来了随时记录。',
    icon: 'edit-note' as const,
    iconColor: '#8B92FF',
    tags: ['富文本', '图片笔记', '草稿同步'],
  },
  {
    href: '/todo' as const,
    title: '待办',
    description: '把目标拆成清单，支持提醒时间、完成状态和待办管理，让每天的安排更清晰。',
    icon: 'checklist' as const,
    iconColor: '#8B92FF',
    tags: ['任务清单', '提醒时间', '完成追踪'],
  },
  {
    href: '/accounting' as const,
    title: '记账',
    description: '记录收入支出，查看预算、账单和资产趋势，快速掌握自己的消费节奏。',
    icon: 'account-balance-wallet' as const,
    iconColor: '#34D399',
    tags: ['收支记录', '预算统计', '资产趋势'],
  },
];
// 首页
export default function HomeScreen() {
  const { settings, resolvedColorScheme, updateSettings } = useAppSettings();
  const { width: viewportWidth } = useWindowDimensions();
  const [dashboard, setDashboard] = useState<WeatherDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isLightHomeTheme = resolvedColorScheme === 'light';
  const homeTheme = isLightHomeTheme ? HOME_LIGHT_THEME : HOME_DARK_THEME;
  const featureCardWidth = Math.min(Math.max(viewportWidth - 84, 308), 820);
  const nextThemeLabel = isLightHomeTheme ? '深色模式' : '浅色模式';
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

  const handleToggleHomeTheme = useCallback(() => {
    updateSettings({ themeMode: isLightHomeTheme ? 'dark' : 'light' });
  }, [isLightHomeTheme, updateSettings]);

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
        headerBackgroundColor={{ light: homeTheme.background, dark: homeTheme.background }}
        headerImage={
          <View style={styles.weatherHero}>
            <Image
              source={weatherBackground}
              contentFit="cover"
              style={[StyleSheet.absoluteFillObject, styles.weatherBackgroundImage]}
            />
            <View style={[styles.weatherOverlay, { backgroundColor: homeTheme.weatherOverlay }]} />

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

                <View
                  style={[
                    styles.weatherSecondary,
                    {
                      borderColor: isLightHomeTheme ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.14)',
                      backgroundColor: homeTheme.weatherPanel,
                    },
                  ]}>
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
        <ThemedView
          lightColor={homeTheme.background}
          darkColor={homeTheme.background}
          style={[styles.contentSection, { backgroundColor: homeTheme.background }]}>
          <View style={styles.sectionHeaderRow}>
            <Link href="/weather-overview" asChild>
              <Pressable
                accessibilityRole="button"
                style={StyleSheet.flatten([
                  styles.overviewEntryCard,
                  {
                    borderColor: homeTheme.border,
                    backgroundColor: homeTheme.panel,
                    shadowColor: homeTheme.shadow,
                  },
                ])}>
                <View style={styles.overviewEntryHeader}>
                  <View style={styles.sectionHeaderText}>
                    <ThemedText type="title" style={[styles.sectionTitle, { color: homeTheme.text }]}>
                      今日天气概览
                    </ThemedText>
                    <ThemedText style={[styles.sectionDescription, { color: homeTheme.textMuted }]}>
                      点击进入统一查看空气质量、天气预警、生活指数和分钟降水。
                    </ThemedText>
                  </View>
                  <View style={[styles.overviewArrowBadge, { backgroundColor: homeTheme.actionBackground }]}>
                    <MaterialIcons name="arrow-forward-ios" size={16} color={homeTheme.actionText} />
                  </View>
                </View>

              </Pressable>
            </Link>
            {/*
             * 渲染位置: 首页天气概览卡片下方
             * 展示内容: 定位刷新按钮与深浅主题切换按钮
             * 数据来源: settings.themeMode 与 handleRefreshLocation 回调
             */}
            <View style={styles.homeActionRow}>
              <Pressable
                onPress={() => void handleRefreshLocation()}
                style={[
                  styles.refreshButton,
                  {
                    borderColor: homeTheme.borderStrong,
                    backgroundColor: homeTheme.actionBackground,
                  },
                ]}>
                <MaterialIcons name="my-location" size={18} color={homeTheme.actionText} />
                <ThemedText style={[styles.refreshButtonText, { color: homeTheme.actionText }]}>
                  定位刷新
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleToggleHomeTheme}
                style={[
                  styles.refreshButton,
                  styles.themeToggleButton,
                  {
                    borderColor: homeTheme.borderStrong,
                    backgroundColor: homeTheme.actionBackground,
                  },
                ]}>
                <MaterialIcons
                  name={isLightHomeTheme ? 'dark-mode' : 'light-mode'}
                  size={18}
                  color={homeTheme.actionText}
                />
                <ThemedText style={[styles.refreshButtonText, { color: homeTheme.actionText }]}>
                  切换{nextThemeLabel}
                </ThemedText>
              </Pressable>
            </View>
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

        
        {/*
         * 渲染位置: 首页底部功能入口区域
         * 展示内容: 纵向排列的笔记、待办和记账大卡片入口及能力标签
         * 数据来源: FEATURE_CARDS 常量与首页布局偏好 settings.homeLayout
         */}
        <View style={styles.featureList}>
          <View style={styles.featureColumnContent}>
            {displayFeatureCards.map((feature) => (
              <View key={feature.href} style={[styles.featureCardShell, { width: featureCardWidth }]}>
                <Link href={feature.href} asChild>
                  <Pressable
                    style={StyleSheet.flatten([
                      styles.featureCard,
                      {
                        borderColor: homeTheme.border,
                        backgroundColor: homeTheme.featureCard,
                        shadowColor: homeTheme.shadow,
                      },
                    ])}>
                    <View
                      style={[
                        styles.featureIconWrapper,
                        {
                          borderColor: homeTheme.featureIconBorder,
                          backgroundColor: homeTheme.featureIconBackground,
                        },
                      ]}>
                      <MaterialIcons name={feature.icon} size={28} color={feature.iconColor} />
                    </View>
                    <ThemedText type="subtitle" style={[styles.featureTitle, { color: homeTheme.text }]}>
                      {feature.title}
                    </ThemedText>
                    <ThemedText style={[styles.featureDescription, { color: homeTheme.textMuted }]}>
                      {feature.description}
                    </ThemedText>
                    <View style={styles.featureTagRow}>
                      {feature.tags.map((tag) => (
                        <View
                          key={tag}
                          style={[
                            styles.featureTag,
                            {
                              borderColor: homeTheme.borderStrong,
                              backgroundColor: homeTheme.featureTagBackground,
                            },
                          ]}>
                          <ThemedText style={[styles.featureTagText, { color: homeTheme.featureTagText }]}>
                            {tag}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  </Pressable>
                </Link>
              </View>
            ))}
          </View>
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
  // [变更] 修改前: 首页正文使用浅灰底和纯白卡片
  // [变更] 修改后: 使用蓝黑底、半透明玻璃卡片和靛青强调色
  // [原因] 对齐推广页的深色沉浸感，同时保留天气图片的业务辨识度
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
    backgroundColor: 'rgba(15, 15, 26, 0.48)',
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
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(15,15,26,0.42)',
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
    backgroundColor: AppPalette.background,
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
    color: AppPalette.textMuted,
  },
  overviewEntryCard: {
    gap: 16,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 18,
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
    backgroundColor: 'rgba(99, 102, 241, 0.16)',
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
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    backgroundColor: 'rgba(99, 102, 241, 0.14)',
  },
  homeActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  themeToggleButton: {
    paddingHorizontal: 14,
  },
  refreshButtonText: {
    color: AppPalette.brandLight,
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
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
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
    marginTop: 2,
    marginHorizontal: -32,
  },
  featureColumnContent: {
    // [变更] 修改前: 使用横向 ScrollView 让三张功能卡片按 row 排列
    // [变更] 修改后: 使用 column 让三张功能卡片纵向堆叠
    // [原因] 首页功能入口需要按从上到下的阅读顺序展示
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingBottom: 88,
  },
  featureCardShell: {
    paddingVertical: 3,
  },
  featureCard: {
    width: '100%',
    minHeight: 232,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 22,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  featureIconWrapper: {
    width: 64,
    height: 64,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  featureTitle: {
    marginTop: 18,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
  },
  featureDescription: {
    color: AppPalette.textMuted,
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
  },
  featureTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  featureTag: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  featureTagText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});
