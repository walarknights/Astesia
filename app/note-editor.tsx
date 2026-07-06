import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { File as ExpoFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import TiptapRichTextEditor from '@/components/TiptapRichTextEditor';
import { ThemedText } from '@/components/themed-text';
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

  const updatedAtLabel = useMemo(() => formatDateTime(note.updatedAt), [note.updatedAt]);
  const imageCount = useMemo(() => getNoteImageCount(note), [note]);

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
            contentHtml: await normalizeEditorImageSources(storedNote.contentHtml),
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
      <StatusBar style="dark" backgroundColor="#F1E8FF" />
      <LinearGradient
        colors={['#F1E8FF', '#FFF7ED', '#FFFFFF']}
        locations={[0, 0.52, 1]}
        style={styles.gradientBackground}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardView}>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" style={styles.iconButton} onPress={() => router.back()}>
                <MaterialIcons name="arrow-back" size={24} color="#1F2937" />
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
                placeholderTextColor="#A78BFA"
                style={styles.titleInput}
              />

              <View style={styles.editorCard}>
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
                    <MaterialIcons name="image" size={18} color="#6D28D9" />
                    <ThemedText style={styles.insertImageText}>
                      {imageCount > 0 ? `插图 ${imageCount}` : '插图'}
                    </ThemedText>
                  </Pressable>
                </View>

                {/*
                 * 渲染位置: 笔记编辑页正文区域
                 * 展示内容: Expo DOM Components 承载的 Tiptap 富文本编辑器
                 * 数据来源: note.contentHtml、insertedImageUri 和 Tiptap 内部编辑状态
                 */}
                <View style={styles.richEditorFrame}>
                  <TiptapRichTextEditor
                    initialHtml={note.contentHtml}
                    insertedImageUri={insertedImageUri}
                    insertedImageToken={insertedImageToken}
                    placeholder={EDITOR_PLACEHOLDER}
                    onChangeHtml={handleChangeHtml}
                    dom={{
                      matchContents: true,
                      scrollEnabled: false,
                    }}
                  />
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
  gradientBackground: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  headerTextGroup: {
    flex: 1,
  },
  headerTitle: {
    color: '#111827',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  headerSubtitle: {
    marginTop: 2,
    color: '#7C3AED',
    fontSize: 12,
    lineHeight: 16,
  },
  saveButton: {
    minWidth: 72,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C3AED',
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
    backgroundColor: 'rgba(255,255,255,0.82)',
    color: '#111827',
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
    backgroundColor: '#FFFFFF',
    shadowColor: '#3B0764',
    shadowOpacity: 0.07,
    shadowRadius: 16,
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
    color: '#111827',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  editorMeta: {
    marginTop: 3,
    color: '#64748B',
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
    backgroundColor: '#F3E8FF',
  },
  insertImageText: {
    color: '#6D28D9',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  richEditorFrame: {
    overflow: 'hidden',
    minHeight: 560,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
  },
});
