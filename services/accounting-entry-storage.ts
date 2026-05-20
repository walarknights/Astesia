import {
  ACCOUNTING_ENTRIES_STORAGE_KEY,
  ACCOUNTING_MONTHLY_BUDGET_STORAGE_KEY,
} from '@/services/storage-keys';
import { storage } from '@/services/storage';

export type AccountingEntryRecord = {
  id: string;
  incomeExpenseType: '支出' | '收入';
  billType: string;
  amount: string;
  time: string;
  remark: string;
  createdAt: string;
};

export type AccountingMonthlyBudgetRecord = {
  amount: number;
  monthLeftDay: number;
  monthLabel: string;
  setDate: string;
};

function isAccountingEntryRecord(value: unknown): value is AccountingEntryRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.id === 'string' &&
    (entry.incomeExpenseType === '支出' || entry.incomeExpenseType === '收入') &&
    typeof entry.billType === 'string' &&
    typeof entry.amount === 'string' &&
    typeof entry.time === 'string' &&
    typeof entry.remark === 'string' &&
    typeof entry.createdAt === 'string'
  );
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 计算传入日期所在月份还剩余多少天，包含当天。
 *
 * @param {Date} date - 预算设置日期
 * @returns {number} 当前月剩余天数，最小为 1
 * @example
 *   getRemainingDaysIncludingToday(new Date('2026-04-15')) // => 16
 */
function getRemainingDaysIncludingToday(date: Date) {
  const currentDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return Math.max(1, Math.ceil((nextMonth.getTime() - currentDay.getTime()) / 86400000));
}

function createMonthlyBudgetRecord(value: number, referenceDate: Date): AccountingMonthlyBudgetRecord {
  const normalizedAmount = Number.isFinite(value) && value > 0 ? value : 0;

  return {
    amount: normalizedAmount,
    monthLeftDay: getRemainingDaysIncludingToday(referenceDate),
    monthLabel: formatMonthLabel(referenceDate),
    setDate: referenceDate.toISOString(),
  };
}

function isAccountingMonthlyBudgetRecord(value: unknown): value is AccountingMonthlyBudgetRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const budgetRecord = value as Record<string, unknown>;

  return (
    typeof budgetRecord.amount === 'number' &&
    typeof budgetRecord.monthLeftDay === 'number' &&
    typeof budgetRecord.monthLabel === 'string' &&
    typeof budgetRecord.setDate === 'string'
  );
}

export async function loadAccountingEntries() {
  try {
    const storedValue = await storage.getItem(ACCOUNTING_ENTRIES_STORAGE_KEY);

    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);
    return Array.isArray(parsedValue) ? parsedValue.filter(isAccountingEntryRecord) : [];
  } catch {
    return [];
  }
}

export async function saveAccountingEntry(entry: AccountingEntryRecord) {
  const currentEntries = await loadAccountingEntries();
  const nextEntries = [entry, ...currentEntries];

  await storage.setItem(ACCOUNTING_ENTRIES_STORAGE_KEY, JSON.stringify(nextEntries));
  return nextEntries;
}

export async function loadAccountingEntryById(entryId: string) {
  const currentEntries = await loadAccountingEntries();
  return currentEntries.find((entry) => entry.id === entryId) ?? null;
}

export async function deleteAccountingEntry(entryId: string) {
  const currentEntries = await loadAccountingEntries();
  const nextEntries = currentEntries.filter((entry) => entry.id !== entryId);

  await storage.setItem(ACCOUNTING_ENTRIES_STORAGE_KEY, JSON.stringify(nextEntries));
  return nextEntries;
}

export async function updateAccountingEntry(nextEntry: AccountingEntryRecord) {
  const currentEntries = await loadAccountingEntries();
  const nextEntries = currentEntries.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry));

  await storage.setItem(ACCOUNTING_ENTRIES_STORAGE_KEY, JSON.stringify(nextEntries));
  return nextEntries;
}

export async function loadAccountingMonthlyBudget(referenceDate: Date = new Date()) {
  try {
    const storedValue = await storage.getItem(ACCOUNTING_MONTHLY_BUDGET_STORAGE_KEY);

    if (!storedValue) {
      const initialBudgetRecord = await saveAccountingMonthlyBudget(0, referenceDate);
      return initialBudgetRecord;
    }

    const trimmedValue = storedValue.trim();
    const parsedValue = trimmedValue ? JSON.parse(trimmedValue) : null;

    if (isAccountingMonthlyBudgetRecord(parsedValue)) {
      if (Number.isFinite(parsedValue.amount) && parsedValue.amount >= 0) {
        return {
          amount: parsedValue.amount,
          monthLeftDay:
            Number.isInteger(parsedValue.monthLeftDay) && parsedValue.monthLeftDay > 0
              ? parsedValue.monthLeftDay
              : getRemainingDaysIncludingToday(referenceDate),
          monthLabel: parsedValue.monthLabel,
          setDate: parsedValue.setDate,
        };
      }
    }

    if (typeof parsedValue === 'number' && Number.isFinite(parsedValue) && parsedValue >= 0) {
      const migratedBudgetRecord = await saveAccountingMonthlyBudget(parsedValue, referenceDate);
      return migratedBudgetRecord;
    }

    const fallbackBudgetRecord = await saveAccountingMonthlyBudget(0, referenceDate);
    return fallbackBudgetRecord;
  } catch {
    return createMonthlyBudgetRecord(0, referenceDate);
  }
}

export async function saveAccountingMonthlyBudget(value: number, referenceDate: Date = new Date()) {
  const nextBudgetRecord = createMonthlyBudgetRecord(value, referenceDate);

  await storage.setItem(ACCOUNTING_MONTHLY_BUDGET_STORAGE_KEY, JSON.stringify(nextBudgetRecord));
  return nextBudgetRecord;
}
