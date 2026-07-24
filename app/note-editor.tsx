import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { File as ExpoFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import NoteRichTextEditor from '@/components/NoteRichTextEditor';
import { ThemedText } from '@/components/themed-text';
import { AppPalette } from '@/constants/theme';
import { clearActiveNoteEditorDraft, setActiveNoteEditorDraft } from '@/services/note-editor-draft';
import { sanitizeNoteContentHtml } from '@/services/note-html';
import {
  createEmptyNote,
  getNoteImageCount,
  getNotePlainText,
  loadNoteById,
  saveNote,
  type NoteRecord,
} from '@/services/notes-storage';
import { getPersistentWebImageUri } from '@/services/web-image';

const EDITOR_PLACEHOLDER = '开始写下今天的想法...';
const EDITOR_CARET_VISIBLE_OFFSET = 140;
const IMAGE_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp', 
};

export default function NoteEditorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ noteId?: string }>();
  const editingNoteId = typeof params.noteId === 'string' ? params.noteId : '';
  const [note, setNote] = useState<NoteRecord>(() => createEmptyNote());
  const [insertedImageUri, setInsertedImageUri] = useState('');
  const [insertedImageToken, setInsertedImageToken] = useState('');
  const [isLoading, setIsLoading] = useState(Boolean(editingNoteId));
  const [isSaving, setIsSaving] = useState(false);
  const editorScrollRef = useRef<ScrollView>(null);
  const editorCardTopRef = useRef(0);
  const editorFrameTopRef = useRef(0);
  const lastEditorScrollTargetRef = useRef(0);

  const updatedAtLabel = useMemo(() => formatDateTime(note.updatedAt), [note.updatedAt]);
  const imageCount = useMemo(() => getNoteImageCount(note), [note]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    // [变更] 修改前: 屏幕知识库只能读取已保存的笔记内容，无法看到编辑器内的未保存草稿
    // [变更] 修改后: 编辑页每次本地草稿变化时同步到内存缓存，供 AI 抽屉实时读取
    // [原因] 用户在编写笔记时需要让屏幕知识库理解当前正在输入的标题、正文和图片数量
    setActiveNoteEditorDraft(editingNoteId, note);
  }, [editingNoteId, isLoading, note]);

  useEffect(() => {
    return () => {
      clearActiveNoteEditorDraft(editingNoteId);
    };
  }, [editingNoteId]);

  useEffect(() => {
    if (!editingNoteId) {
      setIsLoading(false);
      return;
    }

    let active = true;

    const syncNote = async () => {
      setIsLoading(true);

      try {
        const storedNote = await loadNoteById(editingNoteId);

        if (active && storedNote) {
          setNote({
            ...storedNote,
            contentHtml: sanitizeNoteContentHtml(
              await normalizeEditorImageSources(storedNote.contentHtml)
            ),
          });
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void syncNote();

    return () => {
      active = false;
    };
  }, [editingNoteId]);

  const handleChangeHtml = useCallback(async (contentHtml: string) => {
    setNote((currentNote) => ({
      ...currentNote,
      contentHtml,
    }));
  }, []);

  const handleEditorCaretPositionChange = useCallback((caretOffsetY: number) => {
    if (Platform.OS === 'web') {
      return;
    }

    const targetScrollY = Math.max(
      0,
      editorCardTopRef.current
        + editorFrameTopRef.current
        + caretOffsetY
        - EDITOR_CARET_VISIBLE_OFFSET
    );

    if (Math.abs(targetScrollY - lastEditorScrollTargetRef.current) < 24) {
      return;
    }

    lastEditorScrollTargetRef.current = targetScrollY;

    requestAnimationFrame(() => {
      editorScrollRef.current?.scrollTo({ y: targetScrollY, animated: true });
    });
  }, []);

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('无法插入图片', '请在系统设置中允许访问相册后重试。');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      // [变更] 修改前: Web 端沿用原生选择参数，只拿到临时 URI
      // [变更] 修改后: Web 端额外请求 base64，必要时可转成持久化 data URL
      // [原因] PWA 刷新后 blob 地址会失效，需要保存真正可落盘的图片内容
      base64: Platform.OS === 'web',
      quality: 0.86,
    });

    if (result.canceled) {
      return;
    }

    const imageAsset = result.assets[0];
    const imageUri = imageAsset?.uri;

    if (!imageUri) {
      Alert.alert('插入失败', '未读取到图片地址，请重新选择。');
      return;
    }

    try {
      const editorImageSource = await getEditorImageSource({
        uri: imageUri,
        fileName: imageAsset.fileName,
        file: imageAsset.file,
        base64: imageAsset.base64,
        mimeType: imageAsset.mimeType,
      });

      setInsertedImageUri(editorImageSource);
      setInsertedImageToken(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    } catch {
      Alert.alert('插入失败', '图片暂时无法转换为编辑器可展示的格式，请换一张图片重试。');
    }
  };

  const handleSave = async () => {
    const hasImageContent = getNoteImageCount(note) > 0;
    const hasTextContent = getNotePlainText(note).length > 0;

    if (!note.title.trim() && !hasTextContent && !hasImageContent) {
      Alert.alert('还没有内容', '请输入标题、正文或插入图片后再保存。');
      return;
    }

    setIsSaving(true);

    try {
      const savedNote = await saveNote({
        ...note,
        title: note.title.trim() || '未命名笔记',
      });

      setNote(savedNote);
      Alert.alert('保存成功', '富文本笔记已保存到本地。', [
        {
          text: '继续编辑',
          style: 'cancel',
        },
        {
          text: '返回列表',
          onPress: () => router.replace('/notes'),
        },
      ]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" backgroundColor={AppPalette.background} />
      <LinearGradient
        colors={['#1E1E3A', '#171726', AppPalette.background]}
        locations={[0, 0.52, 1]}
        style={styles.gradientBackground}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            // [变更] 修改前: Android 不启用键盘避让，标题与富文本正文可能停留在软键盘后方
            // [变更] 修改后: Android 缩短编辑区高度，外层滚动容器按正文光标位置继续滚动
            // [原因] 富文本编辑器由 WebView 承载，不能只依赖系统自动平移整个页面
            behavior={Platform.select({ android: 'height', ios: 'padding' })}
            style={styles.keyboardView}>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" style={styles.iconButton} onPress={() => router.back()}>
                <MaterialIcons name="arrow-back" size={24} color={AppPalette.text} />
              </Pressable>
              <View style={styles.headerTextGroup}>
                <ThemedText style={styles.headerTitle}>编写笔记</ThemedText>
                <ThemedText style={styles.headerSubtitle}>
                  {isLoading ? '正在读取内容' : `最近编辑 ${updatedAtLabel}`}
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => void handleSave()}
                style={[styles.saveButton, isSaving ? styles.disabledButton : null]}>
                <ThemedText style={styles.saveButtonText}>{isSaving ? '保存中' : '保存'}</ThemedText>
              </Pressable>
            </View>

            <ScrollView
              ref={editorScrollRef}
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}>
              {/*
               * 渲染位置: 笔记编辑页顶部
               * 展示内容: 笔记标题输入框
               * 数据来源: note.title 本地编辑状态
               */}
              <TextInput
                value={note.title}
                onChangeText={(nextTitle) => setNote((currentNote) => ({ ...currentNote, title: nextTitle }))}
                placeholder="笔记标题"
                placeholderTextColor={AppPalette.textSubtle}
                style={styles.titleInput}
              />

              <View
                onLayout={({ nativeEvent }) => {
                  editorCardTopRef.current = nativeEvent.layout.y;
                }}
                style={styles.editorCard}>
                <View style={styles.editorHeaderRow}>
                  <View>
                    <ThemedText style={styles.editorTitle}>富文本编辑器</ThemedText>
                    <ThemedText style={styles.editorMeta}>
                      支持加粗、下划线、标题、列表、引用和图片
                    </ThemedText>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handlePickImage()}
                    style={styles.insertImageButton}>
                    <MaterialIcons name="image" size={18} color={AppPalette.brandLight} />
                    <ThemedText style={styles.insertImageText}>
                      {imageCount > 0 ? `插图 ${imageCount}` : '插图'}
                    </ThemedText>
                  </Pressable>
                </View>

                {/*
                 * 渲染位置: 笔记编辑页正文区域
                 * 展示内容: 平台分流后的富文本编辑器；原生端使用稳定 WebView，Web 端使用 Tiptap
                 * 数据来源: note.contentHtml、insertedImageUri 和编辑器内部编辑状态
                 */}
                <View
                  onLayout={({ nativeEvent }) => {
                    editorFrameTopRef.current = nativeEvent.layout.y;
                  }}
                  style={styles.richEditorFrame}>
                  {isLoading ? (
                    <View style={styles.editorLoadingState}>
                      <ThemedText style={styles.editorLoadingText}>正在加载编辑器内容...</ThemedText>
                    </View>
                  ) : (
                    <NoteRichTextEditor
                      key={note.id}
                      initialHtml={note.contentHtml}
                      insertedImageUri={insertedImageUri}
                      insertedImageToken={insertedImageToken}
                      placeholder={EDITOR_PLACEHOLDER}
                      onCaretPositionChange={handleEditorCaretPositionChange}
                      onChangeHtml={handleChangeHtml}
                    />
                  )}
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '刚刚';
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function getFileExtension(value?: string | null) {
  if (!value) {
    return null;
  }

  const sanitizedValue = value.split('?')[0].split('#')[0];
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(sanitizedValue);

  return extensionMatch?.[1]?.toLowerCase() ?? null;
}

function getImageMimeType(uri: string, fileName?: string | null, mimeType?: string | null) {
  if (mimeType?.startsWith('image/')) {
    return mimeType;
  }

  const extension = getFileExtension(fileName) ?? getFileExtension(uri);

  return extension ? IMAGE_MIME_TYPE_BY_EXTENSION[extension] ?? 'image/jpeg' : 'image/jpeg';
}

async function getEditorImageSource({
  uri,
  fileName,
  file,
  base64,
  mimeType,
}: {
  uri: string;
  fileName?: string | null;
  file?: globalThis.File | null;
  base64?: string | null;
  mimeType?: string | null;
}) {
  if (Platform.OS === 'web') {
    return getPersistentWebImageUri({
      uri,
      name: fileName,
      file,
      base64,
      mimeType,
    });
  }

  if (uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  const base64Image = await new ExpoFile(uri).base64();

  return `data:${getImageMimeType(uri, fileName, mimeType)};base64,${base64Image}`;
}

async function normalizeEditorImageSources(contentHtml: string) {
  const imageSourcePattern = /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi;
  const imageMatches = [...contentHtml.matchAll(imageSourcePattern)];

  if (imageMatches.length === 0) {
    return contentHtml;
  }

  let normalizedHtml = contentHtml;

  for (const match of imageMatches) {
    const [fullMatch, beforeSource, sourceUri, afterSource] = match;

    if (!sourceUri.startsWith('file://')) {
      continue;
    }

    try {
      const nextSourceUri = await getEditorImageSource({ uri: sourceUri });
      normalizedHtml = normalizedHtml.replace(
        fullMatch,
        `<img${beforeSource}src="${nextSourceUri}"${afterSource}>`
      );
    } catch {
      // 旧图片 URI 转换失败时保留原 HTML，避免打开笔记时丢失内容结构。
    }
  }

  return normalizedHtml;
}

const styles = StyleSheet.create({
  // [变更] 修改前: 编辑器页面使用浅色渐变与白色输入卡片
  // [变更] 修改后: 改为深色渐变、玻璃卡片和靛青操作按钮
  // [原因] 编辑体验延续 App 新主题，并保持原有输入与保存逻辑
  gradientBackground: {
    flex: 1,
    backgroundColor: AppPalette.background,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.surfaceSoft,
  },
  headerTextGroup: {
    flex: 1,
  },
  headerTitle: {
    color: AppPalette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  headerSubtitle: {
    marginTop: 2,
    color: AppPalette.brandLight,
    fontSize: 12,
    lineHeight: 16,
  },
  saveButton: {
    minWidth: 72,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.brand,
  },
  disabledButton: {
    opacity: 0.58,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 40,
  },
  titleInput: {
    minHeight: 68,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    color: AppPalette.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  editorCard: {
    marginTop: 16,
    borderRadius: 28,
    padding: 14,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
    gap: 14,
  },
  editorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  editorTitle: {
    color: AppPalette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  editorMeta: {
    marginTop: 3,
    color: AppPalette.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  insertImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
  },
  insertImageText: {
    color: AppPalette.brandLight,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  richEditorFrame: {
    overflow: 'hidden',
    minHeight: 560,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    borderRadius: 24,
    backgroundColor: AppPalette.surface,
  },
  editorLoadingState: {
    minHeight: 560,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  editorLoadingText: {
    color: AppPalette.brandLight,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
});
