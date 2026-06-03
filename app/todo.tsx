import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
  createEmptyTodo,
  loadTodos,
  saveTodos,
  type TodoRecord,
  type TodoRepeat,
} from '@/services/todo-storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const REPEAT_OPTIONS: { label: string; value: TodoRepeat }[] = [
  { label: '不重复', value: 'none' },
  { label: '每天', value: 'daily' },
  { label: '每周', value: 'weekly' },
];
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => index * 5);
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => index);

type TodoPanelProps = {
  createRequestKey?: number;
  embedded?: boolean;
};

type DatePickerDay = {
  key: string;
  label: string;
  value: string;
  isCurrentMonth: boolean;
};

export default function TodoScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <TodoPanel />
      </SafeAreaView>
    </>
  );
}

export function TodoPanel({ createRequestKey = 0, embedded = false }: TodoPanelProps) {
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draftTodo, setDraftTodo] = useState<TodoRecord | null>(null);
  const [isEditorVisible, setIsEditorVisible] = useState(false);
  const [isReminderVisible, setIsReminderVisible] = useState(false);
  const [reminderDateInput, setReminderDateInput] = useState(getDefaultDateInput());
  const [reminderTimeInput, setReminderTimeInput] = useState(getDefaultTimeInput());
  const [reminderRepeat, setReminderRepeat] = useState<TodoRepeat>('none');

  const activeTodos = useMemo(
    () => todos.filter((todo) => !todo.completedAt),
    [todos]
  );
  const completedTodos = useMemo(
    () => todos.filter((todo) => todo.completedAt),
    [todos]
  );

  useEffect(() => {
    let active = true;

    const syncTodos = async () => {
      setIsLoading(true);

      try {
        const storedTodos = await loadTodos();

        if (active) {
          setTodos(storedTodos);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void syncTodos();

    return () => {
      active = false;
    };
  }, []);

  const persistTodos = useCallback(async (nextTodos: TodoRecord[]) => {
    setTodos(nextTodos);
    await saveTodos(nextTodos);
  }, []);

  const openEditor = useCallback((todo?: TodoRecord) => {
    const nextDraft = todo ?? createEmptyTodo();
    setDraftTodo(nextDraft);
    setIsEditorVisible(true);
  }, []);

  useEffect(() => {
    if (createRequestKey > 0) {
      openEditor();
    }
  }, [createRequestKey, openEditor]);

  const closeEditor = useCallback(() => {
    setIsEditorVisible(false);
    setDraftTodo(null);
  }, []);

  const openReminderSheet = useCallback(() => {
    if (!draftTodo) {
      return;
    }

    const reminderDate = draftTodo.reminderAt ? new Date(draftTodo.reminderAt) : getNextReminderDate();
    setReminderDateInput(formatDateInput(reminderDate));
    setReminderTimeInput(formatTimeInput(reminderDate));
    setReminderRepeat(draftTodo.repeat);
    setIsReminderVisible(true);
  }, [draftTodo]);

  const handleSaveReminder = useCallback(() => {
    const nextReminderAt = createReminderDate(reminderDateInput, reminderTimeInput);

    if (!nextReminderAt) {
      Alert.alert('提醒时间无效', '请选择一个有效的提醒日期和时间。');
      return;
    }

    if (reminderRepeat === 'none' && nextReminderAt.getTime() <= Date.now()) {
      Alert.alert('提醒时间已过', '单次提醒需要选择一个未来时间。');
      return;
    }

    setDraftTodo((current) => current
      ? {
          ...current,
          reminderAt: nextReminderAt.toISOString(),
          repeat: reminderRepeat,
        }
      : current);
    setIsReminderVisible(false);
  }, [reminderDateInput, reminderRepeat, reminderTimeInput]);

  const handleClearReminder = useCallback(() => {
    setDraftTodo((current) => current
      ? {
          ...current,
          reminderAt: null,
          repeat: 'none',
        }
      : current);
    setIsReminderVisible(false);
  }, []);

  const handleSaveTodo = useCallback(async () => {
    if (!draftTodo) {
      return;
    }

    const title = draftTodo.title.trim();

    if (!title) {
      Alert.alert('请输入待办内容', '待办事项不能为空。');
      return;
    }

    const previousTodo = todos.find((todo) => todo.id === draftTodo.id);
    await cancelNotification(previousTodo?.notificationId ?? null);

    const now = new Date().toISOString();
    const todoToSchedule: TodoRecord = {
      ...draftTodo,
      title,
      updatedAt: now,
    };
    const notificationId = await scheduleTodoNotification(todoToSchedule);
    const savedTodo: TodoRecord = {
      ...todoToSchedule,
      notificationId,
    };
    const nextTodos = [
      savedTodo,
      ...todos.filter((todo) => todo.id !== savedTodo.id),
    ];

    await persistTodos(nextTodos);
    closeEditor();
  }, [closeEditor, draftTodo, persistTodos, todos]);

  const handleToggleComplete = useCallback(async (todo: TodoRecord) => {
    const isCompleting = !todo.completedAt;
    await cancelNotification(todo.notificationId);

    const updatedTodo: TodoRecord = {
      ...todo,
      completedAt: isCompleting ? new Date().toISOString() : null,
      notificationId: null,
      updatedAt: new Date().toISOString(),
    };
    const nextTodos = todos.map((item) => item.id === todo.id ? updatedTodo : item);

    await persistTodos(nextTodos);
  }, [persistTodos, todos]);

  return (
    <>
      <View style={[styles.panelRoot, embedded ? styles.panelRootEmbedded : null]}>
        {embedded ? null : (
          <View style={styles.header}>
          <View>
            <ThemedText style={styles.eyebrow}>Astesia</ThemedText>
            <ThemedText type="title" style={styles.title}>待办事项</ThemedText>
          </View>
          <Pressable accessibilityRole="button" style={styles.addButton} onPress={() => openEditor()}>
            <MaterialIcons name="add" size={28} color="#FFFFFF" />
          </Pressable>
          </View>
        )}

        {isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#3B82F6" />
            <ThemedText style={styles.loadingText}>正在读取待办...</ThemedText>
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}>
            {/*
             * 渲染位置: 待办页面主内容区
             * 展示内容: 未完成待办、空状态和按需出现的已完成列表
             * 数据来源: loadTodos() 读取的本地待办记录
             */}
            {activeTodos.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialIcons name="task-alt" size={48} color="#60A5FA" />
                <ThemedText style={styles.emptyTitle}>还没有待办</ThemedText>
                <ThemedText style={styles.emptyDescription}>
                  点击底部加号创建事项，可设置准时、每天或每周提醒。
                </ThemedText>
                <Pressable style={styles.primaryButton} onPress={() => openEditor()}>
                  <ThemedText style={styles.primaryButtonText}>新建待办</ThemedText>
                </Pressable>
              </View>
            ) : (
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>未完成</ThemedText>
                {activeTodos.map((todo) => (
                  <TodoItem
                    key={todo.id}
                    todo={todo}
                    onLongPress={() => openEditor(todo)}
                    onToggleComplete={() => void handleToggleComplete(todo)}
                  />
                ))}
              </View>
            )}

            {completedTodos.length > 0 ? (
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>已完成</ThemedText>
                {completedTodos.map((todo) => (
                  <TodoItem
                    key={todo.id}
                    todo={todo}
                    onLongPress={() => openEditor(todo)}
                    onToggleComplete={() => void handleToggleComplete(todo)}
                  />
                ))}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>

      <TodoEditorSheet
        draftTodo={draftTodo}
        visible={isEditorVisible}
        onChangeDraft={setDraftTodo}
        onClose={closeEditor}
        onOpenReminder={openReminderSheet}
        onSave={() => void handleSaveTodo()}
      />
      <ReminderSheet
        dateInput={reminderDateInput}
        repeat={reminderRepeat}
        timeInput={reminderTimeInput}
        visible={isReminderVisible}
        onChangeDateInput={setReminderDateInput}
        onChangeRepeat={setReminderRepeat}
        onChangeTimeInput={setReminderTimeInput}
        onClear={handleClearReminder}
        onClose={() => setIsReminderVisible(false)}
        onSave={handleSaveReminder}
      />
    </>
  );
}

function TodoItem({
  todo,
  onLongPress,
  onToggleComplete,
}: {
  todo: TodoRecord;
  onLongPress: () => void;
  onToggleComplete: () => void;
}) {
  const completed = Boolean(todo.completedAt);

  return (
    <Pressable
      accessibilityRole="button"
      delayLongPress={350}
      onLongPress={onLongPress}
      style={[styles.todoCard, completed ? styles.todoCardCompleted : null]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed }}
        style={[styles.checkButton, completed ? styles.checkButtonDone : null]}
        onPress={onToggleComplete}>
        {completed ? <MaterialIcons name="check" size={18} color="#FFFFFF" /> : null}
      </Pressable>
      <View style={styles.todoContent}>
        <ThemedText style={[styles.todoTitle, completed ? styles.todoTitleDone : null]}>
          {todo.title}
        </ThemedText>
        {todo.reminderAt ? (
          <View style={styles.reminderRow}>
            <MaterialIcons name="notifications-none" size={16} color="#64748B" />
            <ThemedText style={styles.reminderText}>{formatReminderLabel(todo)}</ThemedText>
          </View>
        ) : null}
      </View>
      <MaterialIcons name="more-horiz" size={20} color="#94A3B8" />
    </Pressable>
  );
}

function TodoEditorSheet({
  draftTodo,
  visible,
  onChangeDraft,
  onClose,
  onOpenReminder,
  onSave,
}: {
  draftTodo: TodoRecord | null;
  visible: boolean;
  onChangeDraft: (todo: TodoRecord | null) => void;
  onClose: () => void;
  onOpenReminder: () => void;
  onSave: () => void;
}) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.editorSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <ThemedText style={styles.sheetTitle}>{draftTodo?.title ? '编辑待办' : '新建待办'}</ThemedText>
            <Pressable onPress={onSave} style={styles.saveButton}>
              <ThemedText style={styles.saveButtonText}>完成</ThemedText>
            </Pressable>
          </View>
          {/*
           * 渲染位置: 底部弹出的待办编辑面板
           * 展示内容: 待办输入框、提醒时间入口和保存操作
           * 数据来源: draftTodo 编辑草稿状态
           */}
          <TextInput
            autoFocus
            multiline
            placeholder="要做些什么？"
            placeholderTextColor="#94A3B8"
            style={styles.todoInput}
            value={draftTodo?.title ?? ''}
            onChangeText={(title) => onChangeDraft(draftTodo ? { ...draftTodo, title } : draftTodo)}
          />
          <Pressable style={styles.reminderButton} onPress={onOpenReminder}>
            <View style={styles.reminderButtonIcon}>
              <MaterialIcons name="schedule" size={20} color="#2563EB" />
            </View>
            <View style={styles.reminderButtonTextGroup}>
              <ThemedText style={styles.reminderButtonTitle}>提醒时间</ThemedText>
              <ThemedText style={styles.reminderButtonDescription}>
                {draftTodo?.reminderAt ? formatReminderLabel(draftTodo) : '未设置'}
              </ThemedText>
            </View>
            <MaterialIcons name="keyboard-arrow-right" size={24} color="#94A3B8" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ReminderSheet({
  dateInput,
  repeat,
  timeInput,
  visible,
  onChangeDateInput,
  onChangeRepeat,
  onChangeTimeInput,
  onClear,
  onClose,
  onSave,
}: {
  dateInput: string;
  repeat: TodoRepeat;
  timeInput: string;
  visible: boolean;
  onChangeDateInput: (value: string) => void;
  onChangeRepeat: (repeat: TodoRepeat) => void;
  onChangeTimeInput: (value: string) => void;
  onClear: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const selectedDate = useMemo(
    () => parseDateInput(dateInput) ?? getNextReminderDate(),
    [dateInput]
  );
  const selectedTime = useMemo(
    () => parseTimeInput(timeInput) ?? getTimeParts(getNextReminderDate()),
    [timeInput]
  );
  const [datePickerMonth, setDatePickerMonth] = useState(selectedDate);
  const datePickerMonthLabel = `${datePickerMonth.getFullYear()}年${datePickerMonth.getMonth() + 1}月`;
  // 格式化: 当前展示月份 → 生成包含前后补位的 6 周日期网格 → 日历选择项
  // 说明: 让提醒日期通过点击选择，避免手动输入导致格式错误
  const datePickerDays = useMemo(() => getDatePickerDays(datePickerMonth), [datePickerMonth]);

  useEffect(() => {
    if (visible) {
      setDatePickerMonth(selectedDate);
    }
  }, [selectedDate, visible]);

  const handleChangeDatePickerMonth = (offset: number) => {
    setDatePickerMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const handlePickHour = (hour: number) => {
    onChangeTimeInput(formatTimeParts(hour, selectedTime.minute));
  };

  const handlePickMinute = (minute: number) => {
    onChangeTimeInput(formatTimeParts(selectedTime.hour, minute));
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.sheetOverlay}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.reminderSheet}>
          <View style={styles.sheetHandle} />
          <ThemedText style={styles.sheetTitle}>设置提醒时间</ThemedText>
          {/*
           * 渲染位置: 底部弹出的提醒设置面板
           * 展示内容: 日历日期选择器、时间输入、重复频率和确认按钮
           * 数据来源: reminderDateInput / reminderTimeInput / reminderRepeat 状态
           */}
          <View style={styles.optionGroup}>
            <ThemedText style={styles.optionLabel}>日期</ThemedText>
            <View style={styles.datePickerContent}>
              <View style={styles.datePickerHeader}>
                <Pressable style={styles.datePickerMonthButton} onPress={() => handleChangeDatePickerMonth(-1)}>
                  <MaterialIcons name="chevron-left" size={22} color="#2563EB" />
                </Pressable>
                <ThemedText style={styles.datePickerMonthText}>{datePickerMonthLabel}</ThemedText>
                <Pressable style={styles.datePickerMonthButton} onPress={() => handleChangeDatePickerMonth(1)}>
                  <MaterialIcons name="chevron-right" size={22} color="#2563EB" />
                </Pressable>
              </View>
              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((weekday) => (
                  <ThemedText key={weekday} style={styles.weekdayText}>
                    {weekday}
                  </ThemedText>
                ))}
              </View>
              <View style={styles.dateGrid}>
                {datePickerDays.map((day) => (
                  <Pressable
                    key={day.key}
                    style={[
                      styles.dateGridItem,
                      !day.isCurrentMonth ? styles.dateGridItemMuted : null,
                      dateInput === day.value ? styles.dateGridItemActive : null,
                    ]}
                    onPress={() => onChangeDateInput(day.value)}>
                    <ThemedText
                      style={[
                        styles.dateGridItemText,
                        !day.isCurrentMonth ? styles.dateGridItemTextMuted : null,
                        dateInput === day.value ? styles.dateGridItemTextActive : null,
                      ]}>
                      {day.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <View style={styles.optionGroup}>
            <ThemedText style={styles.optionLabel}>时间</ThemedText>
            {/*
             * 渲染位置: 提醒设置面板的时间选择区域
             * 展示内容: 小时和分钟选项网格，点击后更新时间
             * 数据来源: selectedTime 和 onChangeTimeInput
             */}
            <View style={styles.timePickerCard}>
              <View style={styles.timePreviewBadge}>
                <ThemedText style={styles.timePreviewText}>{timeInput}</ThemedText>
              </View>
              <ThemedText style={styles.timePickerSubTitle}>小时</ThemedText>
              <View style={styles.timeOptionGrid}>
                {HOUR_OPTIONS.map((hour) => (
                  <Pressable
                    key={hour}
                    style={[
                      styles.timeOptionChip,
                      selectedTime.hour === hour ? styles.timeOptionChipActive : null,
                    ]}
                    onPress={() => handlePickHour(hour)}>
                    <ThemedText
                      style={[
                        styles.timeOptionChipText,
                        selectedTime.hour === hour ? styles.timeOptionChipTextActive : null,
                      ]}>
                      {padNumber(hour)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText style={styles.timePickerSubTitle}>分钟</ThemedText>
              <View style={styles.timeOptionGrid}>
                {MINUTE_OPTIONS.map((minute) => (
                  <Pressable
                    key={minute}
                    style={[
                      styles.timeOptionChip,
                      selectedTime.minute === minute ? styles.timeOptionChipActive : null,
                    ]}
                    onPress={() => handlePickMinute(minute)}>
                    <ThemedText
                      style={[
                        styles.timeOptionChipText,
                        selectedTime.minute === minute ? styles.timeOptionChipTextActive : null,
                      ]}>
                      {padNumber(minute)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <View style={styles.optionGroup}>
            <ThemedText style={styles.optionLabel}>重复</ThemedText>
            <View style={styles.chipRow}>
              {REPEAT_OPTIONS.map((option) => (
                <OptionChip
                  key={option.value}
                  active={repeat === option.value}
                  label={option.label}
                  onPress={() => onChangeRepeat(option.value)}
                />
              ))}
            </View>
          </View>
          <View style={styles.sheetActionRow}>
            <Pressable style={styles.clearButton} onPress={onClear}>
              <ThemedText style={styles.clearButtonText}>清除</ThemedText>
            </Pressable>
            <Pressable style={styles.confirmButton} onPress={onSave}>
              <ThemedText style={styles.confirmButtonText}>确定</ThemedText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OptionChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.optionChip, active ? styles.optionChipActive : null]} onPress={onPress}>
      <ThemedText style={[styles.optionChipText, active ? styles.optionChipTextActive : null]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

async function cancelNotification(notificationId: string | null | undefined) {
  if (!notificationId || Platform.OS === 'web') {
    return;
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // 删除已失效通知时不阻塞待办状态更新。
  }
}

async function scheduleTodoNotification(todo: TodoRecord) {
  if (!todo.reminderAt || todo.completedAt || Platform.OS === 'web') {
    return null;
  }

  const permission = await Notifications.getPermissionsAsync();
  const permissionStatus = permission.granted
    ? permission
    : await Notifications.requestPermissionsAsync();

  if (!permissionStatus.granted) {
    Alert.alert('未开启通知权限', '待办已保存，但需要开启系统通知权限后才能准时提醒。');
    return null;
  }

  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '待办提醒',
        body: todo.title,
        sound: true,
      },
      trigger: createNotificationTrigger(todo.reminderAt, todo.repeat),
    });
  } catch {
    Alert.alert('提醒创建失败', '待办已保存，但当前设备未能创建本地通知。');
    return null;
  }
}

function createNotificationTrigger(reminderAt: string, repeat: TodoRepeat): Notifications.NotificationTriggerInput {
  const reminderDate = new Date(reminderAt);

  if (repeat === 'daily') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: reminderDate.getHours(),
      minute: reminderDate.getMinutes(),
    };
  }

  if (repeat === 'weekly') {
    return {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: reminderDate.getDay() + 1,
      hour: reminderDate.getHours(),
      minute: reminderDate.getMinutes(),
    };
  }

  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: reminderDate,
  };
}

function getNextReminderDate() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
}

function getDefaultTimeInput() {
  return formatTimeInput(getNextReminderDate());
}

function getDefaultDateInput() {
  return formatDateInput(getNextReminderDate());
}

function parseDateInput(dateInput: string) {
  const matchedDate = dateInput.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!matchedDate) {
    return null;
  }

  const year = Number(matchedDate[1]);
  const month = Number(matchedDate[2]);
  const day = Number(matchedDate[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function parseTimeInput(timeInput: string) {
  const parts = timeInput.trim().split(':');

  if (parts.length !== 2) {
    return null;
  }

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return { hour, minute };
}

function createReminderDate(dateInput: string, timeInput: string) {
  const date = parseDateInput(dateInput);
  const parsedTime = parseTimeInput(timeInput);

  if (!date || !parsedTime) {
    return null;
  }

  date.setHours(parsedTime.hour, parsedTime.minute, 0, 0);
  return date;
}

function getDaysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getDatePickerDays(monthDate: Date): DatePickerDay[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = getDaysInMonth(monthDate);
  const previousMonthDays = getDaysInMonth(new Date(year, month, 0));

  return Array.from({ length: 42 }, (_, index) => {
    const dayNumber = index - firstDay + 1;
    const isPreviousMonth = dayNumber <= 0;
    const isNextMonth = dayNumber > daysInMonth;
    const displayDay = isPreviousMonth
      ? previousMonthDays + dayNumber
      : isNextMonth
        ? dayNumber - daysInMonth
        : dayNumber;
    const itemDate = new Date(year, month + (isPreviousMonth ? -1 : isNextMonth ? 1 : 0), displayDay);

    return {
      key: `${itemDate.getFullYear()}-${itemDate.getMonth()}-${itemDate.getDate()}`,
      label: String(displayDay),
      value: formatDateInput(itemDate),
      isCurrentMonth: !isPreviousMonth && !isNextMonth,
    };
  });
}

function formatTimeInput(date: Date) {
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function getTimeParts(date: Date) {
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

function formatTimeParts(hour: number, minute: number) {
  return `${padNumber(hour)}:${padNumber(minute)}`;
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function formatDateLabel(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${formatTimeInput(date)}`;
}

function formatReminderLabel(todo: TodoRecord) {
  if (!todo.reminderAt) {
    return '未设置';
  }

  const repeatLabel: Record<TodoRepeat, string> = {
    none: '单次',
    daily: '每天',
    weekly: '每周',
  };

  return `${formatDateLabel(new Date(todo.reminderAt))} · ${repeatLabel[todo.repeat]}`;
}

function padNumber(value: number) {
  return value.toString().padStart(2, '0');
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  panelRoot: {
    flex: 1,
  },
  panelRootEmbedded: {
    minHeight: 360,
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
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  title: {
    color: '#0F172A',
    fontSize: 32,
    lineHeight: 38,
  },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    shadowColor: '#2563EB',
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
  loadingCard: {
    marginHorizontal: 24,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    color: '#64748B',
  },
  emptyCard: {
    borderRadius: 28,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  emptyDescription: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
    backgroundColor: '#3B82F6',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: '#475569',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  todoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 22,
    padding: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  todoCardCompleted: {
    opacity: 0.72,
  },
  checkButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkButtonDone: {
    borderColor: '#22C55E',
    backgroundColor: '#22C55E',
  },
  todoContent: {
    flex: 1,
    gap: 6,
  },
  todoTitle: {
    color: '#0F172A',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  todoTitleDone: {
    color: '#64748B',
    textDecorationLine: 'line-through',
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reminderText: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  editorSheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 16,
    backgroundColor: '#FFFFFF',
  },
  reminderSheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 26,
    gap: 18,
    backgroundColor: '#FFFFFF',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: '#0F172A',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  saveButton: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#DBEAFE',
  },
  saveButtonText: {
    color: '#2563EB',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  todoInput: {
    minHeight: 110,
    borderRadius: 22,
    padding: 18,
    color: '#0F172A',
    fontSize: 20,
    lineHeight: 28,
    backgroundColor: '#F8FAFC',
    textAlignVertical: 'top',
  },
  reminderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    padding: 14,
    backgroundColor: '#F8FAFC',
  },
  reminderButtonIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DBEAFE',
  },
  reminderButtonTextGroup: {
    flex: 1,
    gap: 2,
  },
  reminderButtonTitle: {
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  reminderButtonDescription: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
  },
  optionGroup: {
    gap: 10,
  },
  optionLabel: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  datePickerContent: {
    borderRadius: 20,
    padding: 12,
    backgroundColor: '#F8FAFC',
    gap: 10,
  },
  datePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  datePickerMonthButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DBEAFE',
  },
  datePickerMonthText: {
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  weekdayRow: {
    flexDirection: 'row',
  },
  weekdayText: {
    flex: 1,
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    fontWeight: '700',
  },
  dateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
  },
  dateGridItem: {
    width: `${100 / 7}%`,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  dateGridItemMuted: {
    opacity: 0.35,
  },
  dateGridItemActive: {
    backgroundColor: '#3B82F6',
  },
  dateGridItemText: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  dateGridItemTextMuted: {
    color: '#94A3B8',
  },
  dateGridItemTextActive: {
    color: '#FFFFFF',
  },
  timePickerCard: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: '#F8FAFC',
    gap: 12,
  },
  timePreviewBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#DBEAFE',
  },
  timePreviewText: {
    color: '#2563EB',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
  },
  timePickerSubTitle: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  timeOptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeOptionChip: {
    minWidth: 50,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  timeOptionChipActive: {
    backgroundColor: '#3B82F6',
  },
  timeOptionChipText: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  timeOptionChipTextActive: {
    color: '#FFFFFF',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionChip: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F1F5F9',
  },
  optionChipActive: {
    backgroundColor: '#3B82F6',
  },
  optionChipText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  optionChipTextActive: {
    color: '#FFFFFF',
  },
  timeInput: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#0F172A',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    backgroundColor: '#F8FAFC',
  },
  sheetActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  clearButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
  },
  clearButtonText: {
    color: '#475569',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
  confirmButton: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    backgroundColor: '#3B82F6',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },
});
