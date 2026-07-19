import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Rect } from 'react-native-svg';
import { styles } from '@/styles/accountStyle';
import { AppPalette } from '@/constants/theme';

import { BottomSwitchBar } from '@/components/BottomSwitchBar';
import { ThemedText } from '@/components/themed-text';
import {
  deleteAccountingEntry,
  loadAccountingMonthlyBudget,
  loadAccountingEntries,
  loadAccountingTotalAsset,
  saveAccountingMonthlyBudget,
  saveAccountingMonthlyBudgetRecord,
  saveAccountingTotalAsset,
  type AccountingMonthlyBudgetRecord,
  type AccountingEntryRecord,
} from '@/services/accounting-entry-storage';
import {
  loadAccountingHeroImageUri,
  persistAccountingHeroImage,
} from '@/services/accounting-hero-image-storage';
import {
  loadSecurityTrend,
  searchSecurities,
  type AssetRangeLabel,
  type SecurityCandle,
  type SecuritySearchResult,
  type SecurityTrendResult,
} from '@/services/akshare';
import { setCachedAccountingScreenSnapshot } from '@/services/accounting-screen-store';

const HERO_IMAGE = require('@/assets/images/cloudy.jpg');
const WEEK_DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const MONTH_OPTIONS = Array.from({ length: 12 }, (_item, index) => index + 1);
const ASSET_RANGE_OPTIONS = ['近7日', '近一个月', '近1年'] as const;
const STOCK_CHART_WIDTH = 300;
const STOCK_CHART_HEIGHT = 132;

const SECURITY_OPTIONS: SecurityTrendResult[] = [
  {
    code: 'AAPL',
    name: '苹果公司',
    type: '股票',
    price: 196.45,
    changeRate: 1.28,
    trend: {
      近7日: [188.3, 189.6, 191.2, 190.4, 193.8, 195.1, 196.45],
      近一个月: [174.2, 176.8, 181.6, 179.5, 185.2, 188.9, 190.4, 193.6, 196.45],
      近1年: [142.1, 151.4, 148.8, 160.2, 169.5, 166.7, 177.9, 184.3, 196.45],
    },
    candles: {
      近7日: [],
      近一个月: [],
      近1年: [],
    },
  },
  {
    code: 'TSLA',
    name: '特斯拉',
    type: '股票',
    price: 247.11,
    changeRate: -0.86,
    trend: {
      近7日: [252.5, 251.1, 249.7, 250.2, 248.4, 246.3, 247.11],
      近一个月: [233.8, 238.2, 241.9, 245.4, 243.8, 249.6, 252.1, 248.5, 247.11],
      近1年: [189.4, 204.5, 198.2, 215.8, 230.2, 226.1, 242.9, 254.7, 247.11],
    },
    candles: {
      近7日: [],
      近一个月: [],
      近1年: [],
    },
  },
  {
    code: '510300',
    name: '沪深300ETF',
    type: '基金',
    price: 4.18,
    changeRate: 0.42,
    trend: {
      近7日: [4.08, 4.11, 4.09, 4.12, 4.15, 4.16, 4.18],
      近一个月: [3.92, 3.96, 4.01, 3.98, 4.05, 4.1, 4.13, 4.17, 4.18],
      近1年: [3.58, 3.66, 3.72, 3.7, 3.86, 3.94, 4.02, 4.12, 4.18],
    },
    candles: {
      近7日: [],
      近一个月: [],
      近1年: [],
    },
  },
];

type AccountingTab = 'bill' | 'asset';
type BillQueryScope = 'month' | 'year';

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

function getYearRange(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const end = new Date(date.getFullYear() + 1, 0, 1);

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

function isValidSignedAmountValue(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return false;
  }

  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(trimmedValue);
}

/**
 * 计算账单收入支出后的净资产初始值。
 *
 * @param {AccountingEntryRecord[]} sourceEntries - 已保存的账单列表
 * @returns {number} 收入总额减支出总额后的金额
 * @example
 *   calculateEntriesBalance([{ incomeExpenseType: '收入', amount: '10' }]) // => 10
 */
function calculateEntriesBalance(sourceEntries: AccountingEntryRecord[]) {
  return sourceEntries.reduce((total, entry) => {
    const amount = Number(entry.amount) || 0;
    return entry.incomeExpenseType === '收入' ? total + amount : total - amount;
  }, 0);
}

function calculateRangeBalance(sourceEntries: AccountingEntryRecord[], start: Date, end: Date) {
  return sourceEntries.reduce((total, entry) => {
    const parsedDate = parseEntryDate(entry);

    if (!isDateInRange(parsedDate, start, end)) {
      return total;
    }

    const amount = Number(entry.amount) || 0;
    return entry.incomeExpenseType === '收入' ? total + amount : total - amount;
  }, 0);
}

/**
 * 将收盘价序列转换为可展示的兜底 K 线。
 *
 * @param {readonly number[]} values - 股票/基金收盘价序列
 * @returns {SecurityCandle[]} 由相邻收盘价推导出的 K 线数据
 * @example
 *   buildFallbackCandles([1, 2]) // => [{ open: 1, close: 1 }, { open: 1, close: 2 }]
 */
function buildFallbackCandles(values: readonly number[]): SecurityCandle[] {
  return values.map((close, index) => {
    const open = index === 0 ? close : values[index - 1];

    return {
      date: String(index + 1),
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: null,
      amount: null,
      amplitude: open ? (Math.abs(close - open) / open) * 100 : 0,
      changeRate: open ? ((close - open) / open) * 100 : 0,
      changeAmount: close - open,
      turnoverRate: null,
    };
  });
}

/**
 * 将 K 线数据转换为 SVG 绘制坐标。
 *
 * @param {readonly SecurityCandle[]} candles - AkShare 返回的开高低收数据
 * @returns {Array} SVG 蜡烛图元素所需坐标
 * @example
 *   buildCandlestickShapes([{ open: 1, high: 2, low: 1, close: 2, date: '1', volume: null }])
 */
function buildCandlestickShapes(candles: readonly SecurityCandle[]) {
  const highValue = Math.max(...candles.map((candle) => candle.high));
  const lowValue = Math.min(...candles.map((candle) => candle.low));
  const valueRange = highValue - lowValue || 1;
  const padding = 8;
  const plotHeight = STOCK_CHART_HEIGHT - padding * 2;
  const xStep = candles.length > 1 ? STOCK_CHART_WIDTH / (candles.length - 1) : STOCK_CHART_WIDTH / 2;
  const bodyWidth = Math.max(3, Math.min(12, STOCK_CHART_WIDTH / Math.max(candles.length, 1) * 0.58));
  const yOf = (value: number) => padding + ((highValue - value) / valueRange) * plotHeight;

  // 格式化: OHLC 行情数组 → 归一化为 SVG 坐标 → K 线蜡烛图绘制数据
  // 说明: 股票使用真实开高低收，基金使用净值序列推导出可视化蜡烛
  return candles.map((candle, index) => {
    const x = candles.length > 1 ? index * xStep : STOCK_CHART_WIDTH / 2;
    const openY = yOf(candle.open);
    const closeY = yOf(candle.close);
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(2, Math.abs(closeY - openY));

    return {
      ...candle,
      x,
      openY,
      closeY,
      highY: yOf(candle.high),
      lowY: yOf(candle.low),
      bodyX: x - bodyWidth / 2,
      bodyTop,
      bodyHeight,
      bodyWidth,
      isRising: candle.close >= candle.open,
    };
  });
}

function formatMarketValue(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined ? '--' : value.toFixed(digits);
}

function formatLargeMarketValue(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '--';
  }

  if (Math.abs(value) >= 100000000) {
    return `${(value / 100000000).toFixed(2)}亿`;
  }

  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(2)}万`;
  }

  return value.toFixed(2);
}

function getFallbackSecurityOptions(keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (!normalizedKeyword) {
    return SECURITY_OPTIONS;
  }

  // 格式化: 搜索关键字 + 本地兜底标的 → 按名称/代码/类型过滤 → 兜底搜索结果
  // 说明: AkShare 服务不可用时仍保留基础演示和页面可用性
  return SECURITY_OPTIONS.filter((security) => {
    return (
      security.name.toLowerCase().includes(normalizedKeyword) ||
      security.code.toLowerCase().includes(normalizedKeyword) ||
      security.type.toLowerCase().includes(normalizedKeyword)
    );
  });
}

/**
 * 将新拉取到的单一区间行情并回当前证券状态，保留已存在的其他区间数据。
 *
 * @param {SecurityTrendResult} currentSecurity - 组件当前持有的证券状态
 * @param {SecurityTrendResult} nextSecurity - 本次接口返回的证券状态
 * @param {AssetRangeLabel} range - 本次更新的区间标签
 * @returns {SecurityTrendResult} 合并后的证券状态
 * @example
 *   mergeSecurityRangeData(currentSecurity, nextSecurity, '近7日')
 */
function mergeSecurityRangeData(
  currentSecurity: SecurityTrendResult,
  nextSecurity: SecurityTrendResult,
  range: AssetRangeLabel
) {
  return {
    ...currentSecurity,
    price: nextSecurity.price,
    changeRate: nextSecurity.changeRate,
    trend: {
      ...currentSecurity.trend,
      [range]: nextSecurity.trend[range],
    },
    candles: {
      ...currentSecurity.candles,
      [range]: nextSecurity.candles[range],
    },
  };
}

export default function AccountingScreen() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [entries, setEntries] = useState<AccountingEntryRecord[]>([]);
  const [activeTab, setActiveTab] = useState<AccountingTab>('bill');
  const [billQueryScope, setBillQueryScope] = useState<BillQueryScope>('month');
  const [billPickerScope, setBillPickerScope] = useState<BillQueryScope>('month');
  const [billPickerYear, setBillPickerYear] = useState(() => new Date().getFullYear());
  const [billPickerMonth, setBillPickerMonth] = useState(() => new Date().getMonth() + 1);
  const [isBillPeriodModalVisible, setIsBillPeriodModalVisible] = useState(false);
  const [selectedEntryAction, setSelectedEntryAction] = useState<EntryActionTarget | null>(null);
  const [entryPendingDelete, setEntryPendingDelete] = useState<EntryActionTarget | null>(null);
  const [monthlyBudgetRecord, setMonthlyBudgetRecord] = useState<AccountingMonthlyBudgetRecord>(() => ({
    amount: 0,
    monthLeftDay: getRemainingDaysInMonth(new Date()),
    monthLabel: formatMonthLabel(new Date()),
    setDate: new Date().toISOString(),
    dailyAverage: 0,
    dailyAverageDateKey: formatDateKey(new Date()),
  }));
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetInputError, setBudgetInputError] = useState('');
  const [isBudgetModalVisible, setIsBudgetModalVisible] = useState(false);
  const [isBudgetDailyHelpVisible, setIsBudgetDailyHelpVisible] = useState(false);
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const [heroImageUri, setHeroImageUri] = useState<string | null>(null);
  const [isHeroImageModalVisible, setIsHeroImageModalVisible] = useState(false);
  const [isSavingHeroImage, setIsSavingHeroImage] = useState(false);
  const [totalAsset, setTotalAsset] = useState<number | null>(null);
  const [assetInput, setAssetInput] = useState('');
  const [assetInputError, setAssetInputError] = useState('');
  const [isAssetModalVisible, setIsAssetModalVisible] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [assetSearchKeyword, setAssetSearchKeyword] = useState('');
  const [selectedAssetRange, setSelectedAssetRange] = useState<AssetRangeLabel>('近7日');
  const [selectedSecurity, setSelectedSecurity] = useState<SecurityTrendResult | null>(null);
  const [securitySearchResults, setSecuritySearchResults] =
    useState<SecuritySearchResult[]>(SECURITY_OPTIONS);
  const [securitySearchError, setSecuritySearchError] = useState('');
  const [isSearchingSecurities, setIsSearchingSecurities] = useState(false);
  const [isLoadingSecurityTrend, setIsLoadingSecurityTrend] = useState(false);
  const [selectedSecurityCandle, setSelectedSecurityCandle] = useState<SecurityCandle | null>(null);
  const [isAssetSearchModalVisible, setIsAssetSearchModalVisible] = useState(false);
  const currentMonthRange = useMemo(() => getMonthRange(currentDate), [currentDate]);
  const currentYearRange = useMemo(() => getYearRange(currentDate), [currentDate]);
  const currentBillRange = useMemo(
    () => (billQueryScope === 'year' ? getYearRange(currentDate) : getMonthRange(currentDate)),
    [billQueryScope, currentDate]
  );
  const currentWeekDays = useMemo(() => getCurrentWeekDays(currentDate), [currentDate]);
  const currentMonthLabel = formatMonthLabel(currentDate);
  const currentBillPeriodLabel =
    billQueryScope === 'year' ? `${currentDate.getFullYear()}年` : `${currentMonthLabel}`;
  const monthlyBudget = monthlyBudgetRecord.amount;
  const heroImageSource = heroImageUri ? { uri: heroImageUri } : HERO_IMAGE;
  const [securityName, setSecurityName] = useState('股票/基金名称');


  useFocusEffect(
    useCallback(() => {
      let active = true;

      const syncAccountingEntries = async () => {
        const nextCurrentDate = new Date();
        const [storedEntries, storedMonthlyBudget, storedHeroImageUri, storedTotalAsset] = await Promise.all([
          loadAccountingEntries(),
          loadAccountingMonthlyBudget(nextCurrentDate),
          loadAccountingHeroImageUri(),
          loadAccountingTotalAsset(),
        ]);

        if (active) {
          setCurrentDate(nextCurrentDate);
          setEntries(storedEntries);
          setMonthlyBudgetRecord(storedMonthlyBudget);
          setHeroImageUri(storedHeroImageUri);
          setTotalAsset(storedTotalAsset);
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

        if (!isDateInRange(parsedDate, currentBillRange.start, currentBillRange.end)) {
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
  }, [currentBillRange.end, currentBillRange.start, entries]);

  const monthlyBalance = monthlySummary.income - monthlySummary.expense;
  const monthlySummaryText = `${billQueryScope === 'year' ? '年收入' : '月收入'}: ¥${monthlySummary.income.toFixed(2)}  `;
  const monthlyBalanceText = `${billQueryScope === 'year' ? '年支出' : '月支出'}: ¥${monthlySummary.expense.toFixed(2)}`;
  const entriesBalance = useMemo(() => calculateEntriesBalance(entries), [entries]);
  const displayedTotalAsset = totalAsset ?? entriesBalance;
  const assetYearBalance = useMemo(
    () => calculateRangeBalance(entries, currentYearRange.start, currentYearRange.end),
    [currentYearRange.end, currentYearRange.start, entries]
  );
  const assetMonthBalance = useMemo(
    () => calculateRangeBalance(entries, currentMonthRange.start, currentMonthRange.end),
    [currentMonthRange.end, currentMonthRange.start, entries]
  );
  const accountingDayCount = useMemo(
    () => new Set(entries.map((entry) => formatDateKey(parseEntryDate(entry)))).size,
    [entries]
  );
  const filteredSecurityOptions = securitySearchResults;
  const selectedSecurityTrend = useMemo(
    () => selectedSecurity?.trend[selectedAssetRange] ?? [],
    [selectedAssetRange, selectedSecurity]
  );
  const selectedSecurityCandles = useMemo(
    () => selectedSecurity?.candles[selectedAssetRange] ?? [],
    [selectedAssetRange, selectedSecurity]
  );
  const selectedSecurityDisplayCandles = useMemo(() => {
    if (selectedSecurityCandles.length > 0) {
      return selectedSecurityCandles;
    }

    return buildFallbackCandles(selectedSecurityTrend);
  }, [selectedSecurityCandles, selectedSecurityTrend]);
  const selectedSecurityKLineShapes = useMemo(
    () => buildCandlestickShapes(selectedSecurityDisplayCandles),
    [selectedSecurityDisplayCandles]
  );
  const selectedSecurityTrendStart = selectedSecurityTrend[0] ?? 0;
  const selectedSecurityTrendEnd = selectedSecurityTrend[selectedSecurityTrend.length - 1] ?? 0;
  const selectedSecurityLatestCandle =
    selectedSecurityDisplayCandles[selectedSecurityDisplayCandles.length - 1] ?? null;
  const selectedSecurityRangeChangeRate =
    selectedSecurityTrendStart > 0
      ? ((selectedSecurityTrendEnd - selectedSecurityTrendStart) / selectedSecurityTrendStart) * 100
      : selectedSecurity?.changeRate ?? 0;
  const selectedSecurityPriceText = selectedSecurityLatestCandle
    ? `¥${selectedSecurityLatestCandle.close.toFixed(2)}`
    : selectedSecurity?.price !== null && selectedSecurity?.price !== undefined
      ? `¥${selectedSecurity.price.toFixed(2)}`
      : '加载中';
  const selectedSecurityChangeRate = selectedSecurityRangeChangeRate;

  useEffect(() => {
    // [变更] 修改前: 资产页内选中的证券、区间和 K 线明细只保存在组件状态里
    // [变更] 修改后: 同步缓存当前资产页摘要，供屏幕知识库和 AI 发送前刷新读取
    // [原因] 同一路由内切换股票区间不会触发路由变化，需要额外暴露页面内部的实时数据
    setCachedAccountingScreenSnapshot({
      activeTab,
      selectedAssetRange,
      selectedSecurity,
      selectedSecurityCandle,
      updatedAt: new Date().toISOString(),
    });
  }, [activeTab, selectedAssetRange, selectedSecurity, selectedSecurityCandle]);

  const availableYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const yearSet = new Set([currentYear - 1, currentYear, currentYear + 1]);

    entries.forEach((entry) => {
      const entryYear = parseEntryDate(entry).getFullYear();

      if (Number.isFinite(entryYear) && entryYear > 1970) {
        yearSet.add(entryYear);
      }
    });

    return Array.from(yearSet).sort((left, right) => right - left);
  }, [entries]);
  // 格式化: 账单列表 → 筛选出所选月份支出并累加 → 月预算已用金额
  // 说明: 预算卡片始终按月计算，避免年账单查询影响预算进度
  const currentBudgetMonthExpense = useMemo(() => {
    return entries.reduce((total, entry) => {
      const parsedDate = parseEntryDate(entry);

      if (
        entry.incomeExpenseType !== '支出' ||
        !isDateInRange(parsedDate, currentMonthRange.start, currentMonthRange.end)
      ) {
        return total;
      }

      return total + (Number(entry.amount) || 0);
    }, 0);
  }, [currentMonthRange.end, currentMonthRange.start, entries]);
  const budgetLeft = monthlyBudget - currentBudgetMonthExpense;
  const currentDateKey = formatDateKey(currentDate);
  const currentMonthRemainingDays = getRemainingDaysInMonth(currentDate);
  // 格式化: 账单列表 → 筛选出当前日期的支出并累加 → 当日支出金额
  // 说明: 用于计算预算卡片中的当日剩余可用
  const todayExpense = useMemo(() => {
    return entries.reduce((total, entry) => {
      if (entry.incomeExpenseType !== '支出') {
        return total;
      }

      return formatDateKey(parseEntryDate(entry)) === currentDateKey
        ? total + (Number(entry.amount) || 0)
        : total;
    }, 0);
  }, [currentDateKey, entries]);
  const dailyAverage = monthlyBudget > 0 ? monthlyBudgetRecord.dailyAverage : 0;
  // [变更] 修改前: “剩余日均”会随预算剩余和当日支出变化
  // [变更] 修改后: “当日日均”每日只在日期变更后刷新一次，当天不再随记账变化
  // [原因] 固定当天可用额度基准，新增“当日剩余可用”承载实时扣减
  const dailyRemainingAvailable = dailyAverage - todayExpense;
  const budgetProgress =
    monthlyBudget > 0 ? Math.min(Math.max(currentBudgetMonthExpense / monthlyBudget, 0), 1) : 0;

  useEffect(() => {
    if (!isAssetSearchModalVisible) {
      return;
    }

    let active = true;

    const syncSecuritySearch = async () => {
      try {
        setIsSearchingSecurities(true);
        setSecuritySearchError('');
        const nextResults = await searchSecurities(assetSearchKeyword);

        if (active) {
          setSecuritySearchResults(nextResults.length > 0 ? nextResults : getFallbackSecurityOptions(assetSearchKeyword));
        }
      } catch {
        if (active) {
          setSecuritySearchError('AkShare 服务不可用，当前展示本地兜底结果');
          setSecuritySearchResults(getFallbackSecurityOptions(assetSearchKeyword));
        }
      } finally {
        if (active) {
          setIsSearchingSecurities(false);
        }
      }
    };

    void syncSecuritySearch();

    return () => {
      active = false;
    };
  }, [assetSearchKeyword, isAssetSearchModalVisible]);

  useEffect(() => {
    if (!selectedSecurity || selectedSecurity.trend[selectedAssetRange].length > 0) {
      return;
    }

    let active = true;

    const syncSelectedSecurityTrend = async () => {
      try {
        setIsLoadingSecurityTrend(true);
        const nextSecurity = await loadSecurityTrend(selectedSecurity, selectedAssetRange);

        if (active) {
          setSelectedSecurity((currentSecurity) => {
            if (!currentSecurity || currentSecurity.code !== nextSecurity.code || currentSecurity.type !== nextSecurity.type) {
              return currentSecurity;
            }

            return mergeSecurityRangeData(currentSecurity, nextSecurity, selectedAssetRange);
          });
        }
      } finally {
        if (active) {
          setIsLoadingSecurityTrend(false);
        }
      }
    };

    void syncSelectedSecurityTrend();

    return () => {
      active = false;
    };
  }, [selectedAssetRange, selectedSecurity]);

  useEffect(() => {
    if (!selectedSecurity) {
      return;
    }

    const missingShortRanges = (['近7日', '近一个月'] as const).filter((range) => (
      range !== selectedAssetRange && selectedSecurity.trend[range].length === 0
    ));
    const nextShortRange = missingShortRanges[0];

    if (!nextShortRange) {
      return;
    }

    let active = true;

    const prefetchSecurityShortRange = async () => {
      try {
        const nextSecurity = await loadSecurityTrend(selectedSecurity, nextShortRange);

        if (!active) {
          return;
        }

        setSelectedSecurity((currentSecurity) => {
          if (!currentSecurity || currentSecurity.code !== nextSecurity.code || currentSecurity.type !== nextSecurity.type) {
            return currentSecurity;
          }

          return mergeSecurityRangeData(currentSecurity, nextSecurity, nextShortRange);
        });
      } catch {
        return;
      }
    };

    void prefetchSecurityShortRange();

    return () => {
      active = false;
    };
  }, [selectedAssetRange, selectedSecurity]);

  useEffect(() => {
    if (monthlyBudget <= 0 || monthlyBudgetRecord.dailyAverageDateKey === currentDateKey) {
      return;
    }

    const nextDailyAverage = budgetLeft / currentMonthRemainingDays;
    const nextBudgetRecord = {
      ...monthlyBudgetRecord,
      dailyAverage: nextDailyAverage,
      dailyAverageDateKey: currentDateKey,
    };

    void saveAccountingMonthlyBudgetRecord(nextBudgetRecord)
      .then(setMonthlyBudgetRecord)
      .catch(() => {
        Alert.alert('更新失败', '当日日均暂未刷新成功，请稍后重试');
      });
  }, [budgetLeft, currentDateKey, currentMonthRemainingDays, monthlyBudget, monthlyBudgetRecord]);

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

  const openAssetModal = () => {
    setAssetInput(String(displayedTotalAsset));
    setAssetInputError('');
    setIsAssetModalVisible(true);
  };

  const closeAssetModal = () => {
    if (isSavingAsset) {
      return;
    }

    setIsAssetModalVisible(false);
  };

  const openAssetSearchModal = () => {
    setAssetSearchKeyword('');
    setIsAssetSearchModalVisible(true);
  };

  const closeAssetSearchModal = () => {
    setIsAssetSearchModalVisible(false);
  };

  const handleSelectAssetRange = (range: AssetRangeLabel) => {
    setSelectedAssetRange(range);
    setSelectedSecurityCandle(null);
  };

  const handleSelectSecurity = async (security: SecuritySearchResult) => {
    setSecurityName(security.name);
    setAssetSearchKeyword('');
    setIsAssetSearchModalVisible(false);
    setSelectedSecurityCandle(null);

    try {
      setIsLoadingSecurityTrend(true);
      const nextSecurity = await loadSecurityTrend(security, selectedAssetRange);
      setSelectedSecurity(nextSecurity);
    } catch {
      const fallbackSecurity = SECURITY_OPTIONS.find(
        (item) => item.code === security.code && item.type === security.type
      );

      if (fallbackSecurity) {
        setSelectedSecurity(fallbackSecurity);
        return;
      }

      Alert.alert('行情加载失败', 'AkShare 服务暂时不可用，请确认本地行情服务已启动');
    } finally {
      setIsLoadingSecurityTrend(false);
    }
  };

  const openBillPeriodModal = (scope: BillQueryScope) => {
    setBillPickerScope(scope);
    setBillPickerYear(currentDate.getFullYear());
    setBillPickerMonth(currentDate.getMonth() + 1);
    setIsBillPeriodModalVisible(true);
  };

  const closeBillPeriodModal = () => {
    setIsBillPeriodModalVisible(false);
  };

  const handleConfirmBillPeriod = () => {
    setBillQueryScope(billPickerScope);
    setCurrentDate(new Date(billPickerYear, billPickerScope === 'month' ? billPickerMonth - 1 : 0, 1));
    setActiveTab('bill');
    setIsBillPeriodModalVisible(false);
  };

  const openHeroImageModal = () => {
    setIsHeroImageModalVisible(true);
  };

  const closeHeroImageModal = () => {
    if (isSavingHeroImage) {
      return;
    }

    setIsHeroImageModalVisible(false);
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
      const nextTotalAsset = await loadAccountingTotalAsset();
      setEntries(nextEntries);
      setTotalAsset(nextTotalAsset);
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

  const handleAssetInputChange = (value: string) => {
    setAssetInput(normalizeAmountInput(value));
    setAssetInputError('');
  };

  const handleSaveAsset = async () => {
    const normalizedInput = assetInput.trim();

    if (!isValidSignedAmountValue(normalizedInput)) {
      setAssetInputError('请输入正确的总资产金额');
      return;
    }

    try {
      setIsSavingAsset(true);
      const nextTotalAsset = await saveAccountingTotalAsset(Number(normalizedInput));
      setTotalAsset(nextTotalAsset);
      setIsAssetModalVisible(false);
    } catch {
      Alert.alert('保存失败', '总资产暂未保存成功，请稍后重试');
    } finally {
      setIsSavingAsset(false);
    }
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

  const saveHeroImageFromPicker = async (asset: {
    uri: string;
    name?: string | null;
    mimeType?: string | null;
    file?: globalThis.File | null;
    base64?: string | null;
  }) => {
    try {
      setIsSavingHeroImage(true);
      const nextHeroImageUri = await persistAccountingHeroImage(asset);
      setHeroImageUri(nextHeroImageUri);
      setIsHeroImageModalVisible(false);
    } catch (error) {
      const isUnsupportedImage = error instanceof Error && error.message === 'UNSUPPORTED_IMAGE_FORMAT';
      Alert.alert(
        isUnsupportedImage ? '图片格式不支持' : '保存失败',
        isUnsupportedImage
          ? '请选择 jpg、png、webp、gif、heic 或 heif 格式的图片'
          : '背景图片暂未保存成功，请稍后重试'
      );
    } finally {
      setIsSavingHeroImage(false);
    }
  };

  const handleOpenGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('无法打开图库', '请允许访问系统图库后再选择背景图片');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: false,
      mediaTypes: ['images'],
      // [变更] 修改前: Web 端只保存 picker 返回的临时 URI
      // [变更] 修改后: Web 端额外请求 base64，并把 file/base64 交给持久化层统一转换
      // [原因] PWA 刷新后 blob 地址会失效，自定义背景图需要保存为可长期复用的数据地址
      base64: Platform.OS === 'web',
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const [asset] = result.assets;
    await saveHeroImageFromPicker({
      uri: asset.uri,
      name: asset.fileName,
      file: asset.file,
      base64: asset.base64,
      mimeType: asset.mimeType,
    });
  };

  const handleOpenFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: 'image/*',
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const [asset] = result.assets;
    await saveHeroImageFromPicker({
      uri: asset.uri,
      name: asset.name,
      file: asset.file,
      base64: asset.base64,
      mimeType: asset.mimeType,
    });
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

      if (!isDateInRange(parsedDate, currentBillRange.start, currentBillRange.end)) {
        return;
      }

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
  }, [currentBillRange.end, currentBillRange.start, entries]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/*
         * 渲染位置: 记账页与资产页安全区和内容区最底层
         * 展示内容: 与资产页一致的整屏纵向渐变背景
         * 数据来源: LinearGradient 固定渐变色配置
         */}
        <LinearGradient
          colors={['#29285B', '#17172E', AppPalette.background]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          pointerEvents="none"
          style={styles.assetGradientBackground}
        />
        <View style={styles.screen}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.scrollContent,
              activeTab === 'asset' && styles.assetScrollContent,
            ]}>
            {activeTab === 'asset' ? (
              <View style={styles.assetPage}>
                <View style={styles.assetHeader}>
                  <Pressable style={styles.iconButton} onPress={() => router.back()}>
                    <MaterialIcons name="arrow-back" size={24} color="#FFFFFF" />
                  </Pressable>
                  <ThemedText style={styles.assetHeaderTitle}>资产</ThemedText>
                  <View style={styles.assetHeaderSpacer} />
                </View>

                <View style={styles.assetOverviewCard}>
                  <View style={styles.assetOverviewHeader}>
                    <View style={styles.assetOverviewTextGroup}>
                      <ThemedText style={styles.assetOverviewTitle}>总资产</ThemedText>
                      <ThemedText style={styles.assetOverviewAmount}>¥{displayedTotalAsset.toFixed(2)}</ThemedText>
                    </View>
                    <View style={styles.assetOverviewActionGroup}>
                      <Pressable style={styles.assetOverviewActionButton} onPress={openHeroImageModal}>
                        <MaterialIcons name="image" size={16} color={AppPalette.brandLight} />
                        <ThemedText style={styles.assetOverviewActionText}>背景</ThemedText>
                      </Pressable>
                      <Pressable style={styles.assetOverviewActionButton} onPress={openAssetModal}>
                        <MaterialIcons name="edit" size={16} color={AppPalette.brandLight} />
                        <ThemedText style={styles.assetOverviewActionText}>设置</ThemedText>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.assetBillLinkRow}>
                    <Pressable style={styles.assetBillLinkButton} onPress={() => openBillPeriodModal('year')}>
                      <ThemedText style={styles.assetBillLinkText}>年账单</ThemedText>
                      <MaterialIcons name="chevron-right" size={18} color={AppPalette.textMuted} />
                    </Pressable>
                    <Pressable style={styles.assetBillLinkButton} onPress={() => openBillPeriodModal('month')}>
                      <ThemedText style={styles.assetBillLinkText}>月账单</ThemedText>
                      <MaterialIcons name="chevron-right" size={18} color={AppPalette.textMuted} />
                    </Pressable>
                  </View>

                  <View style={styles.assetOverviewDivider} />
                  <View style={styles.assetBalanceRow}>
                    <ThemedText style={styles.assetBalanceLabel}>年结余</ThemedText>
                    <ThemedText
                      style={[
                        styles.assetBalanceValue,
                        assetYearBalance < 0 ? styles.assetBalanceNegative : styles.assetBalancePositive,
                      ]}>
                      ¥{assetYearBalance.toFixed(2)}
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.assetMetricCard}>
                  <View style={styles.assetMetricHeader}>
                    <ThemedText style={styles.assetMetricHeaderLabel}>月结余</ThemedText>
                    <ThemedText
                      style={[
                        styles.assetMetricHeaderValue,
                        assetMonthBalance < 0 ? styles.assetBalanceNegative : styles.assetBalancePositive,
                      ]}>
                      ¥{assetMonthBalance.toFixed(2)}
                    </ThemedText>
                  </View>

                  <View style={styles.assetMetricGrid}>
                    <View style={styles.assetMetricStat}>
                      <ThemedText style={styles.assetMetricStatLabel}>当前总账单数</ThemedText>
                      <ThemedText style={styles.assetMetricStatValue}>{entries.length}</ThemedText>
                      <ThemedText style={styles.assetMetricStatUnit}>账单数</ThemedText>
                    </View>
                    <View style={styles.assetMetricStat}>
                      <ThemedText style={styles.assetMetricStatLabel}>记账天数</ThemedText>
                      <ThemedText style={styles.assetMetricStatValue}>{accountingDayCount}</ThemedText>
                      <ThemedText style={styles.assetMetricStatUnit}>天数</ThemedText>
                    </View>
                  </View>
                </View>

                <View style={styles.assetSearchCard}>
                  <ThemedText style={styles.assetSearchTitle}>{securityName}</ThemedText>
                  <Pressable style={styles.assetSearchBox} onPress={openAssetSearchModal}>
                    <MaterialIcons name="search" size={20} color={AppPalette.textMuted} />
                    <ThemedText style={styles.assetSearchPlaceholder}>
                      {selectedSecurity ? `${selectedSecurity.code} · ${selectedSecurity.type}` : '搜索股票/基金'}
                    </ThemedText>
                  </Pressable>
                  <View style={styles.assetRangeRow}>
                    {ASSET_RANGE_OPTIONS.map((option) => (
                      <Pressable
                        key={option}
                        onPress={() => handleSelectAssetRange(option)}
                        style={[
                          styles.assetRangeChip,
                          selectedAssetRange === option && styles.assetRangeChipActive,
                        ]}>
                        <ThemedText
                          style={[
                            styles.assetRangeChipText,
                            selectedAssetRange === option && styles.assetRangeChipTextActive,
                          ]}>
                          {option}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                  {/*
                   * 渲染位置: 资产页股票/基金搜索卡片底部
                   * 展示内容: 当前选中股票/基金的 K 线图和区间价格信息
                   * 数据来源: selectedSecurity、selectedAssetRange、AkShare 行情接口
                   */}
                  {selectedSecurity ? (
                    <View style={styles.assetTrendPanel}>
                      <View style={styles.assetTrendHeader}>
                        <View>
                          <ThemedText style={styles.assetTrendName}>{selectedSecurity.name}</ThemedText>
                          <ThemedText style={styles.assetTrendCode}>
                            {selectedSecurity.type} · {selectedSecurity.code}
                          </ThemedText>
                        </View>
                        <View style={styles.assetTrendPriceGroup}>
                          <ThemedText style={styles.assetTrendPrice}>{selectedSecurityPriceText}</ThemedText>
                          <ThemedText
                            style={[
                              styles.assetTrendRate,
                              selectedSecurityChangeRate < 0
                                ? styles.assetBalanceNegative
                                : styles.assetBalancePositive,
                            ]}>
                            {selectedSecurityChangeRate > 0 ? '+' : ''}
                            {selectedSecurityChangeRate.toFixed(2)}%
                          </ThemedText>
                        </View>
                      </View>
                      <View style={styles.assetTrendChart}>
                        <Svg width="100%" height={STOCK_CHART_HEIGHT} viewBox={`0 0 ${STOCK_CHART_WIDTH} ${STOCK_CHART_HEIGHT}`}>
                          {selectedSecurityKLineShapes.map((candle) => {
                            const candleColor = candle.isRising ? '#DC2626' : '#16A34A';
                            const isSelectedCandle =
                              selectedSecurityCandle?.date === candle.date &&
                              selectedSecurityCandle?.close === candle.close;

                            return (
                              <Fragment key={`${candle.date}-${candle.x}`}>
                                <Rect
                                  x={candle.bodyX - 6}
                                  y={0}
                                  width={candle.bodyWidth + 12}
                                  height={STOCK_CHART_HEIGHT}
                                  fill="transparent"
                                  onPress={() => setSelectedSecurityCandle(candle)}
                                />
                                <Line
                                  x1={candle.x}
                                  x2={candle.x}
                                  y1={candle.highY}
                                  y2={candle.lowY}
                                  stroke={candleColor}
                                  strokeWidth="1.4"
                                  strokeLinecap="round"
                                />
                                <Rect
                                  x={candle.bodyX}
                                  y={candle.bodyTop}
                                  width={candle.bodyWidth}
                                  height={candle.bodyHeight}
                                  rx="1.4"
                                  fill={candleColor}
                                  stroke={isSelectedCandle ? '#0F172A' : candleColor}
                                  strokeWidth={isSelectedCandle ? '1.6' : '0'}
                                  onPress={() => setSelectedSecurityCandle(candle)}
                                />
                              </Fragment>
                            );
                          })}
                        </Svg>
                      </View>
                      {/*
                       * 渲染位置: K 线图下方明细卡
                       * 展示内容: 用户点击某根蜡烛后的日期、开高低收、涨跌额、涨跌幅等行情明细
                       * 数据来源: selectedSecurityCandle，来自 AkShare candles 数据
                       */}
                      {selectedSecurityCandle ? (
                        <View style={styles.assetCandleDetailCard}>
                          <View style={styles.assetCandleDetailHeader}>
                            <ThemedText style={styles.assetCandleDetailTitle}>{selectedSecurityCandle.date}</ThemedText>
                            <ThemedText
                              style={[
                                styles.assetCandleDetailRate,
                                (selectedSecurityCandle.changeRate ?? 0) < 0
                                  ? styles.assetBalanceNegative
                                  : styles.assetBalancePositive,
                              ]}>
                              {formatMarketValue(selectedSecurityCandle.changeRate)}%
                            </ThemedText>
                          </View>
                          <View style={styles.assetCandleDetailGrid}>
                            <ThemedText style={styles.assetCandleDetailText}>
                              开 {formatMarketValue(selectedSecurityCandle.open)}
                            </ThemedText>
                            <ThemedText style={styles.assetCandleDetailText}>
                              收 {formatMarketValue(selectedSecurityCandle.close)}
                            </ThemedText>
                            <ThemedText style={styles.assetCandleDetailText}>
                              高 {formatMarketValue(selectedSecurityCandle.high)}
                            </ThemedText>
                            <ThemedText style={styles.assetCandleDetailText}>
                              低 {formatMarketValue(selectedSecurityCandle.low)}
                            </ThemedText>
                            <ThemedText style={styles.assetCandleDetailText}>
                              涨跌额 {formatMarketValue(selectedSecurityCandle.changeAmount)}
                            </ThemedText>
                            <ThemedText style={styles.assetCandleDetailText}>
                              振幅 {formatMarketValue(selectedSecurityCandle.amplitude)}%
                            </ThemedText>
                            <ThemedText style={styles.assetCandleDetailText}>
                              成交量 {formatLargeMarketValue(selectedSecurityCandle.volume)}
                            </ThemedText>
                            <ThemedText style={styles.assetCandleDetailText}>
                              成交额 {formatLargeMarketValue(selectedSecurityCandle.amount)}
                            </ThemedText>
                          </View>
                        </View>
                      ) : null}
                      <View style={styles.assetTrendFooter}>
                        <ThemedText style={styles.assetTrendFooterText}>
                          {isLoadingSecurityTrend ? 'AkShare 行情加载中...' : `起点 ¥${selectedSecurityTrendStart.toFixed(2)}`}
                        </ThemedText>
                        <ThemedText style={styles.assetTrendFooterText}>
                          终点 ¥{selectedSecurityTrendEnd.toFixed(2)}
                        </ThemedText>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.assetTrendEmpty}>
                      <MaterialIcons name="show-chart" size={26} color="#94A3B8" />
                      <ThemedText style={styles.assetTrendEmptyText}>搜索并选择股票/基金后查看走势图</ThemedText>
                    </View>
                  )}
                </View>
              </View>
            ) : (
              <>
                <View style={styles.header}>
                  <Pressable style={styles.iconButton} onPress={() => router.back()}>
                    <MaterialIcons name="arrow-back" size={24} color={AppPalette.text} />
                  </Pressable>

                  <Pressable style={styles.monthBadge} onPress={() => openBillPeriodModal(billQueryScope)}>
                    <ThemedText style={styles.monthText}>{currentBillPeriodLabel}</ThemedText>
                    <MaterialIcons name="keyboard-arrow-down" size={18} color={AppPalette.text} />
                  </Pressable>

                  <View style={styles.headerActions}>
                    <View style={styles.iconButton}>
                      <MaterialIcons name="calendar-today" size={21} color={AppPalette.text} />
                    </View>
                    <View style={styles.iconButton}>
                      <MaterialIcons name="insert-chart-outlined" size={22} color={AppPalette.text} />
                    </View>
                  </View>
                </View>

                <View style={styles.heroCard}>
                  <Image source={heroImageSource} contentFit="cover" style={styles.heroImage} />
                  <View style={styles.heroOverlay} />

                  <View style={styles.heroContent}>
                    <View style={styles.heroTopRow}>
                      <View>
                        <ThemedText style={styles.heroLabel}>
                          {billQueryScope === 'year' ? '年结余' : '月结余'}
                        </ThemedText>
                        <ThemedText style={styles.heroBalance}>¥{monthlyBalance.toFixed(2)}</ThemedText>
                      </View>

                      {/*
                       * 渲染位置: 顶部背景卡片右上角
                       * 展示内容: 背景设置入口，点击后打开图片来源选择对话框
                       * 数据来源: useState 中的 heroImageUri 与内置 HERO_IMAGE
                       */}
                      <Pressable
                        accessibilityRole="button"
                        disabled={isSavingHeroImage}
                        onPress={openHeroImageModal}
                        style={({ pressed }) => [
                          styles.heroTag,
                          pressed && styles.heroTagPressed,
                          isSavingHeroImage && styles.heroTagDisabled,
                        ]}>
                        <ThemedText style={styles.heroTagText}>背景设置</ThemedText>
                        <MaterialIcons name="chevron-right" size={16} color="#525252" />
                      </Pressable>
                    </View>
                    <View style={styles.heroSummaryRow}>
                      <ThemedText style={styles.heroSummary}>{monthlySummaryText}</ThemedText>
                      <ThemedText style={styles.heroBalance}>{monthlyBalanceText}</ThemedText>
                    </View>
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
                     * 展示内容: 预算剩余额度、当日日均、当日剩余可用以及计算说明入口
                     * 数据来源: monthlyBudgetRecord、currentBudgetMonthExpense、entries、currentDate
                     */}
                    <View style={styles.budgetInfoGroup}>
                      <ThemedText style={styles.mutedText}>剩余:{budgetLeft.toFixed(2)}</ThemedText>
                      <View style={styles.budgetDailyLeftRow}>
                        <ThemedText style={styles.mutedText}>当日日均:{dailyAverage.toFixed(2)}</ThemedText>
                        <Pressable
                          accessibilityLabel="查看当日日均计算逻辑"
                          hitSlop={8}
                          onPress={showBudgetDailyLeftHelp}
                          style={styles.budgetHelpButton}>
                          <ThemedText style={styles.budgetHelpText}>?</ThemedText>
                        </Pressable>
                      </View>
                      <ThemedText style={styles.mutedText}>
                        当日剩余可用:{dailyRemainingAvailable.toFixed(2)}
                      </ThemedText>
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
                    <ThemedText style={styles.emptyBillTitle}>暂无{currentBillPeriodLabel}账单</ThemedText>
                    <ThemedText style={styles.emptyBillText}>
                      点击资产页的年账单或月账单可选择其他时间段查询。
                    </ThemedText>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          <BottomSwitchBar
            leftTab={{
              icon: 'receipt-long',
              label: '账单',
              active: activeTab === 'bill',
              onPress: () => setActiveTab('bill'),
            }}
            rightTab={{
              icon: 'account-balance-wallet',
              label: '资产',
              active: activeTab === 'asset',
              onPress: () => setActiveTab('asset'),
            }}
            onPressAdd={() => router.push('/accounting-entry')}
          />
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
           * 展示内容: 当日日均每日刷新逻辑、当日剩余可用公式以及当前代入值
           * 数据来源: budgetLeft、currentMonthRemainingDays、dailyAverage、todayExpense、dailyRemainingAvailable
           */}
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>当日日均计算逻辑</ThemedText>
            <ThemedText style={styles.modalDescription}>
              当日日均每日只在凌晨后首次打开应用时更新一次，当日后续记账不再改变当日日均。
              {'\n\n'}
              当日日均 = 前一日预算剩余 ÷ 当月剩余日期。
              {'\n\n'}
              当日剩余可用 = 当日日均 - 当日支出。
              {'\n\n'}
              当前当日日均:{dailyAverage.toFixed(2)}
              {'\n'}
              当前当日剩余可用: {dailyAverage.toFixed(2)} - {todayExpense.toFixed(2)} ={' '}
              {dailyRemainingAvailable.toFixed(2)}
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

      <Modal transparent visible={isAssetModalVisible} animationType="fade" onRequestClose={closeAssetModal}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAssetModal} />
          {/*
           * 渲染位置: 资产页中部设置弹层
           * 展示内容: 总资产输入框和保存/取消按钮
           * 数据来源: displayedTotalAsset、assetInput、isSavingAsset
           */}
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>设置总资产</ThemedText>
            <ThemedText style={styles.modalDescription}>
              初始总资产按当前全部账单的收入减支出计算，保存后以手动设置值为准。
            </ThemedText>
            <TextInput
              value={assetInput}
              onChangeText={handleAssetInputChange}
              placeholder="请输入总资产"
              placeholderTextColor="#A3A3A3"
              keyboardType="numbers-and-punctuation"
              style={[styles.budgetInput, assetInputError ? styles.budgetInputError : null]}
            />
            {assetInputError ? (
              <ThemedText style={styles.errorText}>{assetInputError}</ThemedText>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeAssetModal}>
                <ThemedText style={styles.modalCancelText}>取消</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.modalConfirmButton, isSavingAsset && styles.modalButtonDisabled]}
                onPress={() => void handleSaveAsset()}
                disabled={isSavingAsset}>
                <ThemedText style={styles.modalConfirmText}>
                  {isSavingAsset ? '保存中...' : '保存'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={isAssetSearchModalVisible}
        animationType="fade"
        onRequestClose={closeAssetSearchModal}>
        <View style={styles.assetSearchModalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAssetSearchModal} />
          {/*
           * 渲染位置: 资产页居中搜索弹层
           * 展示内容: 股票/基金搜索输入框与候选结果列表，占屏幕高度 60%
           * 数据来源: assetSearchKeyword、filteredSecurityOptions、SECURITY_OPTIONS 常量
           */}
          <View style={styles.assetSearchModalCard}>
            <View style={styles.assetSearchModalHeader}>
              <ThemedText style={styles.assetSearchModalTitle}>搜索股票/基金</ThemedText>
              <Pressable style={styles.assetSearchModalClose} onPress={closeAssetSearchModal}>
                <MaterialIcons name="close" size={20} color="#475569" />
              </Pressable>
            </View>

            <View style={styles.assetSearchModalInputBox}>
              <MaterialIcons name="search" size={20} color="#6B7280" />
              <TextInput
                value={assetSearchKeyword}
                onChangeText={setAssetSearchKeyword}
                autoFocus
                placeholder="输入名称、代码或类型"
                placeholderTextColor="#9CA3AF"
                style={styles.assetSearchInput}
              />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.assetSearchResultList}>
              {isSearchingSecurities ? (
                <ThemedText style={styles.assetSearchEmptyText}>正在从 AkShare 查询...</ThemedText>
              ) : null}
              {securitySearchError ? (
                <ThemedText style={styles.assetSearchEmptyText}>{securitySearchError}</ThemedText>
              ) : null}
              {filteredSecurityOptions.length > 0 ? (
                filteredSecurityOptions.map((security) => (
                  <Pressable
                    key={`${security.type}-${security.code}`}
                    style={styles.assetSearchResultItem}
                    onPress={() => handleSelectSecurity(security)}>
                    <View>
                      <ThemedText style={styles.assetSearchResultName}>{security.name}</ThemedText>
                      <ThemedText style={styles.assetSearchResultMeta}>
                        {security.type} · {security.code}
                      </ThemedText>
                    </View>
                    <ThemedText style={styles.assetSearchResultPrice}>
                      {security.price === null ? '点选查看' : `¥${security.price.toFixed(2)}`}
                    </ThemedText>
                  </Pressable>
                ))
              ) : (
                <View style={styles.assetSearchEmpty}>
                  <MaterialIcons name="search-off" size={26} color="#94A3B8" />
                  <ThemedText style={styles.assetSearchEmptyText}>没有找到匹配的股票/基金</ThemedText>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={isBillPeriodModalVisible}
        animationType="fade"
        onRequestClose={closeBillPeriodModal}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeBillPeriodModal} />
          {/*
           * 渲染位置: 账单查询时间选择弹层
           * 展示内容: 查询类型、年份和月份选项，用于切换到对应时间段账单
           * 数据来源: billPickerScope、billPickerYear、billPickerMonth、availableYearOptions
           */}
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>选择账单时间</ThemedText>
            <View style={styles.pickerScopeRow}>
              <Pressable
                style={[styles.pickerScopeButton, billPickerScope === 'year' && styles.pickerScopeButtonActive]}
                onPress={() => setBillPickerScope('year')}>
                <ThemedText
                  style={[
                    styles.pickerScopeText,
                    billPickerScope === 'year' && styles.pickerScopeTextActive,
                  ]}>
                  年账单
                </ThemedText>
              </Pressable>
              <Pressable
                style={[styles.pickerScopeButton, billPickerScope === 'month' && styles.pickerScopeButtonActive]}
                onPress={() => setBillPickerScope('month')}>
                <ThemedText
                  style={[
                    styles.pickerScopeText,
                    billPickerScope === 'month' && styles.pickerScopeTextActive,
                  ]}>
                  月账单
                </ThemedText>
              </Pressable>
            </View>

            <ThemedText style={styles.pickerSectionTitle}>年份</ThemedText>
            <View style={styles.pickerChipGrid}>
              {availableYearOptions.map((year) => (
                <Pressable
                  key={year}
                  style={[styles.pickerChip, billPickerYear === year && styles.pickerChipActive]}
                  onPress={() => setBillPickerYear(year)}>
                  <ThemedText
                    style={[styles.pickerChipText, billPickerYear === year && styles.pickerChipTextActive]}>
                    {year}年
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            {billPickerScope === 'month' ? (
              <>
                <ThemedText style={styles.pickerSectionTitle}>月份</ThemedText>
                <View style={styles.pickerChipGrid}>
                  {MONTH_OPTIONS.map((month) => (
                    <Pressable
                      key={month}
                      style={[styles.pickerChip, billPickerMonth === month && styles.pickerChipActive]}
                      onPress={() => setBillPickerMonth(month)}>
                      <ThemedText
                        style={[
                          styles.pickerChipText,
                          billPickerMonth === month && styles.pickerChipTextActive,
                        ]}>
                        {month}月
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeBillPeriodModal}>
                <ThemedText style={styles.modalCancelText}>取消</ThemedText>
              </Pressable>
              <Pressable style={styles.modalConfirmButton} onPress={handleConfirmBillPeriod}>
                <ThemedText style={styles.modalConfirmText}>查询</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={isHeroImageModalVisible}
        animationType="fade"
        onRequestClose={closeHeroImageModal}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeHeroImageModal} />
          {/*
           * 渲染位置: 账单页中部背景图设置弹层
           * 展示内容: “更改当前图片”标题，以及取消、打开图库、打开文件三个操作
           * 数据来源: isHeroImageModalVisible、isSavingHeroImage
           */}
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>更改当前图片</ThemedText>
            <View style={styles.heroImageDialogActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeHeroImageModal}>
                <ThemedText style={styles.modalCancelText}>取消</ThemedText>
              </Pressable>
              <View style={styles.heroImageDialogRightActions}>
                <Pressable
                  disabled={isSavingHeroImage}
                  style={[styles.modalConfirmButton, isSavingHeroImage && styles.modalButtonDisabled]}
                  onPress={() => void handleOpenGallery()}>
                  <ThemedText style={styles.modalConfirmText}>打开图库</ThemedText>
                </Pressable>
                <Pressable
                  disabled={isSavingHeroImage}
                  style={[styles.modalConfirmButton, isSavingHeroImage && styles.modalButtonDisabled]}
                  onPress={() => void handleOpenFile()}>
                  <ThemedText style={styles.modalConfirmText}>打开文件</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
