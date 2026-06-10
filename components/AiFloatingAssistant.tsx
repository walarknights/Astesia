import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { usePathname } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';

type AssistantMessage = {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
};

const DRAWER_WIDTH_RATIO = 0.86;
const DRAWER_MAX_WIDTH = 380;
const DRAWER_ANIMATION_MS = 240;

export function AiFloatingAssistant() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const drawerTranslateX = useRef(new Animated.Value(-drawerWidth)).current;
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 'assistant-welcome',
      role: 'assistant',
      content: '你好，我是 Astesia AI。现在先展示对话占位，后续会接入真实 AI 服务。',
    },
  ]);

  const screenKnowledge = useMemo(
    () => ({
      route: pathname,
      summary: `当前页面路径：${pathname}。屏幕内容读取、截图识别与业务上下文注入暂未接入。`,
    }),
    [pathname]
  );

  const animateDrawer = useCallback((toValue: number, onComplete?: () => void) => {
    Animated.timing(drawerTranslateX, {
      toValue,
      duration: DRAWER_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onComplete?.();
      }
    });
  }, [drawerTranslateX]);

  const openDrawer = useCallback(() => {
    setIsDrawerVisible(true);
    drawerTranslateX.setValue(-drawerWidth);
    requestAnimationFrame(() => animateDrawer(0));
  }, [animateDrawer, drawerTranslateX, drawerWidth]);

  const closeDrawer = useCallback(() => {
    animateDrawer(-drawerWidth, () => setIsDrawerVisible(false));
  }, [animateDrawer, drawerWidth]);

  const captureCurrentScreen = useCallback(() => {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `screen-${Date.now()}`,
        role: 'system',
        content: `已读取当前屏幕占位信息：${screenKnowledge.summary}`,
      },
    ]);
  }, [screenKnowledge.summary]);

  const sendMessage = useCallback(() => {
    const nextMessage = draftMessage.trim();

    if (!nextMessage) {
      return;
    }

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: nextMessage,
      },
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: 'AI 接入暂未启用。这里会基于当前屏幕知识库与历史对话生成回复。',
      },
    ]);
    setDraftMessage('');
  }, [draftMessage]);

  const drawerStyle = useMemo(
    () => [
      styles.drawer,
      {
        width: drawerWidth,
        paddingTop: insets.top + 18,
        paddingBottom: Math.max(insets.bottom, 16),
        transform: [{ translateX: drawerTranslateX }],
      },
    ],
    [drawerTranslateX, drawerWidth, insets.bottom, insets.top]
  );

  return (
    <>
      {/*
       * 渲染位置: 全局页面左侧中部
       * 展示内容: 可点击打开 AI 抽屉的悬浮球
       * 数据来源: 组件内部固定文案与图标
       */}
      <Pressable
        accessibilityLabel="打开 AI 助手"
        accessibilityRole="button"
        onPress={openDrawer}
        style={[styles.floatingButton, { top: insets.top + 220 }]}>
        <MaterialIcons name="auto-awesome" size={24} color="#FFFFFF" />
        <ThemedText style={styles.floatingLabel}>AI</ThemedText>
      </Pressable>

      <Modal animationType="fade" transparent visible={isDrawerVisible} onRequestClose={closeDrawer}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="关闭 AI 助手遮罩" style={styles.backdrop} onPress={closeDrawer} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            pointerEvents="box-none"
            style={styles.keyboardAvoider}>
            <Animated.View style={drawerStyle}>
              <View style={styles.header}>
                <View>
                  <ThemedText type="subtitle" style={styles.title}>Astesia AI</ThemedText>
                  <ThemedText style={styles.subtitle}>对话与屏幕知识库占位</ThemedText>
                </View>
                <Pressable accessibilityLabel="关闭 AI 助手" onPress={closeDrawer} style={styles.iconButton}>
                  <MaterialIcons name="close" size={22} color="#334155" />
                </Pressable>
              </View>

              {/*
               * 渲染位置: AI 抽屉顶部知识库卡片
               * 展示内容: 当前屏幕读取状态与手动读取按钮
               * 数据来源: expo-router 当前路径与占位摘要
               */}
              <View style={styles.knowledgeCard}>
                <View style={styles.knowledgeHeader}>
                  <MaterialIcons name="screen-search-desktop" size={20} color="#4F46E5" />
                  <ThemedText style={styles.knowledgeTitle}>当前屏幕知识库</ThemedText>
                </View>
                <ThemedText style={styles.knowledgeText}>{screenKnowledge.summary}</ThemedText>
                <Pressable onPress={captureCurrentScreen} style={styles.captureButton}>
                  <ThemedText style={styles.captureText}>读取当前屏幕（占位）</ThemedText>
                </Pressable>
              </View>

              {/*
               * 渲染位置: AI 抽屉中部消息区
               * 展示内容: 用户、AI 与系统占位消息列表
               * 数据来源: messages 状态
               */}
              <ScrollView contentContainerStyle={styles.messageList} showsVerticalScrollIndicator={false}>
                {messages.map((message) => (
                  <View
                    key={message.id}
                    style={[
                      styles.messageBubble,
                      message.role === 'user' && styles.userBubble,
                      message.role === 'system' && styles.systemBubble,
                    ]}>
                    <ThemedText
                      style={[
                        styles.messageText,
                        message.role === 'user' && styles.userMessageText,
                        message.role === 'system' && styles.systemMessageText,
                      ]}>
                      {message.content}
                    </ThemedText>
                  </View>
                ))}
              </ScrollView>

              {/*
               * 渲染位置: AI 抽屉底部输入栏
               * 展示内容: 对话输入框和发送按钮
               * 数据来源: draftMessage 状态
               */}
              <View style={styles.composer}>
                <TextInput
                  multiline
                  placeholder="向 AI 提问..."
                  placeholderTextColor="#94A3B8"
                  value={draftMessage}
                  onChangeText={setDraftMessage}
                  style={styles.input}
                />
                <Pressable accessibilityLabel="发送消息" onPress={sendMessage} style={styles.sendButton}>
                  <MaterialIcons name="send" size={20} color="#FFFFFF" />
                </Pressable>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    left: 0,
    zIndex: 20,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomRightRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: '#4F46E5',
    shadowColor: '#312E81',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  floatingLabel: {
    marginTop: 1,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
  },
  keyboardAvoider: {
    flex: 1,
    alignItems: 'flex-start',
  },
  drawer: {
    height: '100%',
    backgroundColor: '#F8FAFC',
    borderBottomRightRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 12, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    color: '#64748B',
    fontSize: 13,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#E2E8F0',
  },
  knowledgeCard: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 20,
    padding: 14,
    backgroundColor: '#EEF2FF',
  },
  knowledgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  knowledgeTitle: {
    marginLeft: 8,
    color: '#3730A3',
    fontSize: 15,
    fontWeight: '800',
  },
  knowledgeText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 19,
  },
  captureButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#4F46E5',
  },
  captureText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  messageList: {
    flexGrow: 1,
    gap: 10,
    paddingBottom: 16,
  },
  messageBubble: {
    alignSelf: 'flex-start',
    maxWidth: '88%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#4F46E5',
  },
  systemBubble: {
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    backgroundColor: '#E0F2FE',
  },
  messageText: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  systemMessageText: {
    color: '#0369A1',
    fontSize: 13,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 22,
    padding: 6,
    backgroundColor: '#FFFFFF',
  },
  input: {
    maxHeight: 108,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#0F172A',
    fontSize: 15,
  },
  sendButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: '#4F46E5',
  },
});
