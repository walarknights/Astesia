import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function AccountingScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">记账</ThemedText>
      <ThemedText style={styles.description}>
        这里先保留为记账页面占位，后续可以补充账单录入、月度统计和分类图表。
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 12,
    justifyContent: 'center',
  },
  description: {
    color: '#64748B',
  },
});
