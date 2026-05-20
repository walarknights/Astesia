import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import {
  deleteAccountingEntry,
  loadAccountingMonthlyBudget,
  loadAccountingEntries,
  saveAccountingMonthlyBudget,
  type AccountingMonthlyBudgetRecord,
  type AccountingEntryRecord,
} from '@/services/accounting-entry-storage';

const HERO_IMAGE = require('@/assets/images/cloudy.jpg');
const WEEK_DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

type TransactionGroup = {
  dateKey: string;
  dateLabel: string;
  incomeTotal: number;
  expenseTotal: number;
  items: {
    id: string;
    title: string;
    amount: number;
    incomeExpenseType: '支出' | '收入';
    meta: string;
  }[];
};

type EntryActionTarget = {
  id: string;
  title: string;
};

function getValidDate(input: string) {
  const normalizedInput = input.trim().replace(' ', 'T');
  const parsedDate = new Date(normalizedInput);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function parseEntryDate(entry: AccountingEntryRecord) {
  return getValidDate(entry.time) ?? getValidDate(entry.createdAt) ?? new Date(0);
}

function padDateValue(value: number) {
  return value.toString().padStart(2, '0');
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${padDateValue(date.getMonth() + 1)}-${padDateValue(date.getDate())}`;
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}-${padDateValue(date.getMonth() + 1)}`;
}

function formatDateLabel(date: Date) {
  const today = new Date();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((currentDay.getTime() - targetDay.getTime()) / 86400000);
  const baseLabel = `${padDateValue(date.getMonth() + 1)}.${padDateValue(date.getDate())}`;

  if (diffDays === 0) {
    return `${baseLabel} 今天`;
  }

  if (diffDays === 1) {
    return `${baseLabel} 昨天`;
  }

  return baseLabel;
}

function formatTimeLabel(date: Date) {
  return `${padDateValue(date.getHours())}:${padDateValue(date.getMinutes())}`;
}

function getMonthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return { start, end };
}

function getCurrentWeekDays(date: Date) {
  const currentDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (currentDay.getDay() + 6) % 7;
  const monday = new Date(currentDay);

  monday.setDate(currentDay.getDate() - mondayOffset);

  return WEEK_DAY_LABELS.map((day, index) => {
    const weekDate = new Date(monday);
    weekDate.setDate(monday.getDate() + index);

    return {
      day,
      dateKey: formatDateKey(weekDate),
      amount: 0,
    };
  });
}

function isDateInRange(date: Date, start: Date, end: Date) {
  const timestamp = date.getTime();

  return timestamp >= start.getTime() && timestamp < end.getTime();
}

function getRemainingDaysInMonth(date: Date) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return Math.max(1, Math.ceil((nextMonth.getTime() - today.getTime()) / 86400000));
}

function normalizeAmountInput(value: string) {
  return value.replace(/[。．]/g, '.');
}

function isValidAmountValue(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return false;
  }

  return /^(\d+(\.\d*)?|\.\d+)$/.test(trimmedValue);
}

export default function AccountingScreen() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [entries, setEntries] = useState<AccountingEntryRecord[]>([]);
  const [selectedEntryAction, setSelectedEntryAction] = useState<EntryActionTarget | null>(null);
  const [entryPendingDelete, setEntryPendingDelete] = useState<EntryActionTarget | null>(null);
  const [monthlyBudgetRecord, setMonthlyBudgetRecord] = useState<AccountingMonthlyBudgetRecord>(() => ({
    amount: 0,
    monthLeftDay: getRemainingDaysInMonth(new Date()),
    monthLabel: formatMonthLabel(new Date()),
    setDate: new Date().toISOString(),
  }));
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetInputError, setBudgetInputError] = useState('');
  const [isBudgetModalVisible, setIsBudgetModalVisible] = useState(false);
  const [isBudgetDailyHelpVisible, setIsBudgetDailyHelpVisible] = useState(false);
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const currentMonthRange = useMemo(() => getMonthRange(currentDate), [currentDate]);
  const currentWeekDays = useMemo(() => getCurrentWeekDays(currentDate), [currentDate]);
  const currentMonthLabel = formatMonthLabel(currentDate);
  const monthlyBudget = monthlyBudgetRecord.amount;

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const syncAccountingEntries = async () => {
        const nextCurrentDate = new Date();
        const [storedEntries, storedMonthlyBudget] = await Promise.all([
          loadAccountingEntries(),
          loadAccountingMonthlyBudget(nextCurrentDate),
        ]);

        if (active) {
          setCurrentDate(nextCurrentDate);
          setEntries(storedEntries);
          setMonthlyBudgetRecord(storedMonthlyBudget);
        }
      };

      void syncAccountingEntries();

      return () => {
        active = false;
      };
    }, [])
  );

  const monthlySummary = useMemo(() => {
    return entries.reduce(
      (summary, entry) => {
        const parsedDate = parseEntryDate(entry);

        if (!isDateInRange(parsedDate, currentMonthRange.start, currentMonthRange.end)) {
          return summary;
        }

        const amount = Number(entry.amount) || 0;

        if (entry.incomeExpenseType === '收入') {
          summary.income += amount;
        } else {
          summary.expense += amount;
        }

        return summary;
      },
      { income: 0, expense: 0 }
    );
  }, [currentMonthRange.end, currentMonthRange.start, entries]);

  const monthlyBalance = monthlySummary.income - monthlySummary.expense;
  const monthlySummaryText = `月收入: ¥${monthlySummary.income.toFixed(2)}  月支出: ¥${monthlySummary.expense.toFixed(2)}`;
  const budgetLeft = monthlyBudget - monthlySummary.expense;
  const budgetMonthLeftDay =
    monthlyBudgetRecord.monthLabel === currentMonthLabel
      ? monthlyBudgetRecord.monthLeftDay
      : getRemainingDaysInMonth(currentDate);
  // 格式化: 账单列表 → 筛选出当前日期的支出并累加 → 当日支出金额
  // 说明: 用于计算预算卡片中的剩余日均
  const todayExpense = useMemo(() => {
    const currentDateKey = formatDateKey(currentDate);

    return entries.reduce((total, entry) => {
      if (entry.incomeExpenseType !== '支出') {
        return total;
      }

      return formatDateKey(parseEntryDate(entry)) === currentDateKey
        ? total + (Number(entry.amount) || 0)
        : total;
    }, 0);
  }, [currentDate, entries]);
  // [变更] 修改前: 使用预算剩余额度除以当前自然月剩余天数
  // [变更] 修改后: 使用月预算除以设置预算当天记录的 monthLeftDay，再减去当日支出
  // [原因] 让剩余日均与预算设置当天的分摊规则保持一致
  const budgetDailyLeft = monthlyBudget > 0 ? monthlyBudget / budgetMonthLeftDay - todayExpense : 0;
  const budgetProgress =
    monthlyBudget > 0 ? Math.min(Math.max(monthlySummary.expense / monthlyBudget, 0), 1) : 0;

  const weeklyExpenses = useMemo(() => {
    const weeklyExpenseMap = new Map(currentWeekDays.map((item) => [item.dateKey, 0]));

    entries.forEach((entry) => {
      if (entry.incomeExpenseType !== '支出') {
        return;
      }

      const dateKey = formatDateKey(parseEntryDate(entry));

      if (!weeklyExpenseMap.has(dateKey)) {
        return;
      }

      weeklyExpenseMap.set(dateKey, (weeklyExpenseMap.get(dateKey) ?? 0) + (Number(entry.amount) || 0));
    });

    return currentWeekDays.map((item) => ({
      ...item,
      amount: weeklyExpenseMap.get(item.dateKey) ?? 0,
    }));
  }, [currentWeekDays, entries]);

  const weeklyTotal = weeklyExpenses.reduce((total, item) => total + item.amount, 0);
  const maxWeeklyExpense = Math.max(0, ...weeklyExpenses.map((item) => item.amount));

  const openBudgetModal = () => {
    setBudgetInput(monthlyBudget > 0 ? String(monthlyBudget) : '');
    setBudgetInputError('');
    setIsBudgetModalVisible(true);
  };

  const closeEntryActionModal = () => {
    setSelectedEntryAction(null);
  };

  const closeDeleteConfirmModal = () => {
    setEntryPendingDelete(null);
  };

  const openEntryActionModal = useCallback((entry: EntryActionTarget) => {
    setSelectedEntryAction(entry);
  }, []);

  const handleStartEditEntry = useCallback(() => {
    if (!selectedEntryAction) {
      return;
    }

    closeEntryActionModal();
    router.push({
      pathname: '/accounting-entry',
      params: { entryId: selectedEntryAction.id },
    });
  }, [router, selectedEntryAction]);

  const handleAskDeleteEntry = useCallback(() => {
    if (!selectedEntryAction) {
      return;
    }

    setEntryPendingDelete(selectedEntryAction);
    closeEntryActionModal();
  }, [selectedEntryAction]);

  const handleDeleteEntry = useCallback(async () => {
    if (!entryPendingDelete) {
      return;
    }

    try {
      // [变更] 修改前: 长按后直接使用系统 Alert 执行删除确认
      // [变更] 修改后: 先展示自定义操作列表，再通过自定义确认框删除并同步更新列表
      // [原因] 支持“更改/删除”双操作，并满足弹层圆角与阴影样式要求
      const nextEntries = await deleteAccountingEntry(entryPendingDelete.id);
      setEntries(nextEntries);
      closeDeleteConfirmModal();
    } catch {
      Alert.alert('删除失败', '账单暂未删除成功，请稍后重试');
    }
  }, [entryPendingDelete]);

  const showBudgetDailyLeftHelp = () => {
    setIsBudgetDailyHelpVisible(true);
  };

  const closeBudgetDailyLeftHelp = () => {
    setIsBudgetDailyHelpVisible(false);
  };

  const closeBudgetModal = () => {
    if (isSavingBudget) {
      return;
    }

    setIsBudgetModalVisible(false);
  };

  const handleBudgetInputChange = (value: string) => {
    setBudgetInput(normalizeAmountInput(value));
    setBudgetInputError('');
  };

  const handleSaveBudget = async () => {
    const normalizedInput = budgetInput.trim();

    if (normalizedInput && !isValidAmountValue(normalizedInput)) {
      setBudgetInputError('请输入正确的预算金额');
      return;
    }

    try {
      setIsSavingBudget(true);
      const nextBudget = await saveAccountingMonthlyBudget(
        normalizedInput ? Number(normalizedInput) : 0,
        currentDate
      );
      setMonthlyBudgetRecord(nextBudget);
      setIsBudgetModalVisible(false);
    } catch {
      Alert.alert('保存失败', '本月预算暂未保存成功，请稍后重试');
    } finally {
      setIsSavingBudget(false);
    }
  };

  const transactionGroups = useMemo<TransactionGroup[]>(() => {
    const sortedEntries = [...entries].sort(
      (left, right) => parseEntryDate(right).getTime() - parseEntryDate(left).getTime()
    );
    const groupedEntries = new Map<
      string,
      TransactionGroup & {
        timestamp: number;
      }
    >();

    sortedEntries.forEach((entry) => {
      const parsedDate = parseEntryDate(entry);
      const dateKey = formatDateKey(parsedDate);
      const amount = Number(entry.amount) || 0;
      const remark = entry.remark.trim();
      const existingGroup = groupedEntries.get(dateKey);
      const nextItem = {
        id: entry.id,
        title: entry.billType.trim() || '未分类',
        amount,
        incomeExpenseType: entry.incomeExpenseType,
        meta: remark ? `${formatTimeLabel(parsedDate)} · ${remark}` : formatTimeLabel(parsedDate),
      };

      if (existingGroup) {
        existingGroup.items.push(nextItem);
        existingGroup.incomeTotal += entry.incomeExpenseType === '收入' ? amount : 0;
        existingGroup.expenseTotal += entry.incomeExpenseType === '支出' ? amount : 0;
        return;
      }

      groupedEntries.set(dateKey, {
        dateKey,
        dateLabel: formatDateLabel(parsedDate),
        incomeTotal: entry.incomeExpenseType === '收入' ? amount : 0,
        expenseTotal: entry.incomeExpenseType === '支出' ? amount : 0,
        items: [nextItem],
        timestamp: parsedDate.getTime(),
      });
    });

    return Array.from(groupedEntries.values())
      .sort((left, right) => right.timestamp - left.timestamp)
      .map(({ timestamp: _timestamp, ...group }) => group);
  }, [entries]);

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
              <Pressable style={styles.iconButton} onPress={() => router.back()}>
                <MaterialIcons name="arrow-back" size={24} color="#262626" />
              </Pressable>

              <View style={styles.monthBadge}>
                <ThemedText style={styles.monthText}>{currentMonthLabel}</ThemedText>
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
                    <ThemedText style={styles.heroBalance}>¥{monthlyBalance.toFixed(2)}</ThemedText>
                  </View>

                  <View style={styles.heroTag}>
                    <ThemedText style={styles.heroTagText}>细碎生活</ThemedText>
                    <MaterialIcons name="chevron-right" size={16} color="#525252" />
                  </View>
                </View>

                <ThemedText style={styles.heroSummary}>{monthlySummaryText}</ThemedText>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <ThemedText style={styles.cardTitle}>预算</ThemedText>
                <Pressable style={styles.budgetEditButton} onPress={openBudgetModal}>
                  <MaterialIcons name="edit" size={16} color="#3B82F6" />
                  <ThemedText style={styles.budgetEditText}>设置</ThemedText>
                </Pressable>
              </View>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${budgetProgress * 100}%` }]} />
              </View>

              <View style={styles.budgetSummaryRow}>
                {/*
                 * 渲染位置: 预算卡片底部左侧
                 * 展示内容: 预算剩余额度、剩余日均以及计算说明入口
                 * 数据来源: monthlyBudgetRecord、monthlySummary、entries、currentDate
                 */}
                <View style={styles.budgetInfoGroup}>
                  <ThemedText style={styles.mutedText}>剩余:{budgetLeft.toFixed(2)}</ThemedText>
                  <View style={styles.budgetDailyLeftRow}>
                    <ThemedText style={styles.mutedText}>剩余日均:{budgetDailyLeft.toFixed(2)}</ThemedText>
                    <Pressable
                      accessibilityLabel="查看剩余日均计算逻辑"
                      hitSlop={8}
                      onPress={showBudgetDailyLeftHelp}
                      style={styles.budgetHelpButton}>
                      <ThemedText style={styles.budgetHelpText}>?</ThemedText>
                    </Pressable>
                  </View>
                </View>
                <ThemedText style={styles.mutedText}>总额:{monthlyBudget.toFixed(2)}</ThemedText>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <ThemedText style={styles.cardTitle}>本周支出</ThemedText>
                  <ThemedText style={styles.cardSubtitle}>共计 ¥{weeklyTotal.toFixed(2)}</ThemedText>
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

            {transactionGroups.length > 0 ? (
              transactionGroups.map((group) => (
                <View key={group.dateKey} style={styles.billCard}>
                  <View style={styles.billHeader}>
                    <ThemedText style={styles.billDate}>{group.dateLabel}</ThemedText>
                    <ThemedText style={styles.billTotal}>
                      {group.incomeTotal > 0 ? `收:¥${group.incomeTotal.toFixed(2)} ` : ''}
                      {group.expenseTotal > 0 ? `支:¥${group.expenseTotal.toFixed(2)}` : ''}
                    </ThemedText>
                  </View>

                  {/*
                   * 渲染位置: 每个日期分组下的账单列表
                   * 展示内容: 单条账单的分类、时间备注、金额，以及长按后的操作入口
                   * 数据来源: transactionGroups 中 group.items
                   */}
                  {group.items.map((item, index) => (
                    <Pressable
                      key={item.id}
                      delayLongPress={280}
                      onLongPress={() => openEntryActionModal({ id: item.id, title: item.title })}
                      style={({ pressed }) => [
                        styles.billItem,
                        index > 0 && styles.billItemBorder,
                        pressed && styles.billItemPressed,
                      ]}>
                      <View style={styles.billItemLeft}>
                        <View
                          style={[
                            styles.billDot,
                            item.incomeExpenseType === '收入' && styles.billDotIncome,
                          ]}
                        />
                        <View style={styles.billItemTextGroup}>
                          <ThemedText style={styles.billItemTitle}>{item.title}</ThemedText>
                          <ThemedText style={styles.billItemMeta}>{item.meta}</ThemedText>
                        </View>
                      </View>
                      <ThemedText
                        style={[
                          styles.billItemAmount,
                          item.incomeExpenseType === '收入' && styles.billItemAmountIncome,
                        ]}>
                        {item.incomeExpenseType === '收入' ? '+' : '-'}¥{item.amount.toFixed(2)}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              ))
            ) : (
              <View style={styles.emptyBillCard}>
                <MaterialIcons name="receipt-long" size={24} color="#94A3B8" />
                <ThemedText style={styles.emptyBillTitle}>暂无已保存账单</ThemedText>
                <ThemedText style={styles.emptyBillText}>
                  点击底部加号录入一笔账单，返回后会在这里实时显示。
                </ThemedText>
              </View>
            )}
          </ScrollView>

          <View style={styles.bottomBar}>
            <View style={styles.bottomTab}>
              <MaterialIcons name="receipt-long" size={24} color="#3B82F6" />
              <ThemedText style={[styles.bottomTabLabel, styles.bottomTabLabelActive]}>账单</ThemedText>
            </View>

            <Pressable style={styles.addButton} onPress={() => router.push('/accounting-entry')}>
              <MaterialIcons name="add" size={34} color="#FFFFFF" />
            </Pressable>

            <View style={styles.bottomTab}>
              <MaterialIcons name="account-balance-wallet" size={24} color="#9CA3AF" />
              <ThemedText style={styles.bottomTabLabel}>资产</ThemedText>
            </View>
          </View>
        </View>
      </SafeAreaView>

      <Modal
        transparent
        visible={selectedEntryAction !== null}
        animationType="fade"
        onRequestClose={closeEntryActionModal}>
        <View style={styles.actionModalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeEntryActionModal} />
          {/*
           * 渲染位置: 账单页中部浮层
           * 展示内容: 长按账单后的操作列表，提供更改和删除两个动作
           * 数据来源: selectedEntryAction
           */}
          <View style={styles.actionSheetCard}>
            <ThemedText style={styles.actionSheetTitle}>账单操作</ThemedText>
            <ThemedText style={styles.actionSheetDescription}>
              当前账单：{selectedEntryAction?.title ?? '未命名账单'}
            </ThemedText>
            <Pressable style={styles.actionSheetButton} onPress={handleStartEditEntry}>
              <MaterialIcons name="edit-note" size={20} color="#2563EB" />
              <ThemedText style={styles.actionSheetButtonText}>更改</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.actionSheetButton, styles.actionSheetButtonSpaced]}
              onPress={handleAskDeleteEntry}>
              <MaterialIcons name="delete-outline" size={20} color="#DC2626" />
              <ThemedText style={styles.actionSheetDeleteText}>删除</ThemedText>
            </Pressable>
            <Pressable style={styles.actionSheetCancelButton} onPress={closeEntryActionModal}>
              <ThemedText style={styles.actionSheetCancelText}>取消</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={entryPendingDelete !== null}
        animationType="fade"
        onRequestClose={closeDeleteConfirmModal}>
        <View style={styles.actionModalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDeleteConfirmModal} />
          {/*
           * 渲染位置: 账单页中部确认浮层
           * 展示内容: 删除账单确认信息和取消/删除按钮
           * 数据来源: entryPendingDelete
           */}
          <View style={styles.confirmDialogCard}>
            <ThemedText style={styles.confirmDialogTitle}>删除账单</ThemedText>
            <ThemedText style={styles.confirmDialogDescription}>
              确认删除“{entryPendingDelete?.title ?? '当前账单'}”吗？删除后无法恢复。
            </ThemedText>
            <View style={styles.confirmDialogActions}>
              <Pressable style={styles.confirmDialogCancelButton} onPress={closeDeleteConfirmModal}>
                <ThemedText style={styles.confirmDialogCancelText}>取消</ThemedText>
              </Pressable>
              <Pressable style={styles.confirmDialogDeleteButton} onPress={() => void handleDeleteEntry()}>
                <ThemedText style={styles.confirmDialogDeleteText}>删除</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={isBudgetDailyHelpVisible}
        animationType="fade"
        onRequestClose={closeBudgetDailyLeftHelp}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeBudgetDailyLeftHelp} />
          {/*
           * 渲染位置: 账单页中部说明弹层
           * 展示内容: 剩余日均的计算公式、monthLeftDay 说明以及当前代入值
           * 数据来源: monthlyBudget、budgetMonthLeftDay、todayExpense、budgetDailyLeft
           */}
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>剩余日均计算逻辑</ThemedText>
            <ThemedText style={styles.modalDescription}>
              剩余日均 = 月预算 ÷ monthLeftDay - 当日支出
              {'\n\n'}
              monthLeftDay 为设置本月预算当天起，到本月结束的剩余天数（包含设置当天）。例如 4 月 15
              日设置预算时，monthLeftDay = 16。
              {'\n\n'}
              当前计算: {monthlyBudget.toFixed(2)} ÷ {budgetMonthLeftDay} - {todayExpense.toFixed(2)} ={' '}
              {budgetDailyLeft.toFixed(2)}
            </ThemedText>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalConfirmButton} onPress={closeBudgetDailyLeftHelp}>
                <ThemedText style={styles.modalConfirmText}>我知道了</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={isBudgetModalVisible} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>设置本月预算</ThemedText>
            <ThemedText style={styles.modalDescription}>
              请输入本月预算金额，留空保存则初始化为 0。
            </ThemedText>
            <TextInput
              value={budgetInput}
              onChangeText={handleBudgetInputChange}
              placeholder="请输入本月预算"
              placeholderTextColor="#A3A3A3"
              keyboardType="decimal-pad"
              style={[styles.budgetInput, budgetInputError ? styles.budgetInputError : null]}
            />
            {budgetInputError ? (
              <ThemedText style={styles.errorText}>{budgetInputError}</ThemedText>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeBudgetModal}>
                <ThemedText style={styles.modalCancelText}>取消</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.modalConfirmButton, isSavingBudget && styles.modalButtonDisabled]}
                onPress={handleSaveBudget}
                disabled={isSavingBudget}>
                <ThemedText style={styles.modalConfirmText}>
                  {isSavingBudget ? '保存中...' : '保存'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  budgetEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#EFF6FF',
  },
  budgetEditText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: '#3B82F6',
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
    gap: 4,
  },
  budgetDailyLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  budgetHelpButton: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
  },
  budgetHelpText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: '#3B82F6',
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
  billItemPressed: {
    backgroundColor: '#F8FAFC',
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
  billItemTextGroup: {
    gap: 2,
  },
  billDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F05A5A',
  },
  billDotIncome: {
    backgroundColor: '#24C17E',
  },
  billItemTitle: {
    fontSize: 16,
    lineHeight: 22,
    color: '#262626',
  },
  billItemMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: '#9CA3AF',
  },
  billItemAmount: {
    fontSize: 15,
    lineHeight: 20,
    color: '#F05A5A',
  },
  billItemAmountIncome: {
    color: '#24C17E',
  },
  emptyBillCard: {
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 28,
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  emptyBillTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#262626',
  },
  emptyBillText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#9CA3AF',
    textAlign: 'center',
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
  actionModalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
  },
  actionSheetCard: {
    width: '80%',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  actionSheetTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '800',
    color: '#262626',
  },
  actionSheetDescription: {
    marginTop: 6,
    marginBottom: 16,
    fontSize: 14,
    lineHeight: 20,
    color: '#737373',
  },
  actionSheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#F8FAFC',
  },
  actionSheetButtonSpaced: {
    marginTop: 10,
  },
  actionSheetButtonText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#2563EB',
  },
  actionSheetDeleteText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: '#DC2626',
  },
  actionSheetCancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderRadius: 18,
    paddingVertical: 13,
    backgroundColor: '#F5F5F5',
  },
  actionSheetCancelText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: '#525252',
  },
  confirmDialogCard: {
    width: '100%',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  confirmDialogTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '800',
    color: '#262626',
  },
  confirmDialogDescription: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: '#737373',
  },
  confirmDialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  confirmDialogCancelButton: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#F5F5F5',
  },
  confirmDialogCancelText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: '#525252',
  },
  confirmDialogDeleteButton: {
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#EF4444',
  },
  confirmDialogDeleteText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  modalCard: {
    width: '100%',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  modalTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '800',
    color: '#262626',
  },
  modalDescription: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: '#737373',
  },
  budgetInput: {
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D4D4D4',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 22,
    color: '#262626',
    backgroundColor: '#FAFAFA',
  },
  budgetInputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: '#EF4444',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  modalCancelButton: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#F5F5F5',
  },
  modalCancelText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: '#525252',
  },
  modalConfirmButton: {
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#3B82F6',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalConfirmText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
