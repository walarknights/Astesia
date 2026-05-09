import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function TodoScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">待办</ThemedText>
      <ThemedText style={styles.description}>
        这里先保留为待办页面占位，后续可以补充任务清单、优先级和完成状态管理。
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
