import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';

const HERO_IMAGE = require('@/assets/images/cloudy.jpg');
const BUDGET_TOTAL = 8000;
const BUDGET_LEFT = 6389;
const BUDGET_DAILY_LEFT = 319.45;
const WEEKLY_TOTAL = 808;
const budgetProgress = (BUDGET_TOTAL - BUDGET_LEFT) / BUDGET_TOTAL;

const weeklyExpenses = [
  { day: '周一', amount: 9 },
  { day: '周二', amount: 92 },
  { day: '周三', amount: 300 },
  { day: '周四', amount: 0 },
  { day: '周五', amount: 229 },
  { day: '周六', amount: 106 },
  { day: '周日', amount: 72 },
] as const;

const transactionGroups = [
  {
    dateLabel: '05.12 今天',
    total: 72,
    items: [
      { title: '饺子', amount: 60 },
      { title: '三餐', amount: 12 },
    ],
  },
  {
    dateLabel: '05.11 昨天',
    total: 106,
    items: [
      { title: '奶茶', amount: 28 },
      { title: '打车', amount: 78 },
    ],
  },
] as const;

const maxWeeklyExpense = Math.max(...weeklyExpenses.map((item) => item.amount));

export default function AccountingScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}>
            <View style={styles.header}>
              <View style={styles.iconButton}>
                <MaterialIcons name="menu" size={24} color="#262626" />
              </View>

              <View style={styles.monthBadge}>
                <ThemedText style={styles.monthText}>2024-05</ThemedText>
                <MaterialIcons name="keyboard-arrow-down" size={18} color="#262626" />
              </View>

              <View style={styles.headerActions}>
                <View style={styles.iconButton}>
                  <MaterialIcons name="calendar-today" size={21} color="#262626" />
                </View>
                <View style={styles.iconButton}>
                  <MaterialIcons name="insert-chart-outlined" size={22} color="#262626" />
                </View>
              </View>
            </View>

            <View style={styles.heroCard}>
              <Image source={HERO_IMAGE} contentFit="cover" style={styles.heroImage} />
              <View style={styles.heroOverlay} />

              <View style={styles.heroContent}>
                <View style={styles.heroTopRow}>
                  <View>
                    <ThemedText style={styles.heroLabel}>月结余</ThemedText>
                    <ThemedText style={styles.heroBalance}>-¥1611.00</ThemedText>
                  </View>

                  <View style={styles.heroTag}>
                    <ThemedText style={styles.heroTagText}>细碎生活</ThemedText>
                    <MaterialIcons name="chevron-right" size={16} color="#525252" />
                  </View>
                </View>

                <ThemedText style={styles.heroSummary}>
                  月收入: ¥0.00  月支出: ¥1611.00
                </ThemedText>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <ThemedText style={styles.cardTitle}>预算</ThemedText>
                <MaterialIcons name="more-horiz" size={22} color="#9CA3AF" />
              </View>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${budgetProgress * 100}%` }]} />
              </View>

              <View style={styles.budgetSummaryRow}>
                <View style={styles.budgetInfoGroup}>
                  <ThemedText style={styles.mutedText}>
                    剩余:{BUDGET_LEFT.toFixed(2)} | 剩余日均:{BUDGET_DAILY_LEFT.toFixed(2)}
                  </ThemedText>
                </View>
                <ThemedText style={styles.mutedText}>总额:{BUDGET_TOTAL.toFixed(2)}</ThemedText>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <ThemedText style={styles.cardTitle}>本周支出</ThemedText>
                  <ThemedText style={styles.cardSubtitle}>共计 ¥{WEEKLY_TOTAL.toFixed(2)}</ThemedText>
                </View>
                <MaterialIcons name="more-horiz" size={22} color="#9CA3AF" />
              </View>

              <View style={styles.chart}>
                {weeklyExpenses.map((item) => {
                  const rawHeight = maxWeeklyExpense === 0 ? 0 : (item.amount / maxWeeklyExpense) * 120;
                  const barHeight = item.amount === 0 ? 0 : Math.max(rawHeight, 14);

                  return (
                    <View key={item.day} style={styles.chartColumn}>
                      <ThemedText style={styles.chartValue}>¥{item.amount.toFixed(2)}</ThemedText>
                      <View style={styles.chartBarSlot}>
                        {barHeight > 0 ? (
                          <View style={[styles.chartBar, { height: barHeight }]} />
                        ) : (
                          <View style={styles.chartBarPlaceholder} />
                        )}
                      </View>
                      <ThemedText style={styles.chartLabel}>{item.day}</ThemedText>
                    </View>
                  );
                })}
              </View>
            </View>

            {transactionGroups.map((group) => (
              <View key={group.dateLabel} style={styles.billCard}>
                <View style={styles.billHeader}>
                  <ThemedText style={styles.billDate}>{group.dateLabel}</ThemedText>
                  <ThemedText style={styles.billTotal}>支:¥{group.total.toFixed(2)}</ThemedText>
                </View>

                {group.items.map((item, index) => (
                  <View
                    key={`${group.dateLabel}-${item.title}`}
                    style={[styles.billItem, index > 0 && styles.billItemBorder]}>
                    <View style={styles.billItemLeft}>
                      <View style={styles.billDot} />
                      <ThemedText style={styles.billItemTitle}>{item.title}</ThemedText>
                    </View>
                    <ThemedText style={styles.billItemAmount}>-¥{item.amount.toFixed(2)}</ThemedText>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>

          <View style={styles.bottomBar}>
            <View style={styles.bottomTab}>
              <MaterialIcons name="receipt-long" size={24} color="#3B82F6" />
              <ThemedText style={[styles.bottomTabLabel, styles.bottomTabLabelActive]}>账单</ThemedText>
            </View>

            <View style={styles.addButton}>
              <MaterialIcons name="add" size={34} color="#FFFFFF" />
            </View>

            <View style={styles.bottomTab}>
              <MaterialIcons name="account-balance-wallet" size={24} color="#9CA3AF" />
              <ThemedText style={styles.bottomTabLabel}>资产</ThemedText>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  screen: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 120,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  monthText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#262626',
  },
  heroCard: {
    height: 192,
    borderRadius: 18,
    overflow: 'hidden',
    justifyContent: 'space-between',
    backgroundColor: '#D4D4D4',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(38, 38, 38, 0.22)',
  },
  heroContent: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  heroLabel: {
    fontSize: 16,
    lineHeight: 22,
    color: '#E5E7EB',
  },
  heroBalance: {
    marginTop: 4,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  heroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  heroTagText: {
    fontSize: 15,
    lineHeight: 18,
    color: '#525252',
  },
  heroSummary: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#F3F4F6',
  },
  card: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: '#262626',
  },
  cardSubtitle: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 20,
    color: '#9CA3AF',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E7F6EF',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#24C17E',
  },
  budgetSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 12,
  },
  budgetInfoGroup: {
    flex: 1,
  },
  mutedText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#9CA3AF',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    minHeight: 210,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  chartValue: {
    fontSize: 12,
    lineHeight: 16,
    color: '#F28B8E',
  },
  chartBarSlot: {
    height: 128,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  chartBar: {
    width: 11,
    borderRadius: 999,
    backgroundColor: '#F05A5A',
  },
  chartBarPlaceholder: {
    width: 11,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  chartLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: '#9CA3AF',
  },
  billCard: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  billHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#FCFCFC',
  },
  billDate: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#262626',
  },
  billTotal: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#262626',
  },
  billItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
  },
  billItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  billItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  billDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F05A5A',
  },
  billItemTitle: {
    fontSize: 16,
    lineHeight: 22,
    color: '#262626',
  },
  billItemAmount: {
    fontSize: 15,
    lineHeight: 20,
    color: '#F05A5A',
  },
  bottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  bottomTab: {
    width: 56,
    alignItems: 'center',
    gap: 4,
  },
  bottomTabLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: '#9CA3AF',
  },
  bottomTabLabelActive: {
    color: '#3B82F6',
  },
  addButton: {
    width: 56,
    height: 56,
    marginTop: -24,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
