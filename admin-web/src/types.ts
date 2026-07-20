export type AdminView = 'overview' | 'users' | 'models';
export type TrendGranularity = 'daily' | 'weekly' | 'monthly';
export type TrendMetric = 'tokens' | 'cost' | 'requests';

export type AdminUserProfile = {
  userId: string;
  email: string;
  name: string;
  role: string;
  planName: string;
};

export type AdminSession = {
  token: string;
  user: AdminUserProfile;
};

export type UsageUser = {
  userId: string;
  email: string;
  displayName: string;
  requestCount: number;
  totalTokens: number;
  totalCostUsd: string;
  lastUsedAt: string | null;
};

export type UsageModel = {
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCostUsd: string;
  lastUsedAt: string | null;
  activeUsers?: number;
};

export type TrendPoint = {
  periodStart: string;
  requestCount: number;
  totalTokens: number;
  totalCostUsd: string;
};

export type Statistics = {
  generatedAt: string;
  currency: 'USD';
  totals: {
    activeUsers: number;
    requests: number;
    tokens: number;
    costUsd: string;
  };
  users: UsageUser[];
  models: UsageModel[];
  modelHighlights: {
    mostTokens: UsageModel | null;
    highestCost: UsageModel | null;
  };
  trends: Record<TrendGranularity, TrendPoint[]>;
  top: {
    usersByCost: UsageUser[];
    usersByTokens: UsageUser[];
    modelsByCost: UsageModel[];
    modelsByTokens: UsageModel[];
  };
};

export type AdminUser = UsageUser & {
  role: string;
  planName: string;
  quotaLimitUsd: string;
  balanceUsd: string;
  totalChargedUsd: string;
  activeReservedUsd: string;
  createdAt: string;
  updatedAt: string;
};

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ModelControl = {
  model: string;
  enabled: boolean;
  pricing: {
    inputPerMillionUsd: string;
    cachedInputPerMillionUsd: string;
    outputPerMillionUsd: string;
  };
  updatedBy: string | null;
  updatedAt: string | null;
};
