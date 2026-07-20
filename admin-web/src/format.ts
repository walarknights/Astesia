/**
 * 将 Token 数量格式化为紧凑展示文本。
 *
 * @param value - 原始 Token 数量
 * @returns 带 K/M/B 单位的展示文本
 * @example
 *   formatTokens(12500) // => '12.5K'
 */
export function formatTokens(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * 将美元数值格式化为管理端费用文案。
 *
 * @param value - 数字或后端返回的数字字符串
 * @param maximumFractionDigits - 最多展示的小数位
 * @returns 美元金额文本
 * @example
 *   formatUsd('1.25') // => '$1.25'
 */
export function formatUsd(value: string | number, maximumFractionDigits = 4) {
  const amount = Number(value);

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/**
 * 将 ISO 时间格式化为中文本地日期时间。
 *
 * @param value - ISO 时间或空值
 * @returns 本地时间文案
 * @example
 *   formatDateTime('2026-07-20T12:00:00.000Z')
 */
export function formatDateTime(value: string | null) {
  if (!value) {
    return '暂无记录';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '暂无记录';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * 根据趋势粒度格式化横轴日期。
 *
 * @param value - 周期起始时间
 * @param granularity - 日、周或月粒度
 * @returns 趋势横轴文案
 * @example
 *   formatTrendDate('2026-07-20T00:00:00.000Z', 'daily')
 */
export function formatTrendDate(
  value: string,
  granularity: 'daily' | 'weekly' | 'monthly',
) {
  const date = new Date(value);

  if (granularity === 'monthly') {
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

export function getInitials(value: string) {
  const normalizedValue = value.trim();
  return Array.from(normalizedValue || 'A').slice(0, 2).join('').toUpperCase();
}
