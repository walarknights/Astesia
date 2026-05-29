import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ComponentProps, useEffect, useMemo, useState } from 'react';
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

import { ThemedText } from '@/components/themed-text';
import {
  createEmptyNote,
  createImageBlock,
  createTextBlock,
  loadNoteById,
  saveNote,
  type NoteBlock,
  type NoteRecord,
} from '@/services/notes-storage';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

const EDITOR_PLACEHOLDER = '开始写下今天的想法...';

export default function NoteEditorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ noteId?: string }>();
  const editingNoteId = typeof params.noteId === 'string' ? params.noteId : '';
  const [note, setNote] = useState<NoteRecord>(() => createEmptyNote());
  const [focusedBlockId, setFocusedBlockId] = useState('');
  const [isLoading, setIsLoading] = useState(Boolean(editingNoteId));
  const [isSaving, setIsSaving] = useState(false);

  const titleValue = note.title;
  const updatedAtLabel = useMemo(() => formatDateTime(note.updatedAt), [note.updatedAt]);

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
          setNote(storedNote);
          setFocusedBlockId(storedNote.blocks[0]?.id ?? '');
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

  const handleChangeTextBlock = (blockId: string, content: string) => {
    setNote((currentNote) => ({
      ...currentNote,
      blocks: currentNote.blocks.map((block) => (
        block.id === blockId && block.type === 'text'
          ? { ...block, content }
          : block
      )),
    }));
  };

  const handleAddTextBlock = () => {
    setNote((currentNote) => ({
      ...currentNote,
      blocks: [...currentNote.blocks, createTextBlock()],
    }));
  };

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('无法插入图片', '请在系统设置中允许访问相册后重试。');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.86,
    });

    if (result.canceled) {
      return;
    }

    const imageUri = result.assets[0]?.uri;

    if (!imageUri) {
      Alert.alert('插入失败', '未读取到图片地址，请重新选择。');
      return;
    }

    setNote((currentNote) => {
      const imageBlock = createImageBlock(imageUri);
      const trailingTextBlock = createTextBlock();
      const insertIndex = Math.max(
        currentNote.blocks.findIndex((block) => block.id === focusedBlockId),
        currentNote.blocks.length - 1
      );
      const nextBlocks = [...currentNote.blocks];

      nextBlocks.splice(insertIndex + 1, 0, imageBlock, trailingTextBlock);

      return {
        ...currentNote,
        blocks: nextBlocks,
      };
    });
  };

  const handleRemoveBlock = (blockId: string) => {
    setNote((currentNote) => {
      const nextBlocks = currentNote.blocks.filter((block) => block.id !== blockId);

      return {
        ...currentNote,
        blocks: nextBlocks.length > 0 ? nextBlocks : [createTextBlock()],
      };
    });
  };

  const handleMoveBlock = (blockId: string, direction: -1 | 1) => {
    setNote((currentNote) => {
      const currentIndex = currentNote.blocks.findIndex((block) => block.id === blockId);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentNote.blocks.length) {
        return currentNote;
      }

      const nextBlocks = [...currentNote.blocks];
      const [movingBlock] = nextBlocks.splice(currentIndex, 1);

      nextBlocks.splice(nextIndex, 0, movingBlock);

      return {
        ...currentNote,
        blocks: nextBlocks,
      };
    });
  };

  const handleSave = async () => {
    const hasImageBlock = note.blocks.some((block) => block.type === 'image');
    const hasTextContent = note.blocks.some((block) => (
      block.type === 'text' && block.content.trim().length > 0
    ));

    if (!note.title.trim() && !hasTextContent && !hasImageBlock) {
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
      Alert.alert('保存成功', '笔记已保存到本地。', [
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
                value={titleValue}
                onChangeText={(nextTitle) => setNote((currentNote) => ({ ...currentNote, title: nextTitle }))}
                placeholder="笔记标题"
                placeholderTextColor="#A78BFA"
                style={styles.titleInput}
              />

              <View style={styles.editorCard}>
                <View style={styles.editorToolbar}>
                  <ToolbarButton icon="text-fields" label="文本" onPress={handleAddTextBlock} />
                  <ToolbarButton icon="image" label="图片" onPress={() => void handlePickImage()} />
                </View>

                {/*
                 * 渲染位置: 笔记编辑页正文区域
                 * 展示内容: 文本块和图片块组成的笔记内容
                 * 数据来源: note.blocks 本地编辑状态
                 */}
                {note.blocks.map((block, index) => (
                  <EditorBlock
                    key={block.id}
                    block={block}
                    index={index}
                    isFirst={index === 0}
                    isLast={index === note.blocks.length - 1}
                    onFocus={() => setFocusedBlockId(block.id)}
                    onChangeText={handleChangeTextBlock}
                    onMove={handleMoveBlock}
                    onRemove={handleRemoveBlock}
                  />
                ))}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

function EditorBlock({
  block,
  index,
  isFirst,
  isLast,
  onFocus,
  onChangeText,
  onMove,
  onRemove,
}: {
  block: NoteBlock;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onFocus: () => void;
  onChangeText: (blockId: string, content: string) => void;
  onMove: (blockId: string, direction: -1 | 1) => void;
  onRemove: (blockId: string) => void;
}) {
  if (block.type === 'image') {
    return (
      <View style={styles.imageBlock}>
        <Image source={{ uri: block.uri }} contentFit="cover" style={styles.noteImage} />
        <BlockActions
          blockId={block.id}
          isFirst={isFirst}
          isLast={isLast}
          onMove={onMove}
          onRemove={onRemove}
        />
      </View>
    );
  }

  return (
    <View style={styles.textBlock}>
      <View style={styles.blockIndexBadge}>
        <ThemedText style={styles.blockIndexText}>{index + 1}</ThemedText>
      </View>
      <TextInput
        multiline
        textAlignVertical="top"
        value={block.content}
        onFocus={onFocus}
        onChangeText={(content) => onChangeText(block.id, content)}
        placeholder={EDITOR_PLACEHOLDER}
        placeholderTextColor="#CBD5E1"
        style={styles.bodyInput}
      />
      <BlockActions
        blockId={block.id}
        isFirst={isFirst}
        isLast={isLast}
        onMove={onMove}
        onRemove={onRemove}
      />
    </View>
  );
}

function BlockActions({
  blockId,
  isFirst,
  isLast,
  onMove,
  onRemove,
}: {
  blockId: string;
  isFirst: boolean;
  isLast: boolean;
  onMove: (blockId: string, direction: -1 | 1) => void;
  onRemove: (blockId: string) => void;
}) {
  return (
    <View style={styles.blockActions}>
      <IconAction
        icon="keyboard-arrow-up"
        disabled={isFirst}
        onPress={() => onMove(blockId, -1)}
      />
      <IconAction
        icon="keyboard-arrow-down"
        disabled={isLast}
        onPress={() => onMove(blockId, 1)}
      />
      <IconAction icon="delete-outline" danger onPress={() => onRemove(blockId)} />
    </View>
  );
}

function ToolbarButton({
  icon,
  label,
  onPress,
}: {
  icon: MaterialIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" style={styles.toolbarButton} onPress={onPress}>
      <MaterialIcons name={icon} size={18} color="#6D28D9" />
      <ThemedText style={styles.toolbarButtonText}>{label}</ThemedText>
    </Pressable>
  );
}

function IconAction({
  icon,
  danger,
  disabled,
  onPress,
}: {
  icon: MaterialIconName;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const color = disabled ? '#CBD5E1' : danger ? '#DC2626' : '#64748B';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={styles.iconAction}>
      <MaterialIcons name={icon} size={20} color={color} />
    </Pressable>
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
    color: '#000000ff',
    fontSize: 28,
    lineHeight: 50  ,
    fontWeight: '700',
    shadowColor: '#ffffffff',
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
  editorToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 4,
  },
  toolbarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#F3E8FF',
  },
  toolbarButtonText: {
    color: '#6D28D9',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  textBlock: {
    borderRadius: 22,
    padding: 12,
    backgroundColor: '#F8FAFC',
    gap: 10,
  },
  blockIndexBadge: {
    alignSelf: 'flex-start',
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDE9FE',
  },
  blockIndexText: {
    color: '#6D28D9',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  bodyInput: {
    minHeight: 142,
    color: '#0F172A',
    fontSize: 18,
    lineHeight: 28,
  },
  imageBlock: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#F8FAFC',
  },
  noteImage: {
    width: '100%',
    height: 220,
    backgroundColor: '#E2E8F0',
  },
  blockActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  iconAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
});
