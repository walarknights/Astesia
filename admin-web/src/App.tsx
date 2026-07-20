import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ApiError,
  clearAdminSession,
  getAdminSession,
  getModelControls,
  getStatistics,
  getUsers,
  loadAdminSession,
  loginAdmin,
  updateModelControl,
  updateUserQuota,
} from './api';
import { formatDateTime, formatTokens, formatTrendDate, formatUsd, getInitials } from './format';
import styles from './App.module.scss';
import type {
  AdminSession,
  AdminUser,
  AdminView,
  ModelControl,
  Statistics,
  TrendGranularity,
  TrendMetric,
  TrendPoint,
} from './types';

const VIEW_TITLES: Record<AdminView, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: 'OPERATIONS OVERVIEW',
    title: 'AI 运营总览',
    description: '追踪用户、模型与费用趋势，快速识别消耗异常。',
  },
  users: {
    eyebrow: 'USER GOVERNANCE',
    title: '用户与额度',
    description: '查看全量用户用量，并以美元额度控制 AI 服务访问。',
  },
  models: {
    eyebrow: 'MODEL ACCESS',
    title: '模型白名单',
    description: '统一管理可用模型与计费单价，停用后立即阻断新请求。',
  },
};

const METRIC_ACCENT_CLASSES = {
  violet: styles.metricCardViolet,
  cyan: styles.metricCardCyan,
  blue: styles.metricCardBlue,
  green: styles.metricCardGreen,
} as const;

const ICON_PATHS = {
  overview: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-11h6V4h-6v5Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87m0-7.26a4 4 0 0 1 0 7.75',
  models: 'M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  refresh: 'M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5m-5 4a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5',
  logout: 'M10 17l5-5-5-5m5 5H3m9-9h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6',
  search: 'm21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z',
  close: 'M18 6 6 18M6 6l12 12',
  arrowLeft: 'm15 18-6-6 6-6',
  arrowRight: 'm9 18 6-6-6-6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4',
  trend: 'm3 17 6-6 4 4 8-8m-5 0h5v5',
} as const;

type IconName = keyof typeof ICON_PATHS;

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(() => loadAdminSession());
  const [isVerifying, setIsVerifying] = useState(Boolean(session));

  useEffect(() => {
    if (!session) {
      setIsVerifying(false);
      return;
    }

    let isActive = true;
    setIsVerifying(true);

    void getAdminSession(session)
      .catch(() => {
        if (isActive) {
          clearAdminSession();
          setSession(null);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsVerifying(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [session]);

  if (isVerifying) {
    return <LoadingScreen />;
  }

  if (!session) {
    return <LoginPage onLogin={setSession} />;
  }

  return (
    <>
      {/*
       * 渲染位置: 管理端应用根节点
       * 展示内容: 已登录管理员的导航、页面内容与退出入口
       * 数据来源: 服务端校验通过的 session 状态
       */}
      <AdminShell
        session={session}
        onLogout={() => {
          clearAdminSession();
          setSession(null);
        }}
      />
    </>
  );
}

function LoadingScreen() {
  return (
    <main className={styles.loadingScreen}>
      {/*
       * 渲染位置: 管理端会话校验阶段
       * 展示内容: Astesia 标识与会话校验进度
       * 数据来源: App 的 isVerifying 状态
       */}
      <BrandMark size="large" />
      <div className={styles.loader} aria-label="正在校验管理员会话" />
      <p>正在建立安全会话</p>
    </main>
  );
}

function LoginPage({ onLogin }: { onLogin: (session: AdminSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      onLogin(await loginAdmin(email, password));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.loginPage}>
      {/*
       * 渲染位置: 管理端未登录首页
       * 展示内容: 产品说明、权限提示与管理员邮箱密码登录表单
       * 数据来源: 登录表单 useState 与 /api/auth/login 响应
       */}
      <section className={styles.loginIntro}>
        <div className={styles.loginBrand}>
          <BrandMark size="large" />
          <span>Astesia</span>
        </div>
        <div className={styles.loginCopy}>
          <span className={styles.eyebrow}>AI OPERATIONS CENTER</span>
          <h1>看清每一次调用，<br />控制每一分消耗。</h1>
          <p>独立的 AI 运营控制台，为额度、模型与成本提供实时可见性。</p>
        </div>
        <div className={styles.loginSignal}>
          <span className={styles.signalDot} />
          服务端权限校验已启用
        </div>
      </section>

      <section className={styles.loginPanel}>
        <form className={styles.loginCard} onSubmit={handleSubmit}>
          <div className={styles.loginCardHeader}>
            <div className={styles.shieldBadge}><Icon name="shield" /></div>
            <span className={styles.eyebrow}>ADMIN ACCESS</span>
            <h2>管理员登录</h2>
            <p>仅数据库角色为 admin 的账号可以进入。</p>
          </div>

          <label className={styles.field}>
            <span>管理员邮箱</span>
            <input
              autoComplete="username"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
            />
          </label>

          <label className={styles.field}>
            <span>登录密码</span>
            <input
              autoComplete="current-password"
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入账号密码"
              required
              type="password"
              value={password}
            />
          </label>

          {errorMessage ? <InlineAlert message={errorMessage} /> : null}

          <button className={styles.primaryButton} disabled={isSubmitting} type="submit">
            {isSubmitting ? '正在校验身份...' : '进入控制台'}
          </button>
          <p className={styles.loginSecurity}>登录后仍会由服务端实时校验管理员角色。</p>
        </form>
      </section>
    </main>
  );
}

function AdminShell({
  session,
  onLogout,
}: {
  session: AdminSession;
  onLogout: () => void;
}) {
  const [view, setView] = useState<AdminView>(() => readViewFromUrl());
  const pageMeta = VIEW_TITLES[view];

  function changeView(nextView: AdminView) {
    setView(nextView);
    writeUrlState({ view: nextView });
  }

  return (
    <div className={styles.appShell}>
      {/*
       * 渲染位置: 登录后管理端整体框架
       * 展示内容: 左侧功能导航、管理员资料和当前业务页面
       * 数据来源: URL view 参数与已验证 session
       */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <BrandMark />
          <div>
            <strong>Astesia</strong>
            <span>Admin Console</span>
          </div>
        </div>

        <nav className={styles.nav} aria-label="管理端主导航">
          {/*
           * 渲染位置: 管理端左侧导航
           * 展示内容: 总览、用户与模型白名单入口
           * 数据来源: VIEW_TITLES 常量与当前 view 状态
           */}
          {(['overview', 'users', 'models'] as AdminView[]).map((item) => (
            <button
              className={item === view ? styles.navItemActive : styles.navItem}
              key={item}
              onClick={() => changeView(item)}
              type="button"
            >
              <Icon name={item} />
              <span>{VIEW_TITLES[item].title}</span>
              {item === view ? <i /> : null}
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.adminIdentity}>
            <span className={styles.avatar}>{getInitials(session.user.name)}</span>
            <div>
              <strong>{session.user.name}</strong>
              <span>{session.user.email}</span>
            </div>
          </div>
          <button aria-label="退出管理员账号" className={styles.iconButton} onClick={onLogout} type="button">
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <main className={styles.mainContent}>
        <header className={styles.pageHeader}>
          <div>
            <span className={styles.eyebrow}>{pageMeta.eyebrow}</span>
            <h1>{pageMeta.title}</h1>
            <p>{pageMeta.description}</p>
          </div>
          <div className={styles.headerStatus}>
            <span className={styles.signalDot} />
            实时服务
          </div>
        </header>

        {view === 'overview' ? <OverviewPage session={session} /> : null}
        {view === 'users' ? <UsersPage session={session} /> : null}
        {view === 'models' ? <ModelsPage session={session} /> : null}
      </main>
    </div>
  );
}

function OverviewPage({ session }: { session: AdminSession }) {
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [granularity, setGranularity] = useState<TrendGranularity>(() => readTrendFromUrl());
  const [metric, setMetric] = useState<TrendMetric>(() => readMetricFromUrl());

  const loadStatistics = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      setStatistics(await getStatistics(session));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadStatistics();
  }, [loadStatistics]);

  const rankingGroups = useMemo(() => {
    if (!statistics) {
      return [];
    }

    // 格式化: 用户/模型 Top 数据 → 截取前 5 名并补充展示字段 → 排行榜卡片数据
    // 说明: 总览保持高信号密度，完整用户数据由“用户与额度”页面承载
    return [
      {
        title: '高费用用户',
        caption: '按累计费用',
        items: statistics.top.usersByCost.slice(0, 5).map((user) => ({
          key: user.userId,
          title: user.displayName || user.email,
          subtitle: user.email,
          value: formatUsd(user.totalCostUsd),
        })),
      },
      {
        title: '高消耗模型',
        caption: '按 Token',
        items: statistics.top.modelsByTokens.slice(0, 5).map((model) => ({
          key: model.model,
          title: model.model,
          subtitle: `${model.requestCount} 次请求`,
          value: formatTokens(model.totalTokens),
        })),
      },
    ];
  }, [statistics]);

  if (isLoading && !statistics) {
    return <SectionLoader label="正在汇总 AI 用量" />;
  }

  if (errorMessage && !statistics) {
    return <ErrorState message={errorMessage} onRetry={loadStatistics} />;
  }

  if (!statistics) {
    return null;
  }

  return (
    <section className={styles.pageBody}>
      {/*
       * 渲染位置: AI 运营总览页面
       * 展示内容: 核心指标、趋势图、模型亮点和消耗排行榜
       * 数据来源: /api/admin/ai/statistics 响应
       */}
      <div className={styles.toolbar}>
        <span>数据更新于 {formatDateTime(statistics.generatedAt)}</span>
        <button className={styles.secondaryButton} disabled={isLoading} onClick={loadStatistics} type="button">
          <Icon name="refresh" />
          {isLoading ? '刷新中' : '刷新数据'}
        </button>
      </div>

      {errorMessage ? <InlineAlert message={errorMessage} /> : null}

      <div className={styles.metricGrid}>
        <MetricCard
          accent="violet"
          label="累计 Token"
          note="所有模型总计"
          value={formatTokens(statistics.totals.tokens)}
        />
        <MetricCard
          accent="cyan"
          label="累计费用"
          note="按真实 usage 结算"
          value={formatUsd(statistics.totals.costUsd)}
        />
        <MetricCard
          accent="blue"
          label="请求次数"
          note="已完成计费请求"
          value={statistics.totals.requests.toLocaleString('zh-CN')}
        />
        <MetricCard
          accent="green"
          label="活跃用户"
          note="产生过 AI 用量"
          value={statistics.totals.activeUsers.toLocaleString('zh-CN')}
        />
      </div>

      <div className={styles.overviewGrid}>
        <article className={styles.chartCard}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.cardKicker}>USAGE TREND</span>
              <h2>消耗趋势</h2>
            </div>
            <div className={styles.segmented}>
              {/*
               * 渲染位置: 趋势卡片右上角
               * 展示内容: 日、周、月聚合粒度切换
               * 数据来源: granularity 状态
               */}
              {(['daily', 'weekly', 'monthly'] as TrendGranularity[]).map((item) => (
                <button
                  className={granularity === item ? styles.segmentActive : ''}
                  key={item}
                  onClick={() => {
                    setGranularity(item);
                    writeUrlState({ trend: item });
                  }}
                  type="button"
                >
                  {{ daily: '日', weekly: '周', monthly: '月' }[item]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.metricTabs}>
            {/*
             * 渲染位置: 趋势图上方指标切换区
             * 展示内容: Token、费用与请求数三个趋势指标
             * 数据来源: metric 状态
             */}
            {(['tokens', 'cost', 'requests'] as TrendMetric[]).map((item) => (
              <button
                className={metric === item ? styles.metricTabActive : styles.metricTab}
                key={item}
                onClick={() => {
                  setMetric(item);
                  writeUrlState({ metric: item });
                }}
                type="button"
              >
                {{ tokens: 'Token', cost: '费用', requests: '请求数' }[item]}
              </button>
            ))}
          </div>

          <TrendChart
            granularity={granularity}
            metric={metric}
            points={statistics.trends[granularity]}
          />
        </article>

        <article className={styles.highlightCard}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.cardKicker}>MODEL SIGNAL</span>
              <h2>模型焦点</h2>
            </div>
            <span className={styles.orbIcon}><Icon name="trend" /></span>
          </div>
          <ModelHighlight
            label="Token 消耗最高"
            model={statistics.modelHighlights.mostTokens}
            primaryValue={statistics.modelHighlights.mostTokens
              ? formatTokens(statistics.modelHighlights.mostTokens.totalTokens)
              : '暂无数据'}
          />
          <ModelHighlight
            label="费用最高"
            model={statistics.modelHighlights.highestCost}
            primaryValue={statistics.modelHighlights.highestCost
              ? formatUsd(statistics.modelHighlights.highestCost.totalCostUsd)
              : '暂无数据'}
          />
        </article>
      </div>

      <div className={styles.rankingGrid}>
        {/*
         * 渲染位置: 总览页面底部
         * 展示内容: 高费用用户与高 Token 模型 Top 5
         * 数据来源: statistics.top 聚合结果
         */}
        {rankingGroups.map((group) => (
          <RankingCard key={group.title} {...group} />
        ))}
      </div>
    </section>
  );
}

function MetricCard({
  accent,
  label,
  note,
  value,
}: {
  accent: 'violet' | 'cyan' | 'blue' | 'green';
  label: string;
  note: string;
  value: string;
}) {
  return (
    <article className={`${styles.metricCard} ${METRIC_ACCENT_CLASSES[accent]}`}>
      {/*
       * 渲染位置: 总览顶部核心指标区
       * 展示内容: 单项指标名称、数值和统计口径
       * 数据来源: Statistics.totals
       */}
      <span className={styles.metricLabel}>{label}</span>
      <strong>{value}</strong>
      <span className={styles.metricNote}>{note}</span>
    </article>
  );
}

function TrendChart({
  granularity,
  metric,
  points,
}: {
  granularity: TrendGranularity;
  metric: TrendMetric;
  points: TrendPoint[];
}) {
  const width = 820;
  const height = 260;
  const paddingX = 28;
  const paddingY = 30;
  const values = points.map((point) => getTrendValue(point, metric));
  const maxValue = Math.max(...values, 1);
  // 格式化: 趋势明细 → 按图表宽高换算坐标 → SVG 折线点集合
  // 说明: 让日/周/月不同长度的数据都能在同一画布内自适应展示
  const chartPoints = points.map((point, index) => {
    const x = paddingX + (
      points.length <= 1 ? 0 : index * ((width - paddingX * 2) / (points.length - 1))
    );
    const y = height - paddingY - (
      (getTrendValue(point, metric) / maxValue) * (height - paddingY * 2)
    );
    return { point, x, y };
  });
  const polyline = chartPoints.map(({ x, y }) => `${x},${y}`).join(' ');
  const area = chartPoints.length > 0
    ? `${paddingX},${height - paddingY} ${polyline} ${chartPoints.at(-1)?.x ?? paddingX},${height - paddingY}`
    : '';
  const labelStep = Math.max(Math.ceil(points.length / 6), 1);

  return (
    <div className={styles.chartWrap}>
      {/*
       * 渲染位置: 总览消耗趋势卡片主体
       * 展示内容: 当前粒度与指标对应的面积折线图
       * 数据来源: Statistics.trends 与页面筛选状态
       */}
      <div className={styles.chartScale}>
        <span>{formatTrendValue(maxValue, metric)}</span>
        <span>{formatTrendValue(maxValue / 2, metric)}</span>
        <span>0</span>
      </div>
      <svg aria-label="AI 用量趋势图" className={styles.chart} role="img" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="trend-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7c6cff" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#7c6cff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className={styles.gridLine} x1={paddingX} x2={width - paddingX} y1={paddingY} y2={paddingY} />
        <line className={styles.gridLine} x1={paddingX} x2={width - paddingX} y1={height / 2} y2={height / 2} />
        <line className={styles.gridLine} x1={paddingX} x2={width - paddingX} y1={height - paddingY} y2={height - paddingY} />
        {area ? <polygon fill="url(#trend-area)" points={area} /> : null}
        {polyline ? <polyline className={styles.trendLine} points={polyline} /> : null}
        {/*
         * 渲染位置: 趋势图折线节点
         * 展示内容: 每个周期的精确值与悬浮提示
         * 数据来源: chartPoints 坐标转换结果
         */}
        {chartPoints.map(({ point, x, y }) => (
          <circle className={styles.trendPoint} cx={x} cy={y} key={point.periodStart} r="4">
            <title>
              {formatTrendDate(point.periodStart, granularity)} · {formatTrendValue(getTrendValue(point, metric), metric)}
            </title>
          </circle>
        ))}
      </svg>
      <div className={styles.chartLabels}>
        {/*
         * 渲染位置: 趋势图横轴
         * 展示内容: 抽样后的周期日期标签
         * 数据来源: 当前粒度趋势 points
         */}
        {points.map((point, index) => (
          index % labelStep === 0 || index === points.length - 1
            ? <span key={point.periodStart}>{formatTrendDate(point.periodStart, granularity)}</span>
            : null
        ))}
      </div>
    </div>
  );
}

function ModelHighlight({
  label,
  model,
  primaryValue,
}: {
  label: string;
  model: Statistics['modelHighlights']['mostTokens'];
  primaryValue: string;
}) {
  return (
    <div className={styles.modelHighlight}>
      {/*
       * 渲染位置: 总览模型焦点卡片
       * 展示内容: 当前最高消耗模型、主要指标和请求次数
       * 数据来源: Statistics.modelHighlights
       */}
      <span>{label}</span>
      <strong>{model?.model ?? '尚无调用记录'}</strong>
      <div>
        <b>{primaryValue}</b>
        <small>{model ? `${model.requestCount} 次请求` : '等待首笔数据'}</small>
      </div>
    </div>
  );
}

function RankingCard({
  caption,
  items,
  title,
}: {
  caption: string;
  items: Array<{ key: string; title: string; subtitle: string; value: string }>;
  title: string;
}) {
  return (
    <article className={styles.rankingCard}>
      {/*
       * 渲染位置: 总览底部排行榜
       * 展示内容: 指定维度 Top 5 排名、对象信息和消耗值
       * 数据来源: Statistics.top 格式化结果
       */}
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.cardKicker}>{caption}</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className={styles.rankingList}>
        {/*
         * 渲染位置: 单个排行榜卡片列表
         * 展示内容: 名次、用户或模型名称及对应统计值
         * 数据来源: items 参数
         */}
        {items.length > 0 ? items.map((item, index) => (
          <div className={styles.rankingRow} key={item.key}>
            <span className={index < 3 ? styles.rankTop : styles.rank}>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </div>
            <b>{item.value}</b>
          </div>
        )) : <EmptyState compact message="暂无排行数据" />}
      </div>
    </article>
  );
}

function UsersPage({ session }: { session: AdminSession }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [queryInput, setQueryInput] = useState(() => readQueryFromUrl());
  const [activeQuery, setActiveQuery] = useState(() => readQueryFromUrl());
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const payload = await getUsers(session, { page, pageSize: 20, query: activeQuery });
      setUsers(payload.users);
      setTotal(payload.pagination.total);
      setTotalPages(payload.pagination.totalPages);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeQuery, page, session]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = queryInput.trim();
    setPage(1);
    setActiveQuery(nextQuery);
    writeUrlState({ query: nextQuery || null });
  }

  async function handleQuotaSaved(user: AdminUser, quotaLimitUsd: number) {
    const payload = await updateUserQuota(session, user, quotaLimitUsd);
    // 格式化: 当前页用户数组 → 替换已更新用户 → 保持表格排序的最新行数据
    // 说明: 避免额度保存后整页闪烁，同时保留服务端返回的并发版本时间
    setUsers((currentUsers) => currentUsers.map((item) => (
      item.userId === payload.user.userId ? payload.user : item
    )));
    setEditingUser(null);
  }

  return (
    <section className={styles.pageBody}>
      {/*
       * 渲染位置: 用户与额度管理页面
       * 展示内容: 用户搜索、全量用户表格、额度编辑和分页
       * 数据来源: /api/admin/users 与额度更新接口
       */}
      <div className={styles.usersToolbar}>
        <form className={styles.searchBox} onSubmit={handleSearch}>
          <Icon name="search" />
          <input
            aria-label="搜索用户"
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="搜索邮箱、昵称或用户 ID"
            value={queryInput}
          />
          <button type="submit">搜索</button>
        </form>
        <div className={styles.resultCount}>
          <strong>{total.toLocaleString('zh-CN')}</strong>
          <span>位用户</span>
        </div>
        <button className={styles.secondaryButton} disabled={isLoading} onClick={loadUsers} type="button">
          <Icon name="refresh" />
          刷新
        </button>
      </div>

      {errorMessage ? <InlineAlert message={errorMessage} /> : null}

      <div className={styles.tableCard}>
        <div className={styles.tableScroll}>
          <table className={styles.userTable}>
            <thead>
              <tr>
                <th>用户</th>
                <th>角色 / 计划</th>
                <th>额度</th>
                <th>可用余额</th>
                <th>累计 Token</th>
                <th>累计费用</th>
                <th>请求数</th>
                <th>最近使用</th>
                <th><span className={styles.srOnly}>操作</span></th>
              </tr>
            </thead>
            <tbody>
              {/*
               * 渲染位置: 用户管理表格主体
               * 展示内容: 当前分页用户的身份、额度和 AI 用量
               * 数据来源: /api/admin/users 返回的 users 数组
               */}
              {users.map((user) => (
                <tr key={user.userId}>
                  <td>
                    <div className={styles.userCell}>
                      <span className={styles.avatar}>{getInitials(user.displayName || user.email)}</span>
                      <div>
                        <strong>{user.displayName || '未设置昵称'}</strong>
                        <span>{user.email}</span>
                        <small>ID {user.userId}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={user.role === 'admin' ? styles.adminTag : styles.userTag}>
                      {user.role === 'admin' ? '管理员' : '用户'}
                    </span>
                    <small className={styles.planText}>{user.planName}</small>
                  </td>
                  <td><strong className={styles.moneyText}>{formatUsd(user.quotaLimitUsd, 8)}</strong></td>
                  <td>
                    <strong className={styles.balanceText}>{formatUsd(user.balanceUsd, 8)}</strong>
                    {Number(user.activeReservedUsd) > 0
                      ? <small className={styles.reservedText}>预留 {formatUsd(user.activeReservedUsd, 8)}</small>
                      : null}
                  </td>
                  <td>{formatTokens(user.totalTokens)}</td>
                  <td>{formatUsd(user.totalCostUsd, 8)}</td>
                  <td>{user.requestCount.toLocaleString('zh-CN')}</td>
                  <td>{formatDateTime(user.lastUsedAt)}</td>
                  <td>
                    <button
                      aria-label={`编辑 ${user.email} 的额度`}
                      className={styles.editButton}
                      onClick={() => setEditingUser(user)}
                      type="button"
                    >
                      <Icon name="edit" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isLoading ? <div className={styles.tableLoading}>正在加载用户数据...</div> : null}
          {!isLoading && users.length === 0 ? <EmptyState message="没有找到符合条件的用户" /> : null}
        </div>

        <div className={styles.pagination}>
          <span>第 {page} / {totalPages} 页</span>
          <div>
            <button
              aria-label="上一页"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((currentPage) => Math.max(currentPage - 1, 1))}
              type="button"
            >
              <Icon name="arrowLeft" />
            </button>
            <button
              aria-label="下一页"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((currentPage) => Math.min(currentPage + 1, totalPages))}
              type="button"
            >
              <Icon name="arrowRight" />
            </button>
          </div>
        </div>
      </div>

      {editingUser ? (
        <QuotaModal
          onClose={() => setEditingUser(null)}
          onSave={handleQuotaSaved}
          user={editingUser}
        />
      ) : null}
    </section>
  );
}

function QuotaModal({
  onClose,
  onSave,
  user,
}: {
  onClose: () => void;
  onSave: (user: AdminUser, quotaLimitUsd: number) => Promise<void>;
  user: AdminUser;
}) {
  const [quotaValue, setQuotaValue] = useState(user.quotaLimitUsd);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quotaLimitUsd = Number(quotaValue);

    if (!Number.isFinite(quotaLimitUsd) || quotaLimitUsd < 0 || quotaLimitUsd > 1_000_000) {
      setErrorMessage('请输入 0 到 1,000,000 之间的有效额度。');
      return;
    }

    setErrorMessage('');
    setIsSaving(true);

    try {
      await onSave(user, quotaLimitUsd);
    } catch (error) {
      const message = error instanceof ApiError && error.status === 409
        ? '该用户数据刚刚发生变化，请关闭弹窗并刷新列表后重试。'
        : getErrorMessage(error);
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="presentation">
      {/*
       * 渲染位置: 用户表格上方额度编辑弹窗
       * 展示内容: 目标用户、累计消费、可用余额与新额度输入
       * 数据来源: 当前选中 AdminUser 与表单状态
       */}
      <div aria-labelledby="quota-modal-title" aria-modal="true" className={styles.modal} role="dialog">
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.cardKicker}>QUOTA CONTROL</span>
            <h2 id="quota-modal-title">调整用户额度</h2>
          </div>
          <button aria-label="关闭额度编辑" className={styles.iconButton} onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.modalUser}>
          <span className={styles.avatar}>{getInitials(user.displayName || user.email)}</span>
          <div>
            <strong>{user.displayName || user.email}</strong>
            <span>{user.email}</span>
          </div>
        </div>

        <div className={styles.quotaSummary}>
          <div><span>当前额度</span><strong>{formatUsd(user.quotaLimitUsd, 8)}</strong></div>
          <div><span>累计扣费</span><strong>{formatUsd(user.totalChargedUsd, 8)}</strong></div>
          <div><span>可用余额</span><strong>{formatUsd(user.balanceUsd, 8)}</strong></div>
        </div>

        <form onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>新额度上限（USD）</span>
            <input
              autoFocus
              max="1000000"
              min="0"
              onChange={(event) => setQuotaValue(event.target.value)}
              required
              step="0.00000001"
              type="number"
              value={quotaValue}
            />
          </label>
          <p className={styles.formHint}>保存后，可用余额将按新额度扣除累计费用与在途预留重新计算。</p>
          {errorMessage ? <InlineAlert message={errorMessage} /> : null}
          <div className={styles.modalActions}>
            <button className={styles.secondaryButton} disabled={isSaving} onClick={onClose} type="button">取消</button>
            <button className={styles.primaryButton} disabled={isSaving} type="submit">
              {isSaving ? '保存中...' : '确认调整'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModelsPage({ session }: { session: AdminSession }) {
  const [models, setModels] = useState<ModelControl[]>([]);
  const [updatingModel, setUpdatingModel] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadModels = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const payload = await getModelControls(session);
      setModels(payload.models);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  async function toggleModel(model: ModelControl) {
    setUpdatingModel(model.model);
    setErrorMessage('');

    try {
      const payload = await updateModelControl(session, model.model, !model.enabled);
      // 格式化: 模型控制数组 → 替换刚保存的模型状态 → 白名单即时展示结果
      // 说明: 使用服务端响应覆盖本地状态，确保更新时间与最终启停值一致
      setModels((currentModels) => currentModels.map((item) => (
        item.model === payload.model.model ? payload.model : item
      )));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setUpdatingModel('');
    }
  }

  const enabledCount = models.filter((model) => model.enabled).length;

  return (
    <section className={styles.pageBody}>
      {/*
       * 渲染位置: 模型白名单管理页面
       * 展示内容: 已配置价格模型、启停状态、计费单价和更新时间
       * 数据来源: /api/admin/ai/models 响应
       */}
      <div className={styles.modelsSummary}>
        <div>
          <span>已启用模型</span>
          <strong>{enabledCount} / {models.length}</strong>
        </div>
        <p>停用模型后，模型列表将隐藏该模型，新的聊天请求也会在额度预留前被拒绝。</p>
        <button className={styles.secondaryButton} disabled={isLoading} onClick={loadModels} type="button">
          <Icon name="refresh" />
          刷新
        </button>
      </div>

      {errorMessage ? <InlineAlert message={errorMessage} /> : null}
      {isLoading && models.length === 0 ? <SectionLoader label="正在加载模型配置" /> : null}

      <div className={styles.modelGrid}>
        {/*
         * 渲染位置: 模型白名单主体网格
         * 展示内容: 每个可计费模型的白名单开关与输入/缓存/输出单价
         * 数据来源: models 状态
         */}
        {models.map((model) => (
          <article className={model.enabled ? styles.modelCardEnabled : styles.modelCard} key={model.model}>
            <div className={styles.modelCardHeader}>
              <div className={styles.modelLogo}><Icon name="models" /></div>
              <div>
                <span className={model.enabled ? styles.enabledTag : styles.disabledTag}>
                  {model.enabled ? '已启用' : '已停用'}
                </span>
                <h2>{model.model}</h2>
              </div>
              <button
                aria-label={`${model.enabled ? '停用' : '启用'} ${model.model}`}
                aria-pressed={model.enabled}
                className={model.enabled ? styles.switchActive : styles.switch}
                disabled={updatingModel === model.model}
                onClick={() => toggleModel(model)}
                type="button"
              >
                <span />
              </button>
            </div>
            <div className={styles.pricingGrid}>
              <div><span>输入 / 1M</span><strong>{formatUsd(model.pricing.inputPerMillionUsd)}</strong></div>
              <div><span>缓存输入 / 1M</span><strong>{formatUsd(model.pricing.cachedInputPerMillionUsd)}</strong></div>
              <div><span>输出 / 1M</span><strong>{formatUsd(model.pricing.outputPerMillionUsd)}</strong></div>
            </div>
            <footer>
              <span>{model.updatedAt ? `更新于 ${formatDateTime(model.updatedAt)}` : '使用默认启用配置'}</span>
              {updatingModel === model.model ? <b>保存中...</b> : null}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

function BrandMark({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  return (
    <span className={size === 'large' ? styles.brandMarkLarge : styles.brandMark} aria-hidden="true">
      {/*
       * 渲染位置: 登录页与侧栏品牌区域
       * 展示内容: Astesia 渐变字母标识
       * 数据来源: 静态品牌常量
       */}
      A
    </span>
  );
}

function Icon({ name }: { name: IconName }) {
  const usesStroke = name !== 'overview';

  return (
    <svg
      aria-hidden="true"
      fill={usesStroke ? 'none' : 'currentColor'}
      stroke={usesStroke ? 'currentColor' : 'none'}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={usesStroke ? 1.8 : 0}
      viewBox="0 0 24 24"
    >
      {/*
       * 渲染位置: 按钮、导航和状态标识内部
       * 展示内容: 与功能名称对应的线性图标
       * 数据来源: ICON_PATHS 静态路径映射
       */}
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function InlineAlert({ message }: { message: string }) {
  return (
    <div className={styles.inlineAlert} role="alert">
      {/*
       * 渲染位置: 表单或页面操作区域
       * 展示内容: 当前接口或校验错误
       * 数据来源: 组件 message 参数
       */}
      <span>!</span>
      <p>{message}</p>
    </div>
  );
}

function SectionLoader({ label }: { label: string }) {
  return (
    <div className={styles.sectionLoader}>
      {/*
       * 渲染位置: 页面主体异步加载阶段
       * 展示内容: 加载动画与当前加载任务
       * 数据来源: 组件 label 参数
       */}
      <div className={styles.loader} />
      <span>{label}</span>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.errorState}>
      {/*
       * 渲染位置: 页面首屏接口加载失败时
       * 展示内容: 错误原因和重试操作
       * 数据来源: 捕获的 API 错误
       */}
      <span>!</span>
      <h2>数据加载失败</h2>
      <p>{message}</p>
      <button className={styles.secondaryButton} onClick={onRetry} type="button">重新加载</button>
    </div>
  );
}

function EmptyState({ compact = false, message }: { compact?: boolean; message: string }) {
  return (
    <div className={compact ? styles.emptyStateCompact : styles.emptyState}>
      {/*
       * 渲染位置: 表格或榜单无数据区域
       * 展示内容: 当前筛选下的空数据提示
       * 数据来源: 组件 message 参数
       */}
      <span>—</span>
      <p>{message}</p>
    </div>
  );
}

function getTrendValue(point: TrendPoint, metric: TrendMetric) {
  if (metric === 'cost') {
    return Number(point.totalCostUsd) || 0;
  }

  return metric === 'requests' ? point.requestCount : point.totalTokens;
}

function formatTrendValue(value: number, metric: TrendMetric) {
  if (metric === 'cost') {
    return formatUsd(value);
  }

  return metric === 'tokens' ? formatTokens(value) : Math.round(value).toLocaleString('zh-CN');
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : '操作失败，请稍后重试。';
}

function readViewFromUrl(): AdminView {
  const value = new URLSearchParams(window.location.search).get('view');
  return value === 'users' || value === 'models' ? value : 'overview';
}

function readTrendFromUrl(): TrendGranularity {
  const value = new URLSearchParams(window.location.search).get('trend');
  return value === 'weekly' || value === 'monthly' ? value : 'daily';
}

function readMetricFromUrl(): TrendMetric {
  const value = new URLSearchParams(window.location.search).get('metric');
  return value === 'cost' || value === 'requests' ? value : 'tokens';
}

function readQueryFromUrl() {
  return new URLSearchParams(window.location.search).get('query')?.trim().slice(0, 120) ?? '';
}

function writeUrlState(updates: Record<string, string | null>) {
  const url = new URL(window.location.href);

  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }

  window.history.replaceState(null, '', url);
}
