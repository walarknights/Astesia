import { getCachedWeatherDashboard } from '@/services/weather-dashboard-store';
import {
  getCachedAccountingScreenSnapshot,
  type AccountingScreenSnapshot,
} from '@/services/accounting-screen-store';
import {
  loadAccountingEntries,
  loadAccountingMonthlyBudget,
  loadAccountingTotalAsset,
  type AccountingEntryRecord,
} from '@/services/accounting-entry-storage';
import type { AssetRangeLabel, SecurityCandle, SecurityTrendResult } from '@/services/akshare';
import { getNoteImageCount, getNotePlainText, loadNoteById, loadNotes, type NoteRecord } from '@/services/notes-storage';
import { loadTodos, type TodoRecord } from '@/services/todo-storage';

export type AiScreenKnowledgeSnapshot = {
  route: string;
  summary: string;
  source: 'route-data' | 'fallback' | 'user-edited';
  updatedAt: string;
};

export type AiScreenKnowledgeParams = Record<string, string | string[] | undefined>;

const EMPTY_SCREEN_SUMMARY = '当前页面暂未接入专属内容读取，已读取页面路径，可继续根据用户输入回答。';
const MAX_SUMMARY_LINES = 18;
const MAX_NOTES = 6;
const MAX_TODOS = 8;
const MAX_ACCOUNTING_ENTRIES = 8;
const MAX_TEXT_LENGTH = 80;

/**
 * 读取当前路由对应的页面文字上下文，优先使用页面背后的业务数据做稳定降级。
 *
 * @param route - expo-router 当前路径
 * @param params - 当前路由参数，用于读取笔记详情或账单编辑详情
 * @returns 可注入 AI 请求的屏幕知识快照
 * @example
 *   buildAiScreenKnowledge('/notes', {})
 */
export async function buildAiScreenKnowledge(
  route: string,
  params: AiScreenKnowledgeParams = {}
): Promise<AiScreenKnowledgeSnapshot> {
  const normalizedRoute = normalizeRoute(route);
  const summary = await resolveRouteSummary(normalizedRoute, params);

  return {
    route: normalizedRoute,
    summary,
    source: summary === EMPTY_SCREEN_SUMMARY ? 'fallback' : 'route-data',
    updatedAt: new Date().toISOString(),
  };
}

async function resolveRouteSummary(route: string, params: AiScreenKnowledgeParams) {
  if (route === '/' || route === '/weather-overview') {
    return buildWeatherSummary();
  }

  if (route === '/notes') {
    return buildNotesSummary();
  }

  if (route === '/note-editor') {
    return buildNoteEditorSummary(readStringParam(params.noteId));
  }

  if (route === '/todo') {
    return buildTodoSummary();
  }

  if (route === '/accounting') {
    return buildAccountingSummary();
  }

  if (route === '/accounting-entry') {
    return buildAccountingEntrySummary(readStringParam(params.entryId));
  }

  return EMPTY_SCREEN_SUMMARY;
}

function buildWeatherSummary() {
  const dashboard = getCachedWeatherDashboard();

  if (!dashboard) {
    return '首页天气数据仍在加载或尚未缓存。当前可见模块包含天气卡片、今日天气概览入口、笔记与记账入口。';
  }

  const current = dashboard.current;
  const lines = [
    `当前页面：首页 / 天气概览。`,
    `城市：${current.city}，天气：${current.weatherLabel}，温度：${current.temperature}，${current.highLow}。`,
    `湿度与风力：${current.humidity}，${current.wind}。`,
    `天气建议：${current.suggestion}`,
  ];

  if (dashboard.dailyForecasts.length > 0) {
    lines.push('近7日天气：');
    // 格式化: DailyTemperatureSnapshot[] → 逐天拼接为“日期/天气/高低温”摘要行 → 屏幕知识库中的近 7 日天气文本
    // 说明: 让 AI 在天气页能够读到未来一周预报，而不是只看到实时天气
    lines.push(...dashboard.dailyForecasts.slice(0, 7).map((item, index) => (
      `${index + 1}. ${item.dayLabel}（${item.date}）：${item.textDay}，最高 ${item.tempMax}°，最低 ${item.tempMin}°。`
    )));
  }

  if (dashboard.airQuality) {
    lines.push(`空气质量：AQI ${dashboard.airQuality.aqi}，${dashboard.airQuality.category}，首要污染物 ${dashboard.airQuality.primaryPollutant || '暂无'}。`);
  }

  if (dashboard.alerts.length > 0) {
    lines.push(`天气预警：${dashboard.alerts.slice(0, 3).map((alert) => alert.headline).join('；')}。`);
  }

  if (dashboard.indices.length > 0) {
    lines.push(`生活指数：${dashboard.indices.slice(0, 4).map((item) => `${item.name}${item.category}`).join('；')}。`);
  }

  if (dashboard.minutely) {
    lines.push(`分钟降水：${dashboard.minutely.summary}`);
  }

  return limitSummary(lines);
}

async function buildNotesSummary() {
  const notes = await loadNotes();

  if (notes.length === 0) {
    return '当前页面：笔记列表。页面显示空状态“写下第一条笔记”，支持创建正文文本和相册图片笔记。';
  }

  const lines = [
    `当前页面：笔记列表。共 ${notes.length} 条笔记，列表按最近编辑优先展示。`,
    ...notes.slice(0, MAX_NOTES).map((note, index) => formatNoteLine(note, index + 1)),
  ];

  return limitSummary(lines);
}

async function buildNoteEditorSummary(noteId: string) {
  if (!noteId) {
    return '当前页面：新建笔记编辑器。可见内容包括标题输入框、富文本编辑器、插图按钮和保存按钮；当前笔记尚未保存。';
  }

  const note = await loadNoteById(noteId);

  if (!note) {
    return `当前页面：笔记编辑器。路由携带 noteId=${noteId}，但本地未找到对应笔记。`;
  }

  return limitSummary([
    '当前页面：编辑已有笔记。',
    `标题：${note.title || '未命名笔记'}`,
    `正文：${truncateText(getNotePlainText(note) || '暂无纯文本正文')}`,
    `图片数量：${getNoteImageCount(note)}`,
    `最近编辑：${formatDateTime(note.updatedAt)}`,
  ]);
}

async function buildTodoSummary() {
  const todos = await loadTodos();
  const activeTodos = todos.filter((todo) => !todo.completedAt);
  const completedTodos = todos.filter((todo) => todo.completedAt);

  if (todos.length === 0) {
    return '当前页面：待办列表。页面显示空状态，可新增待办、设置提醒时间和重复规则。';
  }

  const lines = [
    `当前页面：待办列表。未完成 ${activeTodos.length} 条，已完成 ${completedTodos.length} 条。`,
    ...activeTodos.slice(0, MAX_TODOS).map((todo, index) => formatTodoLine(todo, index + 1)),
  ];

  if (completedTodos.length > 0) {
    lines.push(`最近完成：${completedTodos.slice(0, 3).map((todo) => todo.title || '未命名待办').join('；')}。`);
  }

  return limitSummary(lines);
}

async function buildAccountingSummary() {
  const [entries, budget, totalAsset] = await Promise.all([
    loadAccountingEntries(),
    loadAccountingMonthlyBudget(),
    loadAccountingTotalAsset(),
  ]);
  const accountingScreenSnapshot = getCachedAccountingScreenSnapshot();
  const incomeTotal = sumAccountingEntries(entries, '收入');
  const expenseTotal = sumAccountingEntries(entries, '支出');
  const displayedTotalAsset = totalAsset ?? incomeTotal - expenseTotal;

  if (accountingScreenSnapshot?.activeTab === 'asset') {
    const lines = [
      '当前页面：资产页。',
      `总资产：${formatAmount(displayedTotalAsset)}。`,
      `资产概览：共 ${entries.length} 条账单，累计收入 ${formatAmount(incomeTotal)}，累计支出 ${formatAmount(expenseTotal)}，净额 ${formatAmount(incomeTotal - expenseTotal)}。`,
      ...buildAccountingAssetTrendLines(accountingScreenSnapshot),
    ];

    return limitSummary(lines);
  }

  const lines = [
    `当前页面：记账列表。共 ${entries.length} 条账单。`,
    `收支概览：收入 ${formatAmount(incomeTotal)}，支出 ${formatAmount(expenseTotal)}，净额 ${formatAmount(incomeTotal - expenseTotal)}。`,
    `预算：${budget.monthLabel} 月预算 ${formatAmount(budget.amount)}，日均可用 ${formatAmount(budget.dailyAverage)}。`,
    `总资产：${formatAmount(displayedTotalAsset)}。`,
    ...entries.slice(0, MAX_ACCOUNTING_ENTRIES).map((entry, index) => formatAccountingEntryLine(entry, index + 1)),
  ];

  return limitSummary(lines);
}

async function buildAccountingEntrySummary(entryId: string) {
  if (!entryId) {
    return '当前页面：账单录入。可见字段包括收支类型、账单类型、金额、日期、时间、备注和保存按钮；当前为新增账单模式。';
  }

  const entries = await loadAccountingEntries();
  const entry = entries.find((item) => item.id === entryId);

  if (!entry) {
    return `当前页面：账单编辑。路由携带 entryId=${entryId}，但本地未找到对应账单。`;
  }

  return limitSummary([
    '当前页面：编辑已有账单。',
    `账单：${entry.incomeExpenseType} / ${entry.billType} / ${formatAmount(Number(entry.amount) || 0)}。`,
    `时间：${entry.time}`,
    `备注：${entry.remark || '无'}`,
  ]);
}

function formatNoteLine(note: NoteRecord, index: number) {
  const title = note.title || '未命名笔记';
  const plainText = getNotePlainText(note) || '图片笔记或暂无正文';
  const imageCount = getNoteImageCount(note);

  return `${index}. ${title}：${truncateText(plainText)}${imageCount > 0 ? `（含 ${imageCount} 张图片）` : ''}`;
}

function formatTodoLine(todo: TodoRecord, index: number) {
  const reminderText = todo.reminderAt
    ? `，提醒 ${formatDateTime(todo.reminderAt)}${todo.repeat !== 'none' ? `，${formatRepeat(todo.repeat)}` : ''}`
    : '，无提醒';

  return `${index}. ${todo.title || '未命名待办'}${reminderText}`;
}

function formatAccountingEntryLine(entry: AccountingEntryRecord, index: number) {
  const remark = entry.remark ? `，备注：${truncateText(entry.remark, 28)}` : '';

  return `${index}. ${entry.time} ${entry.incomeExpenseType} ${entry.billType} ${formatAmount(Number(entry.amount) || 0)}${remark}`;
}

function sumAccountingEntries(entries: AccountingEntryRecord[], type: AccountingEntryRecord['incomeExpenseType']) {
  return entries
    .filter((entry) => entry.incomeExpenseType === type)
    .reduce((total, entry) => total + (Number(entry.amount) || 0), 0);
}

/**
 * 将资产页当前选中标的转换为屏幕知识库可读的走势摘要。
 *
 * @param {AccountingScreenSnapshot} snapshot - 资产页当前缓存快照
 * @returns {string[]} 股票/基金走势描述行
 * @example
 *   buildAccountingAssetTrendLines(snapshot)
 */
function buildAccountingAssetTrendLines(snapshot: AccountingScreenSnapshot) {
  if (!snapshot.selectedSecurity) {
    return ['股票/基金走势：尚未选择标的，页面提示“搜索并选择股票/基金后查看走势图”。'];
  }

  const security = snapshot.selectedSecurity;
  const currentRangePoints = buildSecurityTrendPoints(security, snapshot.selectedAssetRange);
  const latestPrice = currentRangePoints[currentRangePoints.length - 1]?.close ?? security.price ?? 0;
  const firstPrice = currentRangePoints[0]?.close ?? latestPrice;
  const currentRangeChangeRate = firstPrice > 0
    ? ((latestPrice - firstPrice) / firstPrice) * 100
    : security.changeRate ?? 0;
  const summaryRanges = Array.from(new Set<AssetRangeLabel>([
    snapshot.selectedAssetRange,
    '近7日',
    '近一个月',
  ])).filter((range) => buildSecurityTrendPoints(security, range).length > 0);

  // 格式化: 可用区间 + 区间内的收盘点位 → 走势序列文案 → 股票/基金折线摘要
  // 说明: 把资产页图表里的线性走势转成 AI 能直接读取的文本，而不是只保留起点和终点
  const rangeLines = summaryRanges.map((range) => {
    const points = buildSecurityTrendPoints(security, range);
    const maxPoints = range === '近7日' ? 7 : range === '近一个月' ? 6 : 8;
    const lineLabel = points.length > maxPoints ? '走势采样' : '走势';

    return `${range}${lineLabel}：${formatSecurityTrendSequence(points, maxPoints)}。`;
  });

  const lines = [
    `当前标的：${security.name}（${security.type} ${security.code}），当前查看 ${snapshot.selectedAssetRange}，最新价 ${formatAmount(latestPrice)}，区间涨跌 ${formatSignedPercent(currentRangeChangeRate)}。`,
    ...rangeLines,
  ];

  if (snapshot.selectedSecurityCandle) {
    lines.push(
      `当前点选 K 线：${formatSecurityTrendLabel(snapshot.selectedSecurityCandle.date)}，开 ${formatAmount(snapshot.selectedSecurityCandle.open)}，收 ${formatAmount(snapshot.selectedSecurityCandle.close)}，高 ${formatAmount(snapshot.selectedSecurityCandle.high)}，低 ${formatAmount(snapshot.selectedSecurityCandle.low)}。`
    );
  }

  return lines;
}

/**
 * 将证券的指定区间走势转换为带标签的收盘价点位。
 *
 * @param {SecurityTrendResult} security - 当前选中的股票或基金
 * @param {AssetRangeLabel} range - 目标区间
 * @returns {Array<{ label: string; close: number }>} 可用于拼接走势文案的点位
 * @example
 *   buildSecurityTrendPoints(security, '近7日')
 */
function buildSecurityTrendPoints(security: SecurityTrendResult, range: AssetRangeLabel) {
  const candles = security.candles[range].length > 0
    ? security.candles[range]
    : buildFallbackSecurityCandles(security.trend[range]);

  return candles.map((candle, index) => ({
    label: formatSecurityTrendLabel(candle.date, index),
    close: candle.close,
  }));
}

/**
 * 在缺少真实 K 线时，用收盘价序列补出基础点位，保证知识库仍能描述折线走势。
 *
 * @param {readonly number[]} values - 收盘价或净值序列
 * @returns {SecurityCandle[]} 兜底生成的 K 线数组
 * @example
 *   buildFallbackSecurityCandles([1, 2])
 */
function buildFallbackSecurityCandles(values: readonly number[]): SecurityCandle[] {
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
 * 将点位数组压缩成适合屏幕知识库的折线文本。
 *
 * @param {Array<{ label: string; close: number }>} points - 带标签的收盘价点位
 * @param {number} maxPoints - 最多保留的点位数量
 * @returns {string} 文本化后的走势序列
 * @example
 *   formatSecurityTrendSequence([{ label: '07-01', close: 1.23 }], 6)
 */
function formatSecurityTrendSequence(points: Array<{ label: string; close: number }>, maxPoints: number) {
  return sampleSecurityTrendPoints(points, maxPoints)
    .map((point) => `${point.label} ${point.close.toFixed(2)}`)
    .join(' -> ');
}

/**
 * 对较长的证券走势做等距抽样，避免一月或一年数据把知识库挤满。
 *
 * @param {Array<{ label: string; close: number }>} points - 原始点位
 * @param {number} maxPoints - 最多保留的点位数量
 * @returns {Array<{ label: string; close: number }>} 抽样后的点位
 * @example
 *   sampleSecurityTrendPoints(points, 6)
 */
function sampleSecurityTrendPoints(points: Array<{ label: string; close: number }>, maxPoints: number) {
  if (points.length <= maxPoints) {
    return points;
  }

  const sampledIndexes = Array.from(new Set(Array.from({ length: maxPoints }, (_item, index) => (
    Math.round((index * (points.length - 1)) / Math.max(maxPoints - 1, 1))
  ))));

  return sampledIndexes.map((index) => points[index]).filter(Boolean);
}

/**
 * 规范化证券图表上的日期标签，尽量保留月日信息。
 *
 * @param {string} value - 原始日期或点位标签
 * @param {number} index - 当前点位索引
 * @returns {string} 适合摘要展示的短标签
 * @example
 *   formatSecurityTrendLabel('2026-07-07')
 */
function formatSecurityTrendLabel(value: string, index = 0) {
  const normalizedValue = value.trim();
  const matchedDate = normalizedValue.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);

  if (matchedDate) {
    const [, _year, month, day] = matchedDate;
    return `${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  if (normalizedValue) {
    return normalizedValue;
  }

  return String(index + 1);
}

/**
 * 把涨跌幅格式化成带正负号的百分比文案。
 *
 * @param {number} value - 原始涨跌幅
 * @returns {string} 百分比字符串
 * @example
 *   formatSignedPercent(1.25) // => '+1.25%'
 */
function formatSignedPercent(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function readStringParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return typeof value === 'string' ? value : '';
}

function normalizeRoute(route: string) {
  const normalizedRoute = route.trim() || '/';

  return normalizedRoute.replace(/\/+$/, '') || '/';
}

function truncateText(value: string, maxLength = MAX_TEXT_LENGTH) {
  const normalizedText = value.replace(/\s+/g, ' ').trim();

  if (normalizedText.length <= maxLength) {
    return normalizedText;
  }

  return `${normalizedText.slice(0, maxLength)}...`;
}

function limitSummary(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SUMMARY_LINES)
    .join('\n');
}

function formatAmount(value: number) {
  return `¥${value.toFixed(2)}`;
}

function formatRepeat(repeat: TodoRecord['repeat']) {
  if (repeat === 'daily') {
    return '每天重复';
  }

  if (repeat === 'weekly') {
    return '每周重复';
  }

  return '不重复';
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}`;
}
