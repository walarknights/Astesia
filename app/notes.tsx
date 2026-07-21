import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppPalette } from '@/constants/theme';
import { getNoteImageCount, getNotePlainText, loadNotes, type NoteRecord } from '@/services/notes-storage';

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

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" backgroundColor={AppPalette.background} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.panelRoot}>
          {/*
           * 渲染位置: 笔记页顶部标题区
           * 展示内容: Astesia 小标题、笔记标题和右侧新建按钮
           * 数据来源: router.push('/note-editor') 导航回调
           */}
          <View style={styles.header}>
            <View>
              <ThemedText style={styles.eyebrow}>Astesia</ThemedText>
              <ThemedText type="title" style={styles.title}>笔记</ThemedText>
            </View>
            <Pressable accessibilityRole="button" style={styles.addButton} onPress={() => router.push('/note-editor')}>
              <MaterialIcons name="add" size={28} color="#FFFFFF" />
            </Pressable>
          </View>

          {isLoadingNotes ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={AppPalette.brandLight} />
              <ThemedText style={styles.loadingText}>正在读取笔记...</ThemedText>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}>
              <NotesTabAnimatedPanel>
                <NotesPanel
                  notes={notes}
                  onPressNote={(noteId) => router.push({ pathname: '/note-editor', params: { noteId } })}
                  onPressCreate={() => router.push('/note-editor')}
                />
              </NotesTabAnimatedPanel>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </>
  );
}

function NotesPanel({
  notes,
  onPressNote,
  onPressCreate,
}: {
  notes: NoteRecord[];
  onPressNote: (noteId: string) => void;
  onPressCreate: () => void;
}) {
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
       * 渲染位置: 笔记页主内容区
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
     * 渲染位置: 笔记页内容容器
     * 展示内容: 笔记空状态或笔记卡片列表的整体弹出动画
     * 数据来源: NotesScreen 传入的笔记内容节点
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
  // [变更] 修改前: 笔记页使用返回按钮、居中标题和独立滚动间距
  // [变更] 修改后: 改为待办页同款顶部标题区、右侧加号和内容滚动区
  // [原因] 让笔记页与待办页保持一致的页面排布
  safeArea: {
    flex: 1,
    backgroundColor: AppPalette.background,
  },
  panelRoot: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 18,
  },
  eyebrow: {
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  title: {
    color: AppPalette.text,
    fontSize: 32,
    lineHeight: 38,
  },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.brand,
    shadowColor: AppPalette.brandLight,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  scrollContent: {
    gap: 22,
    paddingHorizontal: 24,
    paddingBottom: 40,
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
    marginHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    padding: 28,
    backgroundColor: 'transparent',
    gap: 12,
  },
  loadingText: {
    color: AppPalette.textMuted,
  },
  emptyCard: {
    // [变更] 修改前: 空笔记卡片保留玻璃底色、描边和暗色投影
    // [变更] 修改后: 去掉外框和投影，只保留空状态内容
    // [原因] 避免笔记页出现黑色边框，与待办入口的轻量空状态观感一致
    alignItems: 'center',
    borderRadius: 28,
    padding: 28,
    backgroundColor: 'transparent',
    gap: 12,
  },
  emptyTitle: {
    color: AppPalette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  emptyDescription: {
    color: AppPalette.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
    backgroundColor: AppPalette.brand,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  noteCard: {
    width: '100%',
    minHeight: 180,
    borderRadius: 15,
    paddingTop: 21,
    paddingRight: 18,
    paddingBottom: 30,
    paddingLeft: 18,
    backgroundColor: AppPalette.surfaceSoft,
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
});
