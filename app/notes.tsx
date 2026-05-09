import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function NotesScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">笔记</ThemedText>
      <ThemedText style={styles.description}>
        这里先保留为笔记页面占位，后续可以补充分类、富文本编辑和搜索等功能。
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
