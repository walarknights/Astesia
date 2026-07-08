import type { AssetRangeLabel, SecurityCandle, SecurityTrendResult } from '@/services/akshare';

export type AccountingScreenTab = 'bill' | 'asset';

export type AccountingScreenSnapshot = {
  activeTab: AccountingScreenTab;
  selectedAssetRange: AssetRangeLabel;
  selectedSecurity: SecurityTrendResult | null;
  selectedSecurityCandle: SecurityCandle | null;
  updatedAt: string;
};

let cachedAccountingScreenSnapshot: AccountingScreenSnapshot | null = null;

export function getCachedAccountingScreenSnapshot() {
  return cachedAccountingScreenSnapshot;
}

export function setCachedAccountingScreenSnapshot(snapshot: AccountingScreenSnapshot) {
  cachedAccountingScreenSnapshot = snapshot;
}
