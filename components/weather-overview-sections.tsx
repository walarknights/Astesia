import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { WeatherDashboard } from '@/services/type';

type Props = {
  dashboard: WeatherDashboard;
};

const FORECAST_TRACK_WIDTH = 112;

export function WeatherOverviewSections({ dashboard }: Props) {
  const maxPrecip = Math.max(
    0.1,
    ...((dashboard.minutely?.items ?? []).map((item) => Number(item.precip)) || [0.1])
  );
  const temperatureValues = dashboard.dailyForecasts.flatMap((item) => [
    Number(item.tempMax),
    Number(item.tempMin),
  ]);
  const validTemperatureValues = temperatureValues.filter((item) => !Number.isNaN(item));
  const maxTemperature = validTemperatureValues.length
    ? Math.max(...validTemperatureValues)
    : 0;
  const minTemperature = validTemperatureValues.length
    ? Math.min(...validTemperatureValues)
    : 0;
  const temperatureRange = Math.max(maxTemperature - minTemperature, 1);

  return (
    <View style={styles.dataSection}>
      <View style={styles.dataCard}>
        <View style={styles.cardHeaderRow}>
          <ThemedText type="subtitle">空气质量</ThemedText>
          <View style={styles.airBadge}>
            <ThemedText style={styles.airBadgeText}>AQI {dashboard.airQuality?.aqi ?? '--'}</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.cardHeadline}>
          {dashboard.airQuality?.category ?? '暂无空气质量数据'}
        </ThemedText>
        <ThemedText style={styles.cardDescription}>
          首要污染物：{dashboard.airQuality?.primaryPollutant ?? '--'}
        </ThemedText>
        <ThemedText style={styles.cardDescription}>
          {dashboard.airQuality?.advice ?? '当前暂无健康建议。'}
        </ThemedText>
        <View style={styles.metricRow}>
          {(dashboard.airQuality?.pollutants ?? []).map((item) => (
            <View key={item.name} style={styles.metricPill}>
              <ThemedText style={styles.metricLabel}>{item.name}</ThemedText>
              <ThemedText style={styles.metricValue}>{item.value}</ThemedText>
            </View>
          ))}
        </View>
      </View>
      
        <View style={styles.dataCard}>
        <View style={styles.cardHeaderRow}>
          <ThemedText type="subtitle">近 7 日气温</ThemedText>
          <MaterialIcons name="device-thermostat" size={18} color="#368bd5ff" />
        </View>
        <ThemedText style={styles.cardHeadline}>查看未来一周温度变化</ThemedText>
        <ThemedText style={styles.cardDescription}>
          横向滑动可查看每天的最高温、最低温和白天天气。
        </ThemedText>
        {dashboard.dailyForecasts.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.forecastScrollContent}>
            {dashboard.dailyForecasts.map((item) => {
              const maxTemp = Number(item.tempMax);
              const minTemp = Number(item.tempMin);
              const rangeStart = Number.isNaN(minTemp)
                ? 0
                : ((minTemp - minTemperature) / temperatureRange) * FORECAST_TRACK_WIDTH;
              const rangeWidth = Number.isNaN(maxTemp) || Number.isNaN(minTemp)
                ? 20
                : Math.max(
                    20,
                    ((maxTemp - minTemp) / temperatureRange) * FORECAST_TRACK_WIDTH
                  );

              return (
                <View key={item.date} style={styles.forecastCard}>
                  <View style={styles.forecastHeader}>
                    <ThemedText type="defaultSemiBold">{item.dayLabel}</ThemedText>
                    <ThemedText style={styles.forecastDate}>
                      {item.date.slice(5).replace('-', '/')}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.forecastWeather}>{item.textDay}</ThemedText>
                  <View style={styles.forecastTrack}>
                    <View
                      style={[
                        styles.forecastRangeBar,
                        { left: rangeStart, width: rangeWidth },
                      ]}
                    />
                  </View>
                  <View style={styles.forecastTempRow}>
                    <View style={styles.forecastTempGroup}>
                      <ThemedText style={styles.forecastTempLabel}>最低</ThemedText>
                      <ThemedText style={styles.forecastMinTemp}>{item.tempMin}°</ThemedText>
                    </View>
                    <View style={styles.forecastTempGroup}>
                      <ThemedText style={styles.forecastTempLabel}>最高</ThemedText>
                      <ThemedText style={styles.forecastMaxTemp}>{item.tempMax}°</ThemedText>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <ThemedText style={styles.cardDescription}>当前暂无近 7 日天气数据。</ThemedText>
        )}
      </View>

      <View style={styles.dataCard}>
        <View style={styles.cardHeaderRow}>
          <ThemedText type="subtitle">天气预警</ThemedText>
          <View style={styles.warningBadge}>
            <ThemedText style={styles.warningBadgeText}>{dashboard.alerts.length} 条</ThemedText>
          </View>
        </View>
        {dashboard.alerts.length > 0 ? (
          <>
            <ThemedText style={styles.cardHeadline}>{dashboard.alerts[0].headline}</ThemedText>
            <ThemedText style={styles.cardDescription}>
              发布机构：{dashboard.alerts[0].senderName}
            </ThemedText>
            <ThemedText style={styles.cardDescription}>
              {dashboard.alerts[0].description}
            </ThemedText>
            <ThemedText style={styles.cardFootnote}>
              {dashboard.alertAttributions[0] ?? '请留意官方最新预警通知。'}
            </ThemedText>
          </>
        ) : (
          <>
            <ThemedText style={styles.cardHeadline}>当前无生效预警</ThemedText>
            <ThemedText style={styles.cardDescription}>
              当前查询地区没有正在生效的官方天气预警。
            </ThemedText>
          </>
        )}
      </View>

      <View style={styles.dataCard}>
        <View style={styles.cardHeaderRow}>
          <ThemedText type="subtitle">生活指数</ThemedText>
          <MaterialIcons name="wb-sunny" size={18} color="#7C3AED" />
        </View>
        <View style={styles.indexList}>
          {dashboard.indices.map((item) => (
            <View key={item.name} style={styles.indexItem}>
              <View style={styles.indexTitleRow}>
                <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                <ThemedText style={styles.indexCategory}>{item.category}</ThemedText>
              </View>
              <ThemedText style={styles.cardDescription}>{item.text}</ThemedText>
            </View>
          ))}
          {dashboard.indices.length === 0 ? (
            <ThemedText style={styles.cardDescription}>当前暂无生活指数数据。</ThemedText>
          ) : null}
        </View>
      </View>

      <View style={styles.dataCard}>
        <View style={styles.cardHeaderRow}>
          <ThemedText type="subtitle">分钟降水</ThemedText>
          <MaterialIcons name="water-drop" size={18} color="#2563EB" />
        </View>
        <ThemedText style={styles.cardHeadline}>
          {dashboard.minutely?.summary ?? '当前暂无分钟降水数据'}
        </ThemedText>
        {dashboard.minutely?.items.length ? (
          <>
            <View style={styles.precipBarRow}>
              {dashboard.minutely.items.map((item) => {
                const precip = Number(item.precip);
                const barHeight = Math.max(6, (precip / maxPrecip) * 56);

                return (
                  <View key={item.time} style={styles.precipColumn}>
                    <View style={[styles.precipBar, { height: barHeight }]} />
                    <ThemedText style={styles.precipValue}>{item.precip}mm</ThemedText>
                    <ThemedText style={styles.precipTime}>{item.time}</ThemedText>
                  </View>
                );
              })}
            </View>
            <ThemedText style={styles.cardFootnote}>展示未来 30 分钟的每 5 分钟降水量。</ThemedText>
          </>
        ) : (
          <ThemedText style={styles.cardDescription}>当前地区未来两小时暂无降水趋势数据。</ThemedText>
        )}
      </View>

    
    </View>
  );
}

const styles = StyleSheet.create({
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
  forecastScrollContent: {
    gap: 12,
    paddingRight: 4,
  },
  forecastCard: {
    width: 148,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#F8FAFC',
    gap: 10,
  },
  forecastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  forecastDate: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 16,
  },
  forecastWeather: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  forecastTrack: {
    width: FORECAST_TRACK_WIDTH,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    position: 'relative',
    overflow: 'hidden',
  },
  forecastRangeBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: '#368bd5ff',
  },
  forecastTempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  forecastTempGroup: {
    gap: 2,
  },
  forecastTempLabel: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 14,
  },
  forecastMinTemp: {
    color: '#2563EB',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
  },
  forecastMaxTemp: {
    color: '#ea3c0cff',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
  },
});
