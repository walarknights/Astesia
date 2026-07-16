import type { NoteRecord } from '@/services/notes-storage';

export type ActiveNoteEditorDraft = {
  editingNoteId: string;
  note: NoteRecord;
  updatedAt: string;
};

let activeNoteEditorDraft: ActiveNoteEditorDraft | null = null;

/**
 * 缓存当前挂载的笔记编辑页草稿，供屏幕知识库读取未保存内容。
 *
 * @param editingNoteId - 当前路由上的 noteId，新建笔记为空字符串
 * @param note - 笔记编辑页的本地草稿状态
 * @returns 无返回值
 * @example
 *   setActiveNoteEditorDraft('', note)
 */
export function setActiveNoteEditorDraft(editingNoteId: string, note: NoteRecord) {
  activeNoteEditorDraft = {
    editingNoteId,
    note: {
      ...note,
      blocks: [...note.blocks],
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 读取当前笔记编辑页草稿，只返回与路由 noteId 匹配的内容。
 *
 * @param editingNoteId - 当前路由上的 noteId，新建笔记为空字符串
 * @returns 可用于屏幕知识库的草稿快照
 * @example
 *   getActiveNoteEditorDraft(params.noteId ?? '')
 */
export function getActiveNoteEditorDraft(editingNoteId: string) {
  if (activeNoteEditorDraft?.editingNoteId !== editingNoteId) {
    return null;
  }

  return activeNoteEditorDraft;
}

/**
 * 清理指定笔记编辑页的草稿缓存，避免离开页面后被屏幕知识库误读。
 *
 * @param editingNoteId - 当前路由上的 noteId，新建笔记为空字符串
 * @returns 无返回值
 * @example
 *   clearActiveNoteEditorDraft('')
 */
export function clearActiveNoteEditorDraft(editingNoteId: string) {
  if (activeNoteEditorDraft?.editingNoteId === editingNoteId) {
    activeNoteEditorDraft = null;
  }
}
