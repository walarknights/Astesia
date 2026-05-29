import { NOTES_STORAGE_KEY } from '@/services/storage-keys';
import { storage } from '@/services/storage';

export type NoteTextBlock = {
  id: string;
  type: 'text';
  content: string;
};

export type NoteImageBlock = {
  id: string;
  type: 'image';
  uri: string;
  alt: string;
};

export type NoteBlock = NoteTextBlock | NoteImageBlock;

export type NoteRecord = {
  id: string;
  title: string;
  blocks: NoteBlock[];
  createdAt: string;
  updatedAt: string;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTextBlock(content = ''): NoteTextBlock {
  return {
    id: createId('text'),
    type: 'text',
    content,
  };
}

export function createImageBlock(uri: string, alt = '笔记图片'): NoteImageBlock {
  return {
    id: createId('image'),
    type: 'image',
    uri,
    alt,
  };
}

export function createEmptyNote(): NoteRecord {
  const now = new Date().toISOString();

  return {
    id: createId('note'),
    title: '',
    blocks: [createTextBlock()],
    createdAt: now,
    updatedAt: now,
  };
}

function isNoteBlock(value: unknown): value is NoteBlock {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const block = value as Partial<NoteBlock>;

  if (block.type === 'text') {
    return typeof block.id === 'string' && typeof block.content === 'string';
  }

  return block.type === 'image' && typeof block.id === 'string' && typeof block.uri === 'string';
}

function normalizeNoteRecord(value: unknown): NoteRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<NoteRecord>;

  if (
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string' ||
    !Array.isArray(record.blocks)
  ) {
    return null;
  }

  const blocks = record.blocks.filter(isNoteBlock);

  return {
    id: record.id,
    title: record.title,
    blocks: blocks.length > 0 ? blocks : [createTextBlock()],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function loadNotes() {
  const rawValue = await storage.getItem(NOTES_STORAGE_KEY);

  if (!rawValue) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    // 格式化: 存储 JSON 数组 → 过滤无效记录并按更新时间倒序 → 笔记列表
    // 说明: 保证列表页优先展示最近编辑的笔记
    return parsedValue
      .map(normalizeNoteRecord)
      .filter((note): note is NoteRecord => note !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export async function loadNoteById(noteId: string) {
  const notes = await loadNotes();

  return notes.find((note) => note.id === noteId) ?? null;
}

export async function saveNote(note: NoteRecord) {
  const notes = await loadNotes();
  const savedNote: NoteRecord = {
    ...note,
    title: note.title.trim(),
    updatedAt: new Date().toISOString(),
  };
  const nextNotes = [savedNote, ...notes.filter((item) => item.id !== note.id)];

  await storage.setItem(NOTES_STORAGE_KEY, JSON.stringify(nextNotes));

  return savedNote;
}

export function getNotePlainText(note: NoteRecord) {
  return note.blocks
    .filter((block): block is NoteTextBlock => block.type === 'text')
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join('\n');
}

