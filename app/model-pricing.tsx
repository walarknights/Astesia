import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppPalette, Fonts } from '@/constants/theme';
import { requestAiModelPricing, type AiModelPricing } from '@/services/ai-assistant';

type ProviderKey = 'DeepSeek' | 'GPT' | 'Claude' | 'Gemini' | '其他';

const PROVIDER_ORDER: ProviderKey[] = ['DeepSeek', 'GPT', 'Claude', 'Gemini', '其他'];

const PROVIDER_ACCENTS: Record<ProviderKey, string> = {
  DeepSeek: '#60A5FA',
  GPT: '#34D399',
  Claude: '#F59E0B',
  Gemini: '#A78BFA',
  其他: '#94A3B8',
};

const MODEL_PRICE_DESCRIPTION = '公开展示当前可用模型的计费单价，输入、缓存输入和输出会分开结算，最终扣费以服务端实际 usage 为准。';

export default function ModelPricingScreen() {
  const router = useRouter();
  const [models, setModels] = useState<AiModelPricing[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);

  const syncModelPricing = useCallback(async () => {
    setIsLoading(true);

    try {
      const result = await requestAiModelPricing();
      setModels(result.models);
      setErrorMessage(result.errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void syncModelPricing();
  }, [syncModelPricing]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={['#1E1E3A', '#151526', AppPalette.background]}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gradientBackground}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" style={styles.iconButton} onPress={() => router.back()}>
              <MaterialIcons name="arrow-back" size={24} color={AppPalette.text} />
            </Pressable>
            <ThemedText style={styles.headerTitle}>模型价格</ThemedText>
            <Pressable
              accessibilityRole="button"
              disabled={isLoading}
              style={[styles.iconButton, isLoading ? styles.iconButtonDisabled : null]}
              onPress={() => void syncModelPricing()}>
              <MaterialIcons name="refresh" size={23} color={AppPalette.text} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/*
             * 渲染位置: 模型价格页顶部说明区
             * 展示内容: 页面标题、价格说明和当前模型数量摘要
             * 数据来源: MODEL_PRICE_DESCRIPTION 常量与 models 状态
             */}
            <View style={styles.heroCard}>
              <View style={styles.heroIcon}>
                <MaterialIcons name="attach-money" size={28} color="#FFFFFF" />
              </View>
              <ThemedText style={styles.heroTitle}>模型价格</ThemedText>
              <ThemedText style={styles.heroDescription}>{MODEL_PRICE_DESCRIPTION}</ThemedText>
              <View style={styles.summaryGrid}>
                <SummaryChip label="计费单位" value="USD / 1M tokens" />
                <SummaryChip label="当前模型" value={isLoading ? '同步中' : `${models.length} 个`} />
              </View>
            </View>

            {isLoading && models.length === 0 ? (
              <View style={styles.stateCard}>
                <ActivityIndicator color={AppPalette.brandLight} />
                <ThemedText style={styles.stateText}>正在同步模型价格...</ThemedText>
              </View>
            ) : null}

            {!isLoading && errorMessage ? (
              <View style={styles.stateCard}>
                <MaterialIcons name="error-outline" size={26} color={AppPalette.warning} />
                <ThemedText style={styles.stateTitle}>价格暂时加载失败</ThemedText>
                <ThemedText style={styles.stateText}>{errorMessage}</ThemedText>
                <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void syncModelPricing()}>
                  <ThemedText style={styles.retryButtonText}>重新加载</ThemedText>
                </Pressable>
              </View>
            ) : null}

            {!isLoading && !errorMessage && models.length === 0 ? (
              <View style={styles.stateCard}>
                <MaterialIcons name="hourglass-empty" size={26} color={AppPalette.textMuted} />
                <ThemedText style={styles.stateTitle}>暂无可展示模型</ThemedText>
                <ThemedText style={styles.stateText}>当前没有已启用且已配置价格的模型。</ThemedText>
              </View>
            ) : null}

            {/*
             * 渲染位置: 模型价格页价格列表区
             * 展示内容: 按供应商分组的模型卡片和三类计费单价
             * 数据来源: /api/ai/model-pricing 响应写入的 models 状态
             */}
            {groupedModels.map((group) => (
              <View key={group.provider} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.providerDot, { backgroundColor: PROVIDER_ACCENTS[group.provider] }]} />
                  <ThemedText style={styles.sectionTitle}>{group.provider}</ThemedText>
                  <ThemedText style={styles.sectionCount}>{group.models.length} 个</ThemedText>
                </View>
                {group.models.map((model) => (
                  <ModelPricingCard key={model.model} model={model} provider={group.provider} />
                ))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryChip}>
      <ThemedText style={styles.summaryLabel}>{label}</ThemedText>
      <ThemedText style={styles.summaryValue}>{value}</ThemedText>
    </View>
  );
}

function ModelPricingCard({ model, provider }: { model: AiModelPricing; provider: ProviderKey }) {
  return (
    <View style={styles.priceCard}>
      <View style={styles.priceCardHeader}>
        <View style={[styles.modelBadge, { borderColor: PROVIDER_ACCENTS[provider] }]}>
          <MaterialIcons name="auto-awesome" size={18} color={PROVIDER_ACCENTS[provider]} />
        </View>
        <View style={styles.modelCopy}>
          <ThemedText style={styles.modelName}>{model.model}</ThemedText>
          <ThemedText style={styles.modelMeta}>按实际 token usage 结算</ThemedText>
        </View>
      </View>
      <View style={styles.priceGrid}>
        <PriceCell label="输入" value={model.pricing.inputPerMillionUsd} />
        <PriceCell label="缓存输入" value={model.pricing.cachedInputPerMillionUsd} />
        <PriceCell label="输出" value={model.pricing.outputPerMillionUsd} />
      </View>
    </View>
  );
}

function PriceCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.priceCell}>
      <ThemedText style={styles.priceLabel}>{label}</ThemedText>
      <ThemedText style={styles.priceValue}>{formatUsdPerMillion(value)}</ThemedText>
    </View>
  );
}

/**
 * 按模型 ID 推断展示分组，用于让价格页按主流供应商聚合。
 *
 * @param model - 后端返回的模型 ID
 * @returns 页面展示用供应商名称
 * @example
 *   getModelProvider('claude-sonnet-5') // => 'Claude'
 */
function getModelProvider(model: string): ProviderKey {
  const normalizedModel = model.trim().toLowerCase();

  if (normalizedModel.startsWith('deepseek-')) {
    return 'DeepSeek';
  }

  if (normalizedModel.startsWith('gpt-')) {
    return 'GPT';
  }

  if (normalizedModel.startsWith('claude-')) {
    return 'Claude';
  }

  if (normalizedModel.startsWith('gemini-')) {
    return 'Gemini';
  }

  return '其他';
}

/**
 * 将后端价格列表整理成页面分组结构。
 *
 * @param models - `/api/ai/model-pricing` 返回的模型价格数组
 * @returns 按供应商排序后的模型分组
 * @example
 *   groupModelsByProvider([{ model: 'gpt-5.4', pricing: {...} }])
 */
function groupModelsByProvider(models: AiModelPricing[]) {
  const groups = new Map<ProviderKey, AiModelPricing[]>();

  for (const model of models) {
    const provider = getModelProvider(model.model);
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }

  // 格式化: 模型价格数组 → 按供应商归类并过滤空分组 → 页面 section 列表
  // 说明: 让同类模型集中展示，减少用户查找 GPT / Claude / Gemini 价格时的认知成本
  return PROVIDER_ORDER
    .map((provider) => ({
      provider,
      models: groups.get(provider) ?? [],
    }))
    .filter((group) => group.models.length > 0);
}

/**
 * 格式化每百万 token 的美元价格。
 *
 * @param value - 后端返回的价格字符串
 * @returns 带美元符号且保留必要小数位的展示文案
 * @example
 *   formatUsdPerMillion('0.0028') // => '$0.0028'
 */
function formatUsdPerMillion(value: string) {
  const normalizedValue = value.trim();
  const numericValue = Number(normalizedValue);

  if (!normalizedValue) {
    return '--';
  }

  if (!Number.isFinite(numericValue)) {
    return `$${normalizedValue}`;
  }

  const digits = numericValue < 0.01 ? 6 : numericValue < 1 ? 4 : 2;

  return `$${trimTrailingZeros(numericValue.toFixed(digits))}`;
}

/**
 * 去掉价格字符串末尾多余的 0，保留真实有效位。
 *
 * @param value - 经过 toFixed 后的价格字符串
 * @returns 去掉尾随 0 后的价格字符串
 * @example
 *   trimTrailingZeros('12.00') // => '12'
 */
function trimTrailingZeros(value: string) {
  return value.replace(/\.?0+$/, '');
}

const styles = StyleSheet.create({
  gradientBackground: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  iconButtonDisabled: {
    opacity: 0.5,
  },
  headerTitle: {
    color: AppPalette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 16,
  },
  heroCard: {
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 28,
    padding: 20,
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.brand,
  },
  heroTitle: {
    color: AppPalette.text,
    fontFamily: Fonts.serifSemiBold,
    fontSize: 30,
    lineHeight: 36,
  },
  heroDescription: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryChip: {
    flexGrow: 1,
    minWidth: 132,
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  summaryLabel: {
    color: AppPalette.textSubtle,
    fontSize: 12,
    lineHeight: 16,
  },
  summaryValue: {
    marginTop: 4,
    color: AppPalette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  stateCard: {
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 24,
    padding: 20,
    alignItems: 'center',
    gap: 10,
    backgroundColor: AppPalette.surfaceSoft,
  },
  stateTitle: {
    color: AppPalette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  stateText: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 4,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: AppPalette.brand,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  providerDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  sectionTitle: {
    color: AppPalette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  sectionCount: {
    color: AppPalette.textSubtle,
    fontSize: 13,
    lineHeight: 18,
  },
  priceCard: {
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 24,
    padding: 16,
    gap: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
  },
  priceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modelBadge: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.3)',
  },
  modelCopy: {
    flex: 1,
    gap: 2,
  },
  modelName: {
    color: AppPalette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  modelMeta: {
    color: AppPalette.textSubtle,
    fontSize: 12,
    lineHeight: 17,
  },
  priceGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  priceCell: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
  },
  priceLabel: {
    color: AppPalette.textSubtle,
    fontSize: 11,
    lineHeight: 15,
  },
  priceValue: {
    marginTop: 5,
    color: AppPalette.text,
    fontFamily: Fonts.mono,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
});
