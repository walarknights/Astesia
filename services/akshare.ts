export type AssetRangeLabel = '近7日' | '近一个月' | '近1年';

export type SecurityType = '股票' | '基金';

export type SecuritySearchResult = {
  code: string;
  name: string;
  type: SecurityType;
  price: number | null;
  changeRate: number | null;
};

export type SecurityCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  amount: number | null;
  amplitude: number | null;
  changeRate: number | null;
  changeAmount: number | null;
  turnoverRate: number | null;
};

export type SecurityTrendResult = SecuritySearchResult & {
  trend: Record<AssetRangeLabel, number[]>;
  candles: Record<AssetRangeLabel, SecurityCandle[]>;
};

const AKSHARE_API_HOST = (process.env.EXPO_PUBLIC_AKSHARE_API_HOST ?? 'http://127.0.0.1:8765').replace(/\/$/, '');

async function requestAkShare<T>(endpoint: string) {
  const response = await fetch(`${AKSHARE_API_HOST}${endpoint}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message ?? 'AkShare 服务请求失败');
  }

  return data as T;
}

export async function searchSecurities(keyword: string) {
  const searchParams = new URLSearchParams({
    q: keyword,
    limit: '20',
  });
  const data = await requestAkShare<{ items: SecuritySearchResult[] }>(
    `/api/securities/search?${searchParams.toString()}`
  );

  return data.items;
}

export async function loadSecurityTrend(security: SecuritySearchResult, range: AssetRangeLabel) {
  const searchParams = new URLSearchParams({
    symbol: security.code,
    type: security.type,
    range,
  });
  const data = await requestAkShare<{
    price: number;
    changeRate: number;
    trend: number[];
    candles: SecurityCandle[];
  }>(`/api/securities/trend?${searchParams.toString()}`);

  return {
    ...security,
    price: data.price,
    changeRate: data.changeRate,
    trend: {
      近7日: range === '近7日' ? data.trend : [],
      近一个月: range === '近一个月' ? data.trend : [],
      近1年: range === '近1年' ? data.trend : [],
    },
    candles: {
      近7日: range === '近7日' ? data.candles : [],
      近一个月: range === '近一个月' ? data.candles : [],
      近1年: range === '近1年' ? data.candles : [],
    },
  } satisfies SecurityTrendResult;
}
