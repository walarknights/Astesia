import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSwitchBar } from '@/components/BottomSwitchBar';
import { ThemedText } from '@/components/themed-text';
import { getNotePlainText, loadNotes, type NoteRecord } from '@/services/notes-storage';

type NotesTab = 'notes' | 'todo';

const NOTE_PREVIEW_CONTENT_LIMIT = 15;

function getNotePreviewContent(content: string) {
  const normalizedContent = content.trim();

  if (normalizedContent.length <= NOTE_PREVIEW_CONTENT_LIMIT) {
    return normalizedContent;
  }

  // 格式化: 完整笔记内容 → 截取前 15 个字并追加省略提示 → 卡片摘要
  // 说明: 与 Figma 中单条笔记内容摘要规则保持一致
  return `${normalizedContent.slice(0, NOTE_PREVIEW_CONTENT_LIMIT)}.....`;
}

export default function NotesScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<NotesTab>('notes');
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const syncNotes = async () => {
        setIsLoadingNotes(true);

        try {
          const storedNotes = await loadNotes();

          if (active) {
            setNotes(storedNotes);
          }
        } finally {
          if (active) {
            setIsLoadingNotes(false);
          }
        }
      };

      void syncNotes();

      return () => {
        active = false;
      };
    }, [])
  );

  const handlePressAdd = () => {
    if (activeTab === 'notes') {
      router.push('/note-editor');
      return;
    }

    router.push('/todo');
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" backgroundColor="#DDD0FE" />
      <LinearGradient
        colors={['rgba(113, 17, 248, 0.2)', 'rgba(113, 17, 248, 0.2)', 'rgba(245, 63, 63, 0.02)']}
        locations={[0, 0.5048, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gradientBackground}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Pressable style={styles.iconButton} onPress={() => router.back()}>
              <MaterialIcons name="arrow-back" size={24} color="#262626" />
            </Pressable>
            <ThemedText style={styles.headerTitle}>笔记</ThemedText>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}>
            {activeTab === 'notes' ? (
              <NotesPanel
                isLoading={isLoadingNotes}
                notes={notes}
                onPressNote={(noteId) => router.push({ pathname: '/note-editor', params: { noteId } })}
                onPressCreate={() => router.push('/note-editor')}
              />
            ) : (
              <TodoPanel />
            )}
          </ScrollView>
          <View style={{marginBottom: 12}} >
          <BottomSwitchBar
            leftTab={{
              icon: 'edit-note',
              label: '笔记',
              active: activeTab === 'notes',
              onPress: () => setActiveTab('notes'),
            }}
            rightTab={{
              icon: 'checklist',
              label: '待办',
              active: activeTab === 'todo',
              onPress: () => setActiveTab('todo'),
            }}
            onPressAdd={handlePressAdd}
            
          />
          </View>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

function NotesPanel({
  isLoading,
  notes,
  onPressNote,
  onPressCreate,
}: {
  isLoading: boolean;
  notes: NoteRecord[];
  onPressNote: (noteId: string) => void;
  onPressCreate: () => void;
}) {
  if (isLoading) {
    return (
      <View style={styles.loadingCard}>
        <ActivityIndicator color="#7C3AED" />
        <ThemedText style={styles.loadingText}>正在读取笔记...</ThemedText>
      </View>
    );
  }

  if (notes.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <MaterialIcons name="edit-note" size={48} color="#7C3AED" />
        <ThemedText style={styles.emptyTitle}>写下第一条笔记</ThemedText>
        <ThemedText style={styles.emptyDescription}>
          支持正文文本和相册图片，保存后会回到这里形成卡片预览。
        </ThemedText>
        <Pressable accessibilityRole="button" style={styles.emptyButton} onPress={onPressCreate}>
          <ThemedText style={styles.emptyButtonText}>开始编写</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.notesPanel}>
      {/*
       * 渲染位置: 合并入口的笔记主视图
       * 展示内容: 两列具体笔记预览卡片，点击进入编辑页
       * 数据来源: loadNotes() 读取的本地笔记记录
       */}
      {notes.map((note, index) => (
        <NotePreviewCard
          key={note.id}
          note={note}
          onPress={() => onPressNote(note.id)}
          style={index % 2 === 1 ? styles.noteCardStaggered : null}
        />
      ))}
    </View>
  );
}

function NotePreviewCard({
  note,
  style,
  onPress,
}: {
  note: NoteRecord;
  style: StyleProp<ViewStyle>;
  onPress: () => void;
}) {
  const previewContent = getNotePreviewContent(getNotePlainText(note) || '图片笔记');
  const imageCount = note.blocks.filter((block) => block.type === 'image').length;

  return (
    <Pressable accessibilityRole="button" style={[styles.noteCard, style]} onPress={onPress}>
      <ThemedText style={styles.noteCardTitle} numberOfLines={1}>
        {note.title || '未命名笔记'}
      </ThemedText>
      <ThemedText style={styles.noteCardContent} numberOfLines={4}>
        {previewContent}
      </ThemedText>
      {imageCount > 0 ? (
        <View style={styles.imageCountBadge}>
          <MaterialIcons name="image" size={14} color="#6D28D9" />
          <ThemedText style={styles.imageCountText}>{imageCount}</ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

function TodoPanel() {
  return (
    <View style={styles.todoPanel}>
      {/*
       * 渲染位置: 合并入口的待办切换页
       * 展示内容: 待办功能占位说明，笔记页优先实现
       * 数据来源: activeTab 切换状态
       */}
      <View style={styles.todoEmptyCard}>
        <MaterialIcons name="checklist" size={40} color="#94A3B8" />
        <ThemedText style={styles.todoTitle}>待办</ThemedText>
        <ThemedText style={styles.todoDescription}>
          待办入口已合并到笔记页，任务清单能力将在后续补充。
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gradientBackground: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 26,
    gap: 1,
    marginBottom: 4,
    marginLeft: -8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  headerTitle: {
    color: '#000000',
    fontSize: 24,
    lineHeight: 50,
    fontWeight: 'bold',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 31,
    paddingTop: 24,
    paddingBottom: 116,
  },
  notesPanel: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    rowGap: 18,
    paddingBottom: 32,
  },
  loadingCard: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.72)',
    gap: 10,
  },
  loadingText: {
    color: '#7C3AED',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 36,
    backgroundColor: '#FFFFFF',
    shadowColor: '#3B0764',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
    gap: 12,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  emptyDescription: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#7C3AED',
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  todoPanel: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 120,
    width: '100%',
  },
  noteCard: {
    width: 155,
    height: 221,
    borderRadius: 15,
    paddingTop: 21,
    paddingRight: 34,
    paddingBottom: 30,
    paddingLeft: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#3B0764',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  noteCardStaggered: {
    marginTop: 37,
  },
  noteCardTitle: {
    minWidth: 98,
    marginLeft: 2,
    color: '#000000',
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '600',
  },
  noteCardContent: {
    width: 107,
    height: 112,
    marginTop: 29,
    color: '#000000',
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '200',
  },
  imageCountBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: '#F3E8FF',
  },
  imageCountText: {
    color: '#6D28D9',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  todoEmptyCard: {
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 34,
    backgroundColor: '#F8FAFC',
    gap: 10,
  },
  todoTitle: {
    color: '#0F172A',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  todoDescription: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
