import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSwitchBar } from '@/components/BottomSwitchBar';
import { ThemedText } from '@/components/themed-text';
import { AppPalette } from '@/constants/theme';
import { TodoPanel as TodoListPanel } from '@/app/todo';
import { getNoteImageCount, getNotePlainText, loadNotes, type NoteRecord } from '@/services/notes-storage';

type NotesTab = 'notes' | 'todo';

const NOTE_PREVIEW_CONTENT_LIMIT = 15;
const NOTE_TAB_POP_ANIMATION_MS = 680;

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
  const [todoCreateRequestKey, setTodoCreateRequestKey] = useState(0);

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

    setTodoCreateRequestKey((value) => value + 1);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" backgroundColor={AppPalette.background} />
      <LinearGradient
        colors={['#1E1E3A', '#151526', AppPalette.background]}
        locations={[0, 0.5048, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gradientBackground}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Pressable style={styles.iconButton} onPress={() => router.back()}>
              <MaterialIcons name="arrow-back" size={24} color={AppPalette.text} />
            </Pressable>
            <ThemedText style={styles.headerTitle}>笔记</ThemedText>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}>
            {activeTab === 'notes' ? (
              <NotesTabAnimatedPanel>
                <NotesPanel
                  isLoading={isLoadingNotes}
                  notes={notes}
                  onPressNote={(noteId) => router.push({ pathname: '/note-editor', params: { noteId } })}
                  onPressCreate={() => router.push('/note-editor')}
                />
              </NotesTabAnimatedPanel>
            ) : (
              <TodoPanel createRequestKey={todoCreateRequestKey} />
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
        <ActivityIndicator color={AppPalette.brandLight} />
        <ThemedText style={styles.loadingText}>正在读取笔记...</ThemedText>
      </View>
    );
  }

  if (notes.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <MaterialIcons name="edit-note" size={48} color={AppPalette.brandLight} />
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
       * 展示内容: 单列具体笔记预览卡片，点击进入编辑页
       * 数据来源: loadNotes() 读取的本地笔记记录
       */}
      {notes.map((note) => (
        <NotePreviewCard
          key={note.id}
          note={note}
          onPress={() => onPressNote(note.id)}
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
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}) {
  const previewContent = getNotePreviewContent(getNotePlainText(note) || '图片笔记');
  const imageCount = getNoteImageCount(note);

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
          <MaterialIcons name="image" size={14} color={AppPalette.brandLight} />
          <ThemedText style={styles.imageCountText}>{imageCount}</ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

function TodoPanel({ createRequestKey }: { createRequestKey: number }) {
  return (
    <View style={styles.todoPanel}>
      {/*
       * 渲染位置: 合并入口的待办切换页
       * 展示内容: 可编辑待办列表、空状态、已完成列表和底部弹层
       * 数据来源: TodoListPanel 内部读取的本地待办记录
       */}
      <TodoListPanel embedded createRequestKey={createRequestKey} />
    </View>
  );
}

function NotesTabAnimatedPanel({ children }: { children: React.ReactNode }) {
  const enterProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enterProgress, {
      toValue: 1,
      duration: NOTE_TAB_POP_ANIMATION_MS,
      easing: Easing.out(Easing.back(1.15)),
      useNativeDriver: true,
    }).start();
  }, [enterProgress]);

  return (
    /*
     * 渲染位置: 合并入口的笔记 tab 内容容器
     * 展示内容: 笔记空状态或笔记卡片列表的整体弹出动画
     * 数据来源: activeTab === 'notes' 时传入的笔记内容节点
     */
    <Animated.View
      style={[
        styles.notesAnimatedPanel,
        {
          opacity: enterProgress,
          transform: [
            {
              scale: enterProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
            {
              translateY: enterProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // [变更] 修改前: 笔记页使用浅紫渐变和纯白纸张卡片
  // [变更] 修改后: 使用深色光晕背景与低透明描边的玻璃卡片
  // [原因] 保留笔记卡片结构，同时匹配推广页的暗色视觉
  gradientBackground: {
    flex: 1,
    backgroundColor: AppPalette.background,
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
    color: AppPalette.text,
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
  notesAnimatedPanel: {
    width: '100%',
  },
  notesPanel: {
    // [变更] 修改前: 使用 row + wrap 形成两列瀑布流
    // [变更] 修改后: 改为 column 单列堆叠
    // [原因] 当前笔记页要求主内容按纵向排列
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 18,
    paddingBottom: 32,
  },
  loadingCard: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    gap: 10,
  },
  loadingText: {
    color: AppPalette.brandLight,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 36,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
    gap: 12,
  },
  emptyTitle: {
    color: AppPalette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  emptyDescription: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: AppPalette.brand,
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
    width: '100%',
    minHeight: 180,
    borderRadius: 15,
    paddingTop: 21,
    paddingRight: 18,
    paddingBottom: 30,
    paddingLeft: 18,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  noteCardTitle: {
    color: AppPalette.text,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '600',
  },
  noteCardContent: {
    width: '100%',
    marginTop: 18,
    color: AppPalette.textMuted,
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
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
  },
  imageCountText: {
    color: AppPalette.brandLight,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  todoEmptyCard: {
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 34,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    gap: 10,
  },
  todoTitle: {
    color: AppPalette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  todoDescription: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
