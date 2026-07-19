import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { WeatherOverviewSections } from '@/components/weather-overview-sections';
import { AppPalette } from '@/constants/theme';
import { DESKTOP_WEB_CONTENT_MAX_WIDTH, useWebLayout } from '@/hooks/use-web-layout';
import { getCachedWeatherDashboard } from '@/services/weather-dashboard-store';
import type { WeatherDashboard } from '@/services/type';

export default function WeatherOverviewScreen() {
  const { isDesktopWeb } = useWebLayout();
  const [dashboard, setDashboard] = useState<WeatherDashboard | null>(
    getCachedWeatherDashboard()
  );

  useFocusEffect(
    useCallback(() => {
      setDashboard(getCachedWeatherDashboard());
    }, [])
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/*
       * 渲染位置: 天气概览页面主内容区
       * 展示内容: 桌面 Web 下居中限宽的概览内容或空态提示
       * 数据来源: getCachedWeatherDashboard 缓存结果与 useWebLayout 桌面端判定
       */}
      <View style={[styles.contentInner, isDesktopWeb ? styles.contentInnerDesktop : null]}>
        {dashboard ? (
          <WeatherOverviewSections dashboard={dashboard} />
        ) : (
          <View style={styles.emptyCard}>
            <MaterialIcons name="cloud-off" size={24} color="#94A3B8" />
            <ThemedText type="subtitle">暂无天气详情</ThemedText>
            <ThemedText style={styles.emptyText}>
              先返回首页完成天气加载，再点击“今日概览”进入查看。
            </ThemedText>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // [变更] 修改前: 天气概览使用浅灰页面与白色信息卡
  // [变更] 修改后: 使用深色玻璃卡片和靛青信息徽标
  // [原因] 保持天气数据结构不变，同时统一应用品牌风格
  container: {
    flex: 1,
    backgroundColor: AppPalette.background,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  contentInner: {
    width: '100%',
  },
  contentInnerDesktop: {
    maxWidth: DESKTOP_WEB_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  headerCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    gap: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTextGroup: {
    flex: 1,
    gap: 8,
  },
  title: {
    fontSize: 28,
    lineHeight: 32,
  },
  description: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
  },
  summaryStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryItem: {
    flex: 1,
    minWidth: 90,
    borderRadius: 16,
    padding: 12,
    backgroundColor: AppPalette.surfaceSoft,
    gap: 4,
  },
  summaryLabel: {
    color: AppPalette.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    borderRadius: 24,
    paddingVertical: 40,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
  },
  emptyText: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
