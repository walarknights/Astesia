import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppPalette } from '@/constants/theme';
import { searchCities } from '@/services/qweather';
import type { QWeatherLocation } from '@/services/type';
import {
  addRecentCity,
  CITY_OPTIONS,
  loadRecentCities,
  savePendingCitySelection,
} from '@/services/weather-city';

export default function WeatherSearchScreen() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [recentCities, setRecentCities] = useState<string[]>([]);
  const [results, setResults] = useState<QWeatherLocation[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cityOptions = useMemo(
    () => [...recentCities, ...CITY_OPTIONS.filter((item) => !recentCities.includes(item))],
    [recentCities]
  );

  useEffect(() => {
    let cancelled = false;

    const initializeRecentCities = async () => {
      const storedCities = await loadRecentCities();

      if (!cancelled) {
        setRecentCities(storedCities);
      }
    };

    void initializeRecentCities();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (keyword.trim()) {
      return;
    }

    setHasSearched(false);
    setResults([]);
    setErrorMessage(null);
  }, [keyword]);

  const handleSearch = async () => {
    const nextKeyword = keyword.trim();

    if (!nextKeyword) {
      return;
    }

    setHasSearched(true);
    setIsSearching(true);
    setErrorMessage(null);

    try {
      const nextResults = await searchCities(nextKeyword);
      setResults(nextResults);
    } catch (error) {
      setResults([]);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectCity = async (cityName: string) => {
    const normalizedCity = cityName.trim();

    if (!normalizedCity) {
      return;
    }

    const nextRecentCities = await addRecentCity(normalizedCity);
    setRecentCities(nextRecentCities);
    await savePendingCitySelection(normalizedCity);
    router.back();
  };

  const renderCityOption = (cityName: string, description?: string) => (
    <Pressable key={`${cityName}-${description ?? 'default'}`} style={styles.cityOption} onPress={() => void handleSelectCity(cityName)}>
      <View style={styles.cityTextGroup}>
        <ThemedText type="defaultSemiBold">{cityName}</ThemedText>
        {description ? <ThemedText style={styles.cityMeta}>{description}</ThemedText> : null}
      </View>
      <MaterialIcons name="arrow-forward-ios" size={16} color={AppPalette.textMuted} />
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color={AppPalette.text} />
        </Pressable>
        <View style={styles.searchCard}>
          <View style={styles.searchInputRow}>
            <MaterialIcons name="search" size={20} color={AppPalette.textMuted} />
            <TextInput
              value={keyword}
              onChangeText={setKeyword}
              placeholder="搜索城市"
              placeholderTextColor={AppPalette.textSubtle}
              style={styles.searchInput}
              autoFocus
              returnKeyType="search"
              onSubmitEditing={() => void handleSearch()}
            />
            {keyword.trim() ? (
              <Pressable onPress={() => setKeyword('')}>
                <MaterialIcons name="close" size={18} color={AppPalette.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            style={[styles.searchButton, !keyword.trim() && styles.searchButtonDisabled]}
            onPress={() => void handleSearch()}
            disabled={!keyword.trim()}>
            <ThemedText style={styles.searchButtonText}>查询</ThemedText>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.sectionHeader}>
          <ThemedText type="title" style={styles.sectionTitle}>
            {hasSearched ? '查询结果' : '热门城市'}
          </ThemedText>
          <ThemedText style={styles.sectionDescription}>
            {hasSearched ? '点击结果后返回首页并刷新当前天气。' : '优先展示最近访问城市，方便你快速切换。'}
          </ThemedText>
        </View>

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <MaterialIcons name="info-outline" size={18} color="#B45309" />
            <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
          </View>
        ) : null}

        {isSearching ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={AppPalette.brandLight} />
            <ThemedText style={styles.stateText}>正在搜索城市...</ThemedText>
          </View>
        ) : null}

        {!isSearching && hasSearched ? (
          results.length > 0 ? (
            <View style={styles.cityList}>
              {results.map((item) =>
                renderCityOption(item.name, [item.adm2, item.adm1].filter(Boolean).join(' · '))
              )}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <MaterialIcons name="location-off" size={22} color="#94A3B8" />
              <ThemedText style={styles.stateText}>没有找到相关城市，换个关键词试试。</ThemedText>
            </View>
          )
        ) : null}

        {!isSearching && !hasSearched ? <View style={styles.cityList}>{cityOptions.map((item) => renderCityOption(item))}</View> : null}
      </ScrollView>
    </ThemedView>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return '查询失败，请稍后重试。';
}

const styles = StyleSheet.create({
  // [变更] 修改前: 城市搜索页使用浅灰底和纯白列表项
  // [变更] 修改后: 使用深色背景、玻璃搜索框与靛青查询按钮
  // [原因] 补齐天气流程中的主题一致性
  container: {
    flex: 1,
    backgroundColor: AppPalette.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: AppPalette.border,
    backgroundColor: AppPalette.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.surfaceSoft,
  },
  searchCard: {
    gap: 12,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: AppPalette.surfaceSoft,
    borderWidth: 1,
    borderColor: AppPalette.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    color: AppPalette.text,
  },
  searchButton: {
    alignSelf: 'flex-end',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: AppPalette.brand,
  },
  searchButtonDisabled: {
    opacity: 0.6,
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  sectionHeader: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 28,
    lineHeight: 32,
  },
  sectionDescription: {
    color: AppPalette.textMuted,
  },
  cityList: {
    gap: 12,
  },
  cityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
  },
  cityTextGroup: {
    flex: 1,
    gap: 4,
  },
  cityMeta: {
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#FEF3C7',
  },
  errorText: {
    flex: 1,
    color: '#92400E',
    fontSize: 14,
    lineHeight: 20,
  },
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 20,
    paddingVertical: 32,
    backgroundColor: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 20,
    paddingVertical: 32,
    backgroundColor: '#FFFFFF',
  },
  stateText: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
  },
});
