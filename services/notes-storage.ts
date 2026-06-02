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
  contentHtml: string;
  blocks: NoteBlock[];
  createdAt: string;
  updatedAt: string;
};

const EMPTY_NOTE_HTML = '<p></p>';

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
    contentHtml: EMPTY_NOTE_HTML,
    blocks: [createTextBlock()],
    createdAt: now,
    updatedAt: now,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getHtmlFromBlocks(blocks: NoteBlock[]) {
  const html = blocks
    .map((block) => {
      if (block.type === 'image') {
        return `<p><img src="${escapeHtml(block.uri)}" alt="${escapeHtml(block.alt)}" /></p>`;
      }

      const normalizedLines = block.content
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);

      return normalizedLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
    })
    .join('');

  return html || EMPTY_NOTE_HTML;
}

function getPlainTextFromHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<img\b[^>]*alt=["']?([^"'>]*)["']?[^>]*>/gi, ' $1 ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
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
  const normalizedBlocks = blocks.length > 0 ? blocks : [createTextBlock()];
  const contentHtml = typeof record.contentHtml === 'string' && record.contentHtml.trim()
    ? record.contentHtml
    : getHtmlFromBlocks(normalizedBlocks);

  return {
    id: record.id,
    title: record.title,
    contentHtml,
    blocks: normalizedBlocks,
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
    contentHtml: note.contentHtml.trim() || EMPTY_NOTE_HTML,
    updatedAt: new Date().toISOString(),
  };
  const nextNotes = [savedNote, ...notes.filter((item) => item.id !== note.id)];

  await storage.setItem(NOTES_STORAGE_KEY, JSON.stringify(nextNotes));

  return savedNote;
}

export function getNotePlainText(note: NoteRecord) {
  if (note.contentHtml.trim()) {
    return getPlainTextFromHtml(note.contentHtml);
  }

  return note.blocks
    .filter((block): block is NoteTextBlock => block.type === 'text')
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join('\n');
}

export function getNoteImageCount(note: NoteRecord) {
  const htmlImageCount = (note.contentHtml.match(/<img\b/gi) ?? []).length;
  const blockImageCount = note.blocks.filter((block) => block.type === 'image').length;

  return Math.max(htmlImageCount, blockImageCount);
}
