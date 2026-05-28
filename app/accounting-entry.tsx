import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentProps, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '@/styles/accountingEntry';

import { ThemedText } from '@/components/themed-text';
import {
  loadAccountingEntryById,
  saveAccountingEntry,
  updateAccountingEntry,
  type AccountingEntryRecord,
} from '@/services/accounting-entry-storage';

type IncomeExpenseType = '支出' | '收入';
type DropdownKey = 'incomeExpenseType' | 'billType' | null;
type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];
type BillTypeOption = {
  label: string;
  icon: MaterialIconName;
};
type DatePickerDay = {
  key: string;
  label: string;
  value: string;
  isCurrentMonth: boolean;
};

const CUSTOM_OPTION = '自定义';
const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_INPUT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => index * 5);
const INCOME_OPTIONS: BillTypeOption[] = [
  { label: '工资', icon: 'account-balance-wallet' },
  { label: '利息', icon: 'savings' },
  { label: '红包', icon: 'card-giftcard' },
  { label: '奖金', icon: 'emoji-events' },
  { label: '兼职', icon: 'work-outline' },
  { label: CUSTOM_OPTION, icon: 'edit-note' },
];
const EXPENSE_OPTIONS: BillTypeOption[] = [
  { label: '餐饮', icon: 'restaurant' },
  { label: '蔬菜', icon: 'eco' },
  { label: '购物', icon: 'shopping-bag' },
  { label: '服饰', icon: 'checkroom' },
  { label: '娱乐', icon: 'sports-esports' },
  { label: '日用', icon: 'local-grocery-store' },
  { label: '旅行', icon: 'flight' },
  { label: '交通', icon: 'directions-bus' },
  { label: '零食', icon: 'cake' },
  { label: '生活', icon: 'storefront' },
  { label: '居家', icon: 'chair' },
  { label: '工作', icon: 'laptop-mac' },
  { label: CUSTOM_OPTION, icon: 'edit-note' },
];

const padDateValue = (value: number) => value.toString().padStart(2, '0');

const formatDateInputValue = (date: Date) => {
  return `${date.getFullYear()}-${padDateValue(date.getMonth() + 1)}-${padDateValue(date.getDate())}`;
};

const formatClockInputValue = (date: Date) => {
  return `${padDateValue(date.getHours())}:${padDateValue(date.getMinutes())}`;
};

const getCurrentDateTimeParts = () => {
  const now = new Date();

  return {
    date: formatDateInputValue(now),
    clock: formatClockInputValue(now),
  };
};

const isValidAmountValue = (value: string) => {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return false;
  }

  return /^(\d+(\.\d*)?|\.\d+)$/.test(trimmedValue);
};

const normalizeAmountInput = (value: string) => value.replace(/[。．]/g, '.');

const getValidDateInput = (value: string) => {
  const matchedValue = DATE_INPUT_PATTERN.exec(value.trim());

  if (!matchedValue) {
    return null;
  }

  const year = Number(matchedValue[1]);
  const month = Number(matchedValue[2]);
  const day = Number(matchedValue[3]);
  const parsedDate = new Date(year, month - 1, day);

  if (
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return parsedDate;
};

const getDateTimePartsFromStoredValue = (value: string) => {
  const parsedDate = new Date(value.trim().replace(' ', 'T'));

  if (Number.isNaN(parsedDate.getTime())) {
    return getCurrentDateTimeParts();
  }

  return {
    date: formatDateInputValue(parsedDate),
    clock: formatClockInputValue(parsedDate),
  };
};

const getDaysInMonth = (date: Date) => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
};

const getDatePickerDays = (monthDate: Date): DatePickerDay[] => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = getDaysInMonth(monthDate);
  const previousMonthDays = getDaysInMonth(new Date(year, month, 0));

  return Array.from({ length: 42 }, (_, index) => {
    const dayNumber = index - firstDay + 1;
    const isPreviousMonth = dayNumber <= 0;
    const isNextMonth = dayNumber > daysInMonth;
    const displayDay = isPreviousMonth
      ? previousMonthDays + dayNumber
      : isNextMonth
        ? dayNumber - daysInMonth
        : dayNumber;
    const itemDate = new Date(year, month + (isPreviousMonth ? -1 : isNextMonth ? 1 : 0), displayDay);

    return {
      key: `${itemDate.getFullYear()}-${itemDate.getMonth()}-${itemDate.getDate()}`,
      label: String(displayDay),
      value: formatDateInputValue(itemDate),
      isCurrentMonth: !isPreviousMonth && !isNextMonth,
    };
  });
};

const getClockPartFromInput = (value: string) => {
  const matchedValue = CLOCK_INPUT_PATTERN.exec(value.trim());
  const now = new Date();

  return {
    hour: matchedValue ? Number(matchedValue[1]) : now.getHours(),
    minute: matchedValue ? Number(matchedValue[2]) : now.getMinutes(),
  };
};

export default function AccountingEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ entryId?: string }>();
  const initialDateTimeParts = getCurrentDateTimeParts();
  const editingEntryId = typeof params.entryId === 'string' ? params.entryId : '';
  const isEditing = editingEntryId.length > 0;
  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null);
  const [incomeExpenseType, setIncomeExpenseType] = useState<IncomeExpenseType>('支出');
  const [billType, setBillType] = useState<string>(EXPENSE_OPTIONS[0].label);
  const [customBillType, setCustomBillType] = useState('');
  const [amount, setAmount] = useState('');
  const [dateInput, setDateInput] = useState(initialDateTimeParts.date);
  const [clockInput, setClockInput] = useState(initialDateTimeParts.clock);
  const [dateInputError, setDateInputError] = useState('');
  const [clockInputError, setClockInputError] = useState('');
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [isClockPickerVisible, setIsClockPickerVisible] = useState(false);
  const [datePickerMonth, setDatePickerMonth] = useState(() => new Date());
  const [remark, setRemark] = useState('');
  const [editingEntry, setEditingEntry] = useState<AccountingEntryRecord | null>(null);
  const [isLoadingEntry, setIsLoadingEntry] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const billTypeOptions = incomeExpenseType === '收入' ? INCOME_OPTIONS : EXPENSE_OPTIONS;
  const showCustomBillType = billType === CUSTOM_OPTION;
  const selectedBillTypeOption = useMemo(
    () => billTypeOptions.find((option) => option.label === billType) ?? billTypeOptions[0],
    [billType, billTypeOptions]
  );
  const showAmountError = amount.trim().length > 0 && !isValidAmountValue(amount);
  // 格式化: 日期弹层展示月份 → 生成包含前后补位的 6 周日期网格 → 可点击日期项
  // 说明: 用于让用户在账单录入页快速选择年月日
  const datePickerDays = useMemo(() => getDatePickerDays(datePickerMonth), [datePickerMonth]);
  const selectedClockPart = useMemo(() => getClockPartFromInput(clockInput), [clockInput]);
  const datePickerMonthLabel = `${datePickerMonth.getFullYear()}年${datePickerMonth.getMonth() + 1}月`;

  useEffect(() => {
    if (!isEditing) {
      setEditingEntry(null);
      setIsLoadingEntry(false);
      return;
    }

    let active = true;

    const syncEditingEntry = async () => {
      try {
        setIsLoadingEntry(true);
        const storedEntry = await loadAccountingEntryById(editingEntryId);

        if (!active) {
          return;
        }

        if (!storedEntry) {
          Alert.alert('提示', '未找到要编辑的账单记录', [{ text: '确定', onPress: () => router.back() }]);
          return;
        }

        const nextOptions =
          storedEntry.incomeExpenseType === '收入' ? INCOME_OPTIONS : EXPENSE_OPTIONS;
        const matchedOption = nextOptions.find((option) => option.label === storedEntry.billType);

        setEditingEntry(storedEntry);
        setIncomeExpenseType(storedEntry.incomeExpenseType);
        setBillType(matchedOption ? storedEntry.billType : CUSTOM_OPTION);
        setCustomBillType(matchedOption ? '' : storedEntry.billType);
        setAmount(storedEntry.amount);
        const storedDateTimeParts = getDateTimePartsFromStoredValue(storedEntry.time);
        setDateInput(storedDateTimeParts.date);
        setClockInput(storedDateTimeParts.clock);
        setDateInputError('');
        setClockInputError('');
        setDatePickerMonth(getValidDateInput(storedDateTimeParts.date) ?? new Date());
        setRemark(storedEntry.remark);
      } catch {
        if (active) {
          Alert.alert('加载失败', '账单信息暂未加载成功，请稍后重试', [
            { text: '确定', onPress: () => router.back() },
          ]);
        }
      } finally {
        if (active) {
          setIsLoadingEntry(false);
        }
      }
    };

    void syncEditingEntry();

    return () => {
      active = false;
    };
  }, [editingEntryId, isEditing, router]);

  const closeDropdown = () => setOpenDropdown(null);

  const handleIncomeExpenseTypeChange = (nextType: IncomeExpenseType) => {
    const nextOptions = nextType === '收入' ? INCOME_OPTIONS : EXPENSE_OPTIONS;

    setIncomeExpenseType(nextType);
    setBillType(nextOptions[0].label);
    setCustomBillType('');
    closeDropdown();
  };

  const handleBillTypeChange = (nextBillType: string) => {
    setBillType(nextBillType);
    closeDropdown();
  };

  const handleAmountChange = (value: string) => {
    setAmount(normalizeAmountInput(value));
  };

  const handleDateInputChange = (value: string) => {
    setDateInput(value);
    setDateInputError(value.trim() && !getValidDateInput(value) ? '请输入 YYYY-MM-DD 格式的有效日期' : '');
  };

  const handleClockInputChange = (value: string) => {
    setClockInput(value);
    setClockInputError(value.trim() && !CLOCK_INPUT_PATTERN.test(value.trim()) ? '请输入 HH:mm 格式的有效时间' : '');
  };

  const openDatePicker = () => {
    setDatePickerMonth(getValidDateInput(dateInput) ?? new Date());
    setIsDatePickerVisible(true);
  };

  const handleChangeDatePickerMonth = (offset: number) => {
    setDatePickerMonth((currentMonth) => new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1));
  };

  const handlePickDate = (value: string) => {
    setDateInput(value);
    setDateInputError('');
    setIsDatePickerVisible(false);
  };

  const handlePickHour = (hour: number) => {
    setClockInput(`${padDateValue(hour)}:${padDateValue(selectedClockPart.minute)}`);
    setClockInputError('');
  };

  const handlePickMinute = (minute: number) => {
    setClockInput(`${padDateValue(selectedClockPart.hour)}:${padDateValue(minute)}`);
    setClockInputError('');
  };

  const handleUseCurrentClock = () => {
    setClockInput(formatClockInputValue(new Date()));
    setClockInputError('');
  };

  const handleSave = async () => {
    const normalizedAmount = amount.trim();
    const normalizedBillType = showCustomBillType ? customBillType.trim() : billType;
    const normalizedDate = dateInput.trim();
    const normalizedClock = clockInput.trim();
    const isAmountValid = isValidAmountValue(normalizedAmount);
    const validDate = getValidDateInput(normalizedDate);
    const isClockValid = CLOCK_INPUT_PATTERN.test(normalizedClock);

    if (!normalizedBillType) {
      Alert.alert('提示', '请输入账单类型');
      return;
    }

    if (!isAmountValid || Number(normalizedAmount) <= 0) {
      Alert.alert('提示', '请输入正确的账单金额');
      return;
    }

    if (!validDate) {
      setDateInputError('请输入 YYYY-MM-DD 格式的有效日期');
      Alert.alert('提示', '请输入正确的账单日期');
      return;
    }

    if (!isClockValid) {
      setClockInputError('请输入 HH:mm 格式的有效时间');
      Alert.alert('提示', '请输入正确的账单时间');
      return;
    }

    const nextEntry: AccountingEntryRecord = {
      id: editingEntry?.id ?? `${Date.now()}`,
      incomeExpenseType,
      billType: normalizedBillType,
      amount: normalizedAmount,
      // [变更] 修改前: 保存单个自由输入的 time 字段
      // [变更] 修改后: 将已校验的日期和时间合并为 YYYY-MM-DD HH:mm
      // [原因] 保持历史存储结构兼容，同时提升录入与修改时的时间准确性
      time: `${normalizedDate} ${normalizedClock}`,
      remark: remark.trim(),
      createdAt: editingEntry?.createdAt ?? new Date().toISOString(),
    };

    try {
      setIsSaving(true);
      // [变更] 修改前: 录入页仅支持新增账单
      // [变更] 修改后: 根据是否携带 entryId 决定新增或更新已有账单
      // [原因] 支持从账单列表进入编辑模式并复用原有表单
      if (isEditing) {
        await updateAccountingEntry(nextEntry);
      } else {
        await saveAccountingEntry(nextEntry);
      }
      Alert.alert(isEditing ? '更新成功' : '保存成功', isEditing ? '账单已更新' : '账单已保存到本地安全存储中', [
        { text: '确定', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert(isEditing ? '更新失败' : '保存失败', isEditing ? '当前账单暂未更新成功，请稍后重试' : '当前账单暂未保存成功，请稍后重试');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.screen}>
          <View style={styles.header}>
            <Pressable style={styles.iconButton} onPress={() => router.back()}>
              <MaterialIcons name="arrow-back" size={24} color="#262626" />
            </Pressable>
            <ThemedText style={styles.headerTitle}>{isEditing ? '更改账单' : '账单录入'}</ThemedText>
            <View style={styles.iconButton} />
          </View>

          <View style={styles.selectorBar}>
            <TopSelector
              label="收支类型"
              value={incomeExpenseType}
              onPress={() => setOpenDropdown('incomeExpenseType')}
            />
            <TopSelector
              label="账单类型"
              value={showCustomBillType ? customBillType || CUSTOM_OPTION : billType}
              onPress={() => setOpenDropdown('billType')}
              icon={selectedBillTypeOption?.icon}
            />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}>
            <View style={styles.card}>
              <View style={styles.summaryCard}>
                <ThemedText style={styles.summaryLabel}>当前账单类型</ThemedText>
                <View style={styles.summaryTypeRow}>
                  <View style={styles.summaryIconBadge}>
                    <MaterialIcons
                      name={selectedBillTypeOption?.icon ?? 'edit-note'}
                      size={24}
                      color="#525252"
                    />
                  </View>
                  <View style={styles.summaryTextGroup}>
                    <ThemedText style={styles.summaryTypeTitle}>
                      {showCustomBillType ? customBillType || '自定义' : billType}
                    </ThemedText>
                    <ThemedText style={styles.summaryTypeMeta}>{incomeExpenseType}</ThemedText>
                  </View>
                </View>
              </View>

              {showCustomBillType ? (
                <FormField label="自定义账单类型">
                  <TextInput
                    value={customBillType}
                    onChangeText={setCustomBillType}
                    placeholder="请输入自定义类型"
                    placeholderTextColor="#A3A3A3"
                    style={styles.input}
                  />
                </FormField>
              ) : null}

              <FormField label="账单金额">
                <TextInput
                  value={amount}
                  onChangeText={handleAmountChange}
                  placeholder="请输入金额"
                  placeholderTextColor="#A3A3A3"
                  inputMode="decimal"
                  keyboardType="default"
                  autoCorrect={false}
                  style={styles.input}
                />
                {showAmountError ? (
                  <ThemedText style={styles.errorText}>请输入正确的金额</ThemedText>
                ) : null}
              </FormField>

              <FormField label="日期">
                {/*
                 * 渲染位置: 账单录入表单日期字段
                 * 展示内容: 可手动输入的年月日和右侧日历选择入口
                 * 数据来源: dateInput 状态和日期选择弹层
                 */}
                <View style={[styles.inputWithPicker, dateInputError ? styles.inputWithPickerError : null]}>
                  <TextInput
                    value={dateInput}
                    onChangeText={handleDateInputChange}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#A3A3A3"
                    inputMode="numeric"
                    keyboardType="numbers-and-punctuation"
                    autoCorrect={false}
                    style={styles.inputWithPickerText}
                  />
                  <Pressable
                    accessibilityLabel="选择账单日期"
                    style={styles.inputPickerButton}
                    onPress={openDatePicker}>
                    <MaterialIcons name="calendar-today" size={20} color="#2563EB" />
                  </Pressable>
                </View>
                {dateInputError ? <ThemedText style={styles.errorText}>{dateInputError}</ThemedText> : null}
              </FormField>

              <FormField label="时间">
                {/*
                 * 渲染位置: 账单录入表单时间字段
                 * 展示内容: 可手动输入的时分和右侧时钟选择入口
                 * 数据来源: clockInput 状态和时间选择弹层
                 */}
                <View style={[styles.inputWithPicker, clockInputError ? styles.inputWithPickerError : null]}>
                  <TextInput
                    value={clockInput}
                    onChangeText={handleClockInputChange}
                    placeholder="HH:mm"
                    placeholderTextColor="#A3A3A3"
                    inputMode="numeric"
                    keyboardType="numbers-and-punctuation"
                    autoCorrect={false}
                    style={styles.inputWithPickerText}
                  />
                  <Pressable
                    accessibilityLabel="选择账单时间"
                    style={styles.inputPickerButton}
                    onPress={() => setIsClockPickerVisible(true)}>
                    <MaterialIcons name="schedule" size={22} color="#2563EB" />
                  </Pressable>
                </View>
                {clockInputError ? <ThemedText style={styles.errorText}>{clockInputError}</ThemedText> : null}
              </FormField>

              <FormField label="账单备注（选填）">
                <TextInput
                  value={remark}
                  onChangeText={setRemark}
                  placeholder="请输入备注"
                  placeholderTextColor="#A3A3A3"
                  multiline
                  style={[styles.input, styles.remarkInput]}
                />
              </FormField>
            </View>

            <Pressable
              style={[styles.submitButton, (isSaving || isLoadingEntry) && styles.submitButtonDisabled]}
              onPress={() => void handleSave()}
              disabled={isSaving || isLoadingEntry}>
              <ThemedText style={styles.submitButtonText}>
                {isLoadingEntry ? '加载中...' : isSaving ? (isEditing ? '更新中...' : '保存中...') : isEditing ? '更新账单' : '保存账单'}
              </ThemedText>
            </Pressable>
          </ScrollView>

          <SelectorModal
            visible={openDropdown !== null}
            title={openDropdown === 'incomeExpenseType' ? '选择收支类型' : '选择账单类型'}
            onClose={closeDropdown}>
            {openDropdown === 'incomeExpenseType' ? (
              <View style={styles.incomeExpenseOptionList}>
                {(['支出', '收入'] as const).map((option) => (
                  <Pressable
                    key={option}
                    style={[
                      styles.incomeExpenseOption,
                      incomeExpenseType === option && styles.incomeExpenseOptionActive,
                    ]}
                    onPress={() => handleIncomeExpenseTypeChange(option)}>
                    <ThemedText
                      style={[
                        styles.incomeExpenseOptionText,
                        incomeExpenseType === option && styles.incomeExpenseOptionTextActive,
                      ]}>
                      {option}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.billTypeGrid}>
                {billTypeOptions.map((option) => (
                  <Pressable
                    key={option.label}
                    style={[
                      styles.billTypeOption,
                      billType === option.label && styles.billTypeOptionActive,
                    ]}
                    onPress={() => handleBillTypeChange(option.label)}>
                    <View
                      style={[
                        styles.billTypeIconCircle,
                        billType === option.label && styles.billTypeIconCircleActive,
                      ]}>
                      <MaterialIcons
                        name={option.icon}
                        size={30}
                        color={billType === option.label ? '#2563EB' : '#5B5B5B'}
                      />
                    </View>
                    <ThemedText
                      style={[
                        styles.billTypeOptionLabel,
                        billType === option.label && styles.billTypeOptionLabelActive,
                      ]}>
                      {option.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
          </SelectorModal>

          <SelectorModal
            visible={isDatePickerVisible}
            title="选择日期"
            onClose={() => setIsDatePickerVisible(false)}>
            {/*
             * 渲染位置: 日期选择弹层
             * 展示内容: 月份切换、星期标题和当月日期网格
             * 数据来源: datePickerMonth、datePickerDays、dateInput
             */}
            <View style={styles.datePickerContent}>
              <View style={styles.datePickerHeader}>
                <Pressable style={styles.datePickerMonthButton} onPress={() => handleChangeDatePickerMonth(-1)}>
                  <MaterialIcons name="chevron-left" size={22} color="#2563EB" />
                </Pressable>
                <ThemedText style={styles.datePickerMonthText}>{datePickerMonthLabel}</ThemedText>
                <Pressable style={styles.datePickerMonthButton} onPress={() => handleChangeDatePickerMonth(1)}>
                  <MaterialIcons name="chevron-right" size={22} color="#2563EB" />
                </Pressable>
              </View>
              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((weekday) => (
                  <ThemedText key={weekday} style={styles.weekdayText}>
                    {weekday}
                  </ThemedText>
                ))}
              </View>
              <View style={styles.dateGrid}>
                {datePickerDays.map((day) => (
                  <Pressable
                    key={day.key}
                    style={[
                      styles.dateGridItem,
                      !day.isCurrentMonth && styles.dateGridItemMuted,
                      dateInput === day.value && styles.dateGridItemActive,
                    ]}
                    onPress={() => handlePickDate(day.value)}>
                    <ThemedText
                      style={[
                        styles.dateGridItemText,
                        !day.isCurrentMonth && styles.dateGridItemTextMuted,
                        dateInput === day.value && styles.dateGridItemTextActive,
                      ]}>
                      {day.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          </SelectorModal>

          <SelectorModal
            visible={isClockPickerVisible}
            title="选择时间"
            onClose={() => setIsClockPickerVisible(false)}>
            {/*
             * 渲染位置: 时间选择弹层
             * 展示内容: 当前时间快捷按钮、小时网格和分钟网格
             * 数据来源: clockInput 状态
             */}
            <View style={styles.clockPickerContent}>
              <Pressable style={styles.clockNowButton} onPress={handleUseCurrentClock}>
                <MaterialIcons name="access-time" size={18} color="#2563EB" />
                <ThemedText style={styles.clockNowButtonText}>使用当前时间</ThemedText>
              </Pressable>
              <ThemedText style={styles.clockPickerSectionTitle}>小时</ThemedText>
              <View style={styles.clockOptionGrid}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <Pressable
                    key={hour}
                    style={[
                      styles.clockOption,
                      selectedClockPart.hour === hour && styles.clockOptionActive,
                    ]}
                    onPress={() => handlePickHour(hour)}>
                    <ThemedText
                      style={[
                        styles.clockOptionText,
                        selectedClockPart.hour === hour && styles.clockOptionTextActive,
                      ]}>
                      {padDateValue(hour)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText style={styles.clockPickerSectionTitle}>分钟</ThemedText>
              <View style={styles.clockOptionGrid}>
                {MINUTE_OPTIONS.map((minute) => (
                  <Pressable
                    key={minute}
                    style={[
                      styles.clockOption,
                      selectedClockPart.minute === minute && styles.clockOptionActive,
                    ]}
                    onPress={() => handlePickMinute(minute)}>
                    <ThemedText
                      style={[
                        styles.clockOptionText,
                        selectedClockPart.minute === minute && styles.clockOptionTextActive,
                      ]}>
                      {padDateValue(minute)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.clockPickerDoneButton} onPress={() => setIsClockPickerVisible(false)}>
                <ThemedText style={styles.clockPickerDoneText}>完成</ThemedText>
              </Pressable>
            </View>
          </SelectorModal>
        </View>
      </SafeAreaView>
    </>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
      {children}
    </View>
  );
}

function TopSelector({
  label,
  value,
  onPress,
  icon,
}: {
  label: string;
  value: string;
  onPress: () => void;
  icon?: MaterialIconName;
}) {
  return (
    <Pressable style={styles.topSelector} onPress={onPress}>
      <ThemedText style={styles.topSelectorLabel}>{label}</ThemedText>
      <View style={styles.topSelectorValueRow}>
        {icon ? <MaterialIcons name={icon} size={18} color="#525252" /> : null}
        <ThemedText style={styles.topSelectorValue} numberOfLines={1}>
          {value}
        </ThemedText>
        <MaterialIcons name="keyboard-arrow-down" size={20} color="#737373" />
      </View>
    </Pressable>
  );
}

function SelectorModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.topSheet}>
          <View style={styles.topSheetHeader}>
            <ThemedText style={styles.topSheetTitle}>{title}</ThemedText>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <MaterialIcons name="close" size={20} color="#525252" />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

