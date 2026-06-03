import { TODO_ITEMS_STORAGE_KEY } from '@/services/storage-keys';
import { storage } from '@/services/storage';

export type TodoRepeat = 'none' | 'daily' | 'weekly';

export type TodoRecord = {
  id: string;
  title: string;
  reminderAt: string | null;
  repeat: TodoRepeat;
  notificationId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyTodo(): TodoRecord {
  const now = new Date().toISOString();

  return {
    id: createId('todo'),
    title: '',
    reminderAt: null,
    repeat: 'none',
    notificationId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function isTodoRepeat(value: unknown): value is TodoRepeat {
  return value === 'none' || value === 'daily' || value === 'weekly';
}

function normalizeTodoRecord(value: unknown): TodoRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<TodoRecord>;

  if (
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: record.id,
    title: record.title,
    reminderAt: typeof record.reminderAt === 'string' ? record.reminderAt : null,
    repeat: isTodoRepeat(record.repeat) ? record.repeat : 'none',
    notificationId: typeof record.notificationId === 'string' ? record.notificationId : null,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function loadTodos() {
  const rawValue = await storage.getItem(TODO_ITEMS_STORAGE_KEY);

  if (!rawValue) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    // 格式化: 本地 JSON 数组 → 过滤异常数据并按完成/更新时间排序 → 待办页面列表
    // 说明: 未完成事项优先展示最近更新，已完成事项用于单独折叠展示
    return parsedValue
      .map(normalizeTodoRecord)
      .filter((todo): todo is TodoRecord => todo !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export async function saveTodos(todos: TodoRecord[]) {
  await storage.setItem(TODO_ITEMS_STORAGE_KEY, JSON.stringify(todos));
}
