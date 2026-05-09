import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { WeatherOverviewSections } from '@/components/weather-overview-sections';
import { getCachedWeatherDashboard } from '@/services/weather-dashboard-store';
import type { WeatherDashboard } from '@/services/type';

export default function WeatherOverviewScreen() {
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
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextGroup}>
            <ThemedText type="title" style={styles.title}>
              今日概览
            </ThemedText>
            <ThemedText style={styles.description}>
              空气质量、天气预警、生活指数和分钟降水统一收纳在这里。
            </ThemedText>
          </View>
          <View style={styles.iconBadge}>
            <MaterialIcons name="dashboard" size={22} color="#0F766E" />
          </View>
        </View>

        <View style={styles.summaryStrip}>
          <View style={styles.summaryItem}>
            <ThemedText style={styles.summaryLabel}>城市</ThemedText>
            <ThemedText type="defaultSemiBold">{dashboard?.current.city ?? '--'}</ThemedText>
          </View>
          <View style={styles.summaryItem}>
            <ThemedText style={styles.summaryLabel}>天气</ThemedText>
            <ThemedText type="defaultSemiBold">
              {dashboard?.current.weatherLabel ?? '--'}
            </ThemedText>
          </View>
          <View style={styles.summaryItem}>
            <ThemedText style={styles.summaryLabel}>温度</ThemedText>
            <ThemedText type="defaultSemiBold">
              {dashboard?.current.temperature ?? '--'}
            </ThemedText>
          </View>
        </View>
      </View>

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  headerCard: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: '#FFFFFF',
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
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#CCFBF1',
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
    backgroundColor: '#F8FAFC',
    gap: 4,
  },
  summaryLabel: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
  },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    borderRadius: 24,
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
