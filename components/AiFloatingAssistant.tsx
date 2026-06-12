import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {
  AI_ASSISTANT_WELCOME_MESSAGE,
  DEFAULT_AI_MODEL_ID,
  clearAiAssistantMessages,
  createAiAssistantMessage,
  loadAiAssistantMessages,
  requestAiAssistantReply,
  requestAiModels,
  saveAiAssistantMessages,
  type AiAssistantMessage,
  type AiModel,
} from '@/services/ai-assistant';

const DRAWER_WIDTH_RATIO = 0.92;
const DRAWER_MAX_WIDTH = 350;
const DRAWER_ANIMATION_MS = 240;
const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export function AiFloatingAssistant() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const drawerTranslateX = useRef(new Animated.Value(-drawerWidth)).current;
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [messages, setMessages] = useState<AiAssistantMessage[]>([AI_ASSISTANT_WELCOME_MESSAGE]);
  const [models, setModels] = useState<AiModel[]>([{ id: DEFAULT_AI_MODEL_ID, label: DEFAULT_AI_MODEL_ID }]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_AI_MODEL_ID);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isModelSheetVisible, setIsModelSheetVisible] = useState(false);
  const [isKnowledgeExpanded, setIsKnowledgeExpanded] = useState(false);

  const screenKnowledge = useMemo(
    () => ({
      route: pathname,
      summary: `当前页面路径：${pathname}。屏幕内容读取、截图识别与业务上下文注入暂未接入。`,
    }),
    [pathname]
  );

  useEffect(() => {
    let active = true;

    const syncMessages = async () => {
      const storedMessages = await loadAiAssistantMessages();

      if (active) {
        setMessages(storedMessages);
        setIsHistoryLoading(false);
      }
    };

    void syncMessages();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const syncModels = async () => {
      const nextModels = await requestAiModels();

      if (active) {
        setModels(nextModels);
        setSelectedModel((currentModel) => (
          nextModels.some((model) => model.id === currentModel) ? currentModel : nextModels[0].id
        ));
      }
    };

    void syncModels();

    return () => {
      active = false;
    };
  }, []);

  const selectedModelLabel = useMemo(
    () => formatModelLabel(models.find((model) => model.id === selectedModel)?.label ?? selectedModel),
    [models, selectedModel]
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

  const updateMessages = useCallback((nextMessages: AiAssistantMessage[]) => {
    setMessages(nextMessages);
    void saveAiAssistantMessages(nextMessages);
  }, []);

  const appendSystemMessage = useCallback((content: string) => {
    updateMessages([...messages, createAiAssistantMessage('system', content)]);
  }, [messages, updateMessages]);

  const captureCurrentScreen = useCallback(() => {
    appendSystemMessage(`已读取当前屏幕占位信息：${screenKnowledge.summary}`);
  }, [appendSystemMessage, screenKnowledge.summary]);

  const clearHistory = useCallback(() => {
    void clearAiAssistantMessages().then(setMessages);
  }, []);

  const selectModel = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    setIsModelSheetVisible(false);
  }, []);

  const pickImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('无法上传图片', '请先允许访问相册。');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const imageName = result.assets[0].fileName ?? result.assets[0].uri.split('/').pop() ?? '图片';
    appendSystemMessage(`已选择图片：${imageName}。图片内容解析与上传到 AI 暂未接入。`);
  }, [appendSystemMessage]);

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: SUPPORTED_DOCUMENT_TYPES,
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    appendSystemMessage(`已选择文件：${result.assets[0].name}。文件解析与上传到 AI 暂未接入。`);
  }, [appendSystemMessage]);

  const showPendingFeature = useCallback((featureName: string) => {
    Alert.alert(featureName, '该功能暂时搁置，后续接入。');
  }, []);

  const sendMessage = useCallback(async () => {
    if (isSending) {
      return;
    }

    const nextMessage = draftMessage.trim();

    if (!nextMessage) {
      return;
    }

    const userMessage = createAiAssistantMessage('user', nextMessage);
    const pendingMessages = [...messages, userMessage];
    updateMessages(pendingMessages);
    setDraftMessage('');
    setIsSending(true);

    try {
      const assistantReply = await requestAiAssistantReply(pendingMessages, screenKnowledge, selectedModel);
      updateMessages([
        ...pendingMessages,
        createAiAssistantMessage('assistant', assistantReply),
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI 服务暂时不可用，请稍后再试。';
      updateMessages([
        ...pendingMessages,
        createAiAssistantMessage('system', errorMessage),
      ]);
    } finally {
      setIsSending(false);
    }
  }, [draftMessage, isSending, messages, screenKnowledge, selectedModel, updateMessages]);

  const isSendDisabled = isSending || !draftMessage.trim();

  const drawerStyle = useMemo(
    () => [
      styles.drawer,
      {
        width: drawerWidth,
        paddingTop: insets.top + 28,
        paddingBottom: Math.max(insets.bottom, 12),
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
                  <ThemedText style={styles.brandTitle}>Asteasia</ThemedText>
                  {/*
                   * 渲染位置: AI 抽屉标题下方
                   * 展示内容: brain 图标和当前模型名称，点击后弹出模型选择
                   * 数据来源: models 与 selectedModel 状态
                   */}
                  <Pressable
                    accessibilityLabel="选择 AI 模型"
                    onPress={() => setIsModelSheetVisible(true)}
                    style={styles.modelSelector}>
                    <MaterialIcons name="psychology" size={27} color="#111827" />
                    <View style={styles.modelPill}>
                      <ThemedText numberOfLines={1} style={styles.modelText}>{selectedModelLabel}</ThemedText>
                    </View>
                  </Pressable>
                </View>
                <View style={styles.headerActions}>
                  <Pressable accessibilityLabel="清空 AI 历史对话" onPress={clearHistory} style={styles.clearButton}>
                    <ThemedText style={styles.clearText}>清空</ThemedText>
                  </Pressable>
                  <Pressable accessibilityLabel="关闭 AI 助手" onPress={closeDrawer} style={styles.closeButton}>
                    <MaterialIcons name="close" size={20} color="#475569" />
                  </Pressable>
                </View>
              </View>

              {/*
               * 渲染位置: AI 抽屉顶部知识库折叠区
               * 展示内容: 当前屏幕知识库入口，展开后显示可滚动摘要小窗
               * 数据来源: expo-router 当前路径与占位摘要
               */}
              <View style={styles.knowledgeSection}>
                <Pressable
                  accessibilityLabel="展开或收起当前屏幕知识库"
                  onPress={() => setIsKnowledgeExpanded((visible) => !visible)}
                  style={styles.knowledgeToggle}>
                  <MaterialIcons name="summarize" size={24} color="#1664FF" />
                  <ThemedText style={styles.knowledgeTitle}>当前屏幕知识库</ThemedText>
                  <MaterialIcons
                    name={isKnowledgeExpanded ? 'arrow-drop-up' : 'arrow-drop-down'}
                    size={36}
                    color="#111827"
                    style={styles.knowledgeCaret}
                  />
                </Pressable>
                {isKnowledgeExpanded ? (
                  <View style={styles.knowledgePanel}>
                    <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
                      <ThemedText style={styles.knowledgeText}>{screenKnowledge.summary}</ThemedText>
                      <Pressable onPress={captureCurrentScreen} style={styles.captureButton}>
                        <ThemedText style={styles.captureText}>读取当前屏幕（占位）</ThemedText>
                      </Pressable>
                    </ScrollView>
                  </View>
                ) : null}
              </View>

              {/*
               * 渲染位置: AI 抽屉中部消息区
               * 展示内容: 用户、AI 与系统历史对话
               * 数据来源: messages 状态和本地持久化记录
               */}
              <ScrollView contentContainerStyle={styles.messageList} showsVerticalScrollIndicator={false}>
                {isHistoryLoading ? (
                  <View style={styles.loadingBubble}>
                    <ActivityIndicator color="#1664FF" />
                    <ThemedText style={styles.loadingText}>正在读取历史对话...</ThemedText>
                  </View>
                ) : (
                  messages.map((message) => (
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
                  ))
                )}
                {isSending ? (
                  <View style={[styles.messageBubble, styles.loadingBubble]}>
                    <ActivityIndicator color="#1664FF" />
                    <ThemedText style={styles.loadingText}>AI 正在思考...</ThemedText>
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.bottomArea}>
                {/*
                 * 渲染位置: AI 抽屉底部输入框上方
                 * 展示内容: 图片上传、文件上传、插件、AI 配置四个快捷按钮
                 * 数据来源: 固定功能入口和本地选择结果
                 */}
                <View style={styles.toolBar}>
                  <Pressable accessibilityLabel="上传图片" onPress={pickImage} style={styles.toolButton}>
                    <MaterialIcons name="image" size={22} color="#4B5563" />
                  </Pressable>
                  <Pressable accessibilityLabel="上传文件" onPress={pickDocument} style={styles.toolButton}>
                    <MaterialIcons name="folder-open" size={22} color="#4B5563" />
                  </Pressable>
                  <Pressable accessibilityLabel="插件功能" onPress={() => showPendingFeature('插件功能')} style={styles.toolButton}>
                    <MaterialIcons name="star-border" size={22} color="#4B5563" />
                  </Pressable>
                  <Pressable accessibilityLabel="AI 配置" onPress={() => showPendingFeature('AI 配置')} style={styles.toolButton}>
                    <MaterialIcons name="add" size={22} color="#4B5563" />
                  </Pressable>
                </View>

                {/*
                 * 渲染位置: AI 抽屉底部
                 * 展示内容: 胶囊输入框和发送按钮
                 * 数据来源: draftMessage 状态
                 */}
                <View style={styles.composer}>
                  <TextInput
                    multiline
                    placeholder="点击输入文本"
                    placeholderTextColor="#111827"
                    value={draftMessage}
                    onChangeText={setDraftMessage}
                    style={styles.input}
                  />
                  <Pressable
                    accessibilityLabel="发送消息"
                    disabled={isSendDisabled}
                    onPress={sendMessage}
                    style={[styles.sendButton, isSendDisabled && styles.sendButtonDisabled]}>
                    {isSending ? (
                      <ActivityIndicator color="#111827" size="small" />
                    ) : (
                      <MaterialIcons name="send" size={30} color="#111827" />
                    )}
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={isModelSheetVisible} onRequestClose={() => setIsModelSheetVisible(false)}>
        <Pressable style={styles.modelSheetBackdrop} onPress={() => setIsModelSheetVisible(false)}>
          <View style={styles.modelSheet}>
            <ThemedText style={styles.modelSheetTitle}>选择模型</ThemedText>
            <ScrollView style={styles.modelList} showsVerticalScrollIndicator>
              {models.map((model) => (
                <Pressable key={model.id} onPress={() => selectModel(model.id)} style={styles.modelOption}>
                  <ThemedText numberOfLines={1} style={styles.modelOptionText}>{model.label}</ThemedText>
                  {model.id === selectedModel ? (
                    <MaterialIcons name="check" size={20} color="#1664FF" />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function formatModelLabel(model: string) {
  return model.replace(/-/g, ' ').replace(/^gemini/i, 'gemini');
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
    backgroundColor: 'rgba(15, 23, 42, 0.24)',
  },
  keyboardAvoider: {
    flex: 1,
    alignItems: 'flex-start',
  },
  drawer: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 12, height: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 16,
  },
  header: {
    minHeight: 80,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  brandTitle: {
    color: '#000000',
    fontSize: 32,
    fontWeight: '100',
    lineHeight: 38,
  },
  modelSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  modelPill: {
    width: 163,
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    borderRadius: 10,
    backgroundColor: '#F2F3F5',
    paddingHorizontal: 10,
  },
  modelText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '100',
    lineHeight: 20,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingTop: 2,
  },
  clearButton: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: '#F2F3F5',
  },
  clearText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  closeButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#F2F3F5',
  },
  knowledgeSection: {
    marginLeft: 13,
    marginBottom: 12,
  },
  knowledgeToggle: {
    width: 283,
    height: 37,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(41, 98, 255, 0.1)',
    paddingLeft: 16,
  },
  knowledgeTitle: {
    marginLeft: 13,
    color: '#1664FF',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 37,
  },
  knowledgeCaret: {
    marginLeft: 'auto',
    marginRight: 2,
  },
  knowledgePanel: {
    width: 283,
    maxHeight: 120,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(41, 98, 255, 0.16)',
    backgroundColor: '#F8FAFF',
    padding: 10,
  },
  knowledgeText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 19,
  },
  captureButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#1664FF',
  },
  captureText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  messageList: {
    flexGrow: 1,
    gap: 10,
    paddingTop: 8,
    paddingBottom: 16,
  },
  messageBubble: {
    alignSelf: 'flex-start',
    maxWidth: '88%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1664FF',
  },
  systemBubble: {
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: '#D6E4FF',
    backgroundColor: '#F1F6FF',
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 13,
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
    color: '#1664FF',
    fontSize: 13,
  },
  bottomArea: {
    marginHorizontal: -6,
    paddingBottom: 0,
  },
  toolBar: {
    width: 104,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: 4,
    borderRadius: 6,
    backgroundColor: '#ffffffff',
  },
  toolButton: {
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 5,
    backgroundColor: '#efefefff',
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 2,
  },
  input: {
    maxHeight: 96,
    flex: 1,
    paddingVertical: 4,
    color: '#ffffffff',
    fontSize: 20,
    fontWeight: '100',
    lineHeight: 24,
  },
  sendButton: {
    width: 36,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  modelSheetBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  modelSheet: {
    maxHeight: '62%',
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  modelSheetTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  modelList: {
    maxHeight: 360,
  },
  modelOption: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    gap: 10,
  },
  modelOptionText: {
    flex: 1,
    color: '#334155',
    fontSize: 14,
  },
});
