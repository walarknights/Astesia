import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-native-markdown-display';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Easing,
  KeyboardAvoidingView,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  PanResponder,
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
import { buildAiScreenKnowledge, type AiScreenKnowledgeSnapshot } from '@/services/ai-screen-knowledge';
import { useScreenCapture } from '@/services/screen-capture';

const DRAWER_WIDTH_RATIO = 0.92;
const DRAWER_MAX_WIDTH = 350;
const DRAWER_ANIMATION_MS = 240;
const FLOATING_BUTTON_SIZE = 56;
const FLOATING_BUTTON_MARGIN = 12;
const FLOATING_BUTTON_INITIAL_TOP = 220;
const FLOATING_DRAG_THRESHOLD = 4;
const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const AUTO_SCROLL_BOTTOM_OFFSET = 48;
const USER_UPWARD_SCROLL_THRESHOLD = 6;

type MessageStateUpdater =
  | AiAssistantMessage[]
  | ((currentMessages: AiAssistantMessage[]) => AiAssistantMessage[]);

type PendingImageAttachment = {
  id: string;
  uri: string;
  name: string;
  source: 'screenshot' | 'library';
};

export function AiFloatingAssistant() {
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams();
  const { captureAppScreen } = useScreenCapture();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const drawerTranslateX = useRef(new Animated.Value(-drawerWidth)).current;
  const floatingPosition = useRef(new Animated.ValueXY({ x: 0, y: FLOATING_BUTTON_INITIAL_TOP })).current;
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [messages, setMessages] = useState<AiAssistantMessage[]>([AI_ASSISTANT_WELCOME_MESSAGE]);
  const [models, setModels] = useState<AiModel[]>([{ id: DEFAULT_AI_MODEL_ID, label: DEFAULT_AI_MODEL_ID }]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_AI_MODEL_ID);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isModelSheetVisible, setIsModelSheetVisible] = useState(false);
  const [isKnowledgeExpanded, setIsKnowledgeExpanded] = useState(false);
  const [pendingImageAttachments, setPendingImageAttachments] = useState<PendingImageAttachment[]>([]);
  const [isCapturingScreenImage, setIsCapturingScreenImage] = useState(false);
  const [screenKnowledge, setScreenKnowledge] = useState<AiScreenKnowledgeSnapshot>(() => ({
    route: pathname,
    summary: `当前页面路径：${pathname}。正在读取屏幕文字内容...`,
    source: 'fallback',
    updatedAt: new Date().toISOString(),
  }));
  const [isScreenKnowledgeLoading, setIsScreenKnowledgeLoading] = useState(false);
  const isMountedRef = useRef(true);
  const messageScrollRef = useRef<ScrollView | null>(null);
  const messagesRef = useRef<AiAssistantMessage[]>([AI_ASSISTANT_WELCOME_MESSAGE]);
  const autoScrollEnabledRef = useRef(true);
  const lastScrollOffsetYRef = useRef(0);
  const floatingPositionRef = useRef({ x: 0, y: FLOATING_BUTTON_INITIAL_TOP });
  const floatingDragStartRef = useRef({ x: 0, y: FLOATING_BUTTON_INITIAL_TOP });
  const hasInitializedFloatingPositionRef = useRef(false);
  const didDragFloatingButtonRef = useRef(false);
  const routeParamSignature = JSON.stringify(routeParams);
  const screenKnowledgeRouteParams = useMemo(
    () => JSON.parse(routeParamSignature) as Record<string, string | string[] | undefined>,
    [routeParamSignature]
  );

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const loadModels = useCallback(async () => {
    setIsModelsLoading(true);

    const result = await requestAiModels();
    const nextModels = Array.isArray(result.models) && result.models.length > 0
      ? result.models
      : [{ id: DEFAULT_AI_MODEL_ID, label: DEFAULT_AI_MODEL_ID }];

    if (!isMountedRef.current) {
      return;
    }

    // [变更] 修改前: 直接信任 requestAiModels 返回的 models 数组
    // [变更] 修改后: 在组件侧再次做数组兜底，避免热更新或异常返回导致模型选择状态崩溃
    // [原因] 模型列表失败时应降级为默认模型，而不是让抽屉组件报错
    setModels(nextModels);
    setModelsError(result.errorMessage);
    setSelectedModel((currentModel) => (
      nextModels.some((model) => model.id === currentModel) ? currentModel : nextModels[0].id
    ));
    setIsModelsLoading(false);
  }, []);

  useEffect(() => {
    let active = true;

    const syncMessages = async () => {
      const storedMessages = await loadAiAssistantMessages();

      if (active) {
        messagesRef.current = storedMessages;
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
    void loadModels();
  }, [loadModels]);

  const selectedModelLabel = useMemo(
    () => formatModelLabel(models.find((model) => model.id === selectedModel)?.label ?? selectedModel),
    [models, selectedModel]
  );
  const conversationTitle = '对话标题';

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

  const clampFloatingPosition = useCallback((x: number, y: number) => {
    const maxX = Math.max(width - FLOATING_BUTTON_SIZE - FLOATING_BUTTON_MARGIN, FLOATING_BUTTON_MARGIN);
    const minY = insets.top + FLOATING_BUTTON_MARGIN;
    const maxY = Math.max(
      height - insets.bottom - FLOATING_BUTTON_SIZE - FLOATING_BUTTON_MARGIN,
      minY
    );

    return {
      x: Math.min(Math.max(x, 0), maxX),
      y: Math.min(Math.max(y, minY), maxY),
    };
  }, [height, insets.bottom, insets.top, width]);

  const updateFloatingPosition = useCallback((position: { x: number; y: number }) => {
    floatingPositionRef.current = position;
    floatingPosition.setValue(position);
  }, [floatingPosition]);

  useEffect(() => {
    if (!hasInitializedFloatingPositionRef.current) {
      hasInitializedFloatingPositionRef.current = true;
      updateFloatingPosition(clampFloatingPosition(0, insets.top + FLOATING_BUTTON_INITIAL_TOP));
      return;
    }

    const nextPosition = clampFloatingPosition(
      floatingPositionRef.current.x,
      floatingPositionRef.current.y
    );

    if (
      nextPosition.x !== floatingPositionRef.current.x
      || nextPosition.y !== floatingPositionRef.current.y
    ) {
      updateFloatingPosition(nextPosition);
    }
  }, [clampFloatingPosition, insets.top, updateFloatingPosition]);

  const handleFloatingButtonPress = useCallback(() => {
    if (didDragFloatingButtonRef.current) {
      didDragFloatingButtonRef.current = false;
      return;
    }

    openDrawer();
  }, [openDrawer]);

  const floatingPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => (
      Math.abs(gestureState.dx) > FLOATING_DRAG_THRESHOLD
      || Math.abs(gestureState.dy) > FLOATING_DRAG_THRESHOLD
    ),
    onPanResponderGrant: () => {
      floatingDragStartRef.current = floatingPositionRef.current;
      didDragFloatingButtonRef.current = false;
    },
    onPanResponderMove: (_, gestureState) => {
      if (
        Math.abs(gestureState.dx) > FLOATING_DRAG_THRESHOLD
        || Math.abs(gestureState.dy) > FLOATING_DRAG_THRESHOLD
      ) {
        didDragFloatingButtonRef.current = true;
      }

      updateFloatingPosition(clampFloatingPosition(
        floatingDragStartRef.current.x + gestureState.dx,
        floatingDragStartRef.current.y + gestureState.dy
      ));
    },
    onPanResponderRelease: (_, gestureState) => {
      const nextPosition = clampFloatingPosition(
        floatingDragStartRef.current.x + gestureState.dx,
        floatingDragStartRef.current.y + gestureState.dy
      );

      updateFloatingPosition(nextPosition);

      if (
        didDragFloatingButtonRef.current
        || Math.abs(gestureState.dx) > FLOATING_DRAG_THRESHOLD
        || Math.abs(gestureState.dy) > FLOATING_DRAG_THRESHOLD
      ) {
        didDragFloatingButtonRef.current = true;
        setTimeout(() => {
          didDragFloatingButtonRef.current = false;
        }, 0);
      }
    },
    onPanResponderTerminate: () => {
      updateFloatingPosition(clampFloatingPosition(
        floatingPositionRef.current.x,
        floatingPositionRef.current.y
      ));
      didDragFloatingButtonRef.current = true;
      setTimeout(() => {
        didDragFloatingButtonRef.current = false;
      }, 0);
    },
  }), [clampFloatingPosition, updateFloatingPosition]);

  const closeDrawer = useCallback((onComplete?: () => void) => {
    animateDrawer(-drawerWidth, () => {
      setIsDrawerVisible(false);
      onComplete?.();
    });
  }, [animateDrawer, drawerWidth]);

  const scrollMessagesToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      messageScrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const updateMessages = useCallback((updater: MessageStateUpdater, shouldPersist = true) => {
    setMessages((currentMessages) => {
      const nextMessages = typeof updater === 'function'
        ? updater(currentMessages)
        : updater;

      messagesRef.current = nextMessages;

      if (shouldPersist) {
        void saveAiAssistantMessages(nextMessages);
      }

      return nextMessages;
    });
  }, []);

  const appendSystemMessage = useCallback((content: string) => {
    updateMessages(
      [...messagesRef.current, createAiAssistantMessage('system', content)]
    );
  }, [updateMessages]);

  const refreshScreenKnowledge = useCallback(async (shouldAppendMessage = false) => {
    setIsScreenKnowledgeLoading(true);

    try {
      const nextKnowledge = await buildAiScreenKnowledge(pathname, screenKnowledgeRouteParams);

      if (!isMountedRef.current) {
        return;
      }

      setScreenKnowledge(nextKnowledge);

      if (shouldAppendMessage) {
        appendSystemMessage(`已读取当前屏幕文字内容：\n${nextKnowledge.summary}`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsScreenKnowledgeLoading(false);
      }
    }
  // [变更] 修改前: 知识库只读取当前路径的占位文案
  // [变更] 修改后: 路由或参数变化时重建页面文字摘要
  // [原因] 让 AI 对话能够结合当前页面真实业务文本回答
  }, [appendSystemMessage, pathname, screenKnowledgeRouteParams]);

  useEffect(() => {
    void refreshScreenKnowledge(false);
  }, [refreshScreenKnowledge]);

  const appendImageAttachment = useCallback((attachment: Omit<PendingImageAttachment, 'id'>) => {
    setPendingImageAttachments((currentAttachments) => [
      ...currentAttachments,
      {
        ...attachment,
        id: `${attachment.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
    ]);
  }, []);

  const removeImageAttachment = useCallback((attachmentId: string) => {
    setPendingImageAttachments((currentAttachments) => (
      currentAttachments.filter((attachment) => attachment.id !== attachmentId)
    ));
  }, []);

  const captureCurrentScreen = useCallback(() => {
    if (isCapturingScreenImage) {
      return;
    }

    setIsCapturingScreenImage(true);
    closeDrawer(() => {
      const runCapture = async () => {
        try {
          await waitForScreenSettled();
          const imageUri = await captureAppScreen();

          appendImageAttachment({
            uri: imageUri,
            name: `屏幕截图 ${formatAttachmentTime(new Date())}`,
            source: 'screenshot',
          });
          await refreshScreenKnowledge(true);
          openDrawer();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '当前屏幕截图失败，请稍后重试。';
          Alert.alert('截图失败', errorMessage);
          openDrawer();
        } finally {
          if (isMountedRef.current) {
            setIsCapturingScreenImage(false);
          }
        }
      };

      void runCapture();
    });
  }, [appendImageAttachment, captureAppScreen, closeDrawer, isCapturingScreenImage, openDrawer, refreshScreenKnowledge]);

  const startNewConversation = useCallback(() => {
    if (isSending) {
      return;
    }

    // [变更] 修改前: 顶部按钮以“清空”表达删除历史
    // [变更] 修改后: 以“新对话”表达重置当前会话，等待后续接入多会话保存
    // [原因] 当前版本尚未支持保存多轮独立对话，使用加号更符合开启新会话的用户预期
    setDraftMessage('');
    setPendingImageAttachments([]);
    autoScrollEnabledRef.current = true;
    void clearAiAssistantMessages().then((nextMessages) => {
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      scrollMessagesToEnd(false);
    });
  }, [isSending, scrollMessagesToEnd]);

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

    const imageAsset = result.assets[0];
    const imageName = imageAsset.fileName ?? imageAsset.uri.split('/').pop() ?? '相册图片';

    appendImageAttachment({
      uri: imageAsset.uri,
      name: imageName,
      source: 'library',
    });
  }, [appendImageAttachment]);

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

  const handleMessageListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const currentOffsetY = contentOffset.y;
    const isNearBottom = currentOffsetY + layoutMeasurement.height >= contentSize.height - AUTO_SCROLL_BOTTOM_OFFSET;

    if (isNearBottom) {
      autoScrollEnabledRef.current = true;
    } else if (isSending && currentOffsetY < lastScrollOffsetYRef.current - USER_UPWARD_SCROLL_THRESHOLD) {
      // [变更] 修改前: 消息区没有滚动状态感知，新增内容时只能被动跟随到底部
      // [变更] 修改后: 流式输出期间一旦检测到用户主动上滑，就暂停自动下滑
      // [原因] 让用户查看历史内容时不被持续输出打断
      autoScrollEnabledRef.current = false;
    }

    lastScrollOffsetYRef.current = currentOffsetY;
  }, [isSending]);

  const handleMessageListContentChange = useCallback(() => {
    if (autoScrollEnabledRef.current) {
      scrollMessagesToEnd();
    }
  }, [scrollMessagesToEnd]);

  useEffect(() => {
    if (isDrawerVisible && !isHistoryLoading) {
      scrollMessagesToEnd(false);
    }
  }, [isDrawerVisible, isHistoryLoading, scrollMessagesToEnd]);

  const sendMessage = useCallback(async () => {
    if (isSending) {
      return;
    }

    const nextMessage = draftMessage.trim();

    if (!nextMessage) {
      return;
    }

    const attachmentNotice = pendingImageAttachments.length > 0
      ? `\n\n[已添加 ${pendingImageAttachments.length} 张图片附件，当前阶段仅展示在输入区，暂未发送给 AI 模型。]`
      : '';
    const userMessage = createAiAssistantMessage('user', `${nextMessage}${attachmentNotice}`);
    const assistantMessage = createAiAssistantMessage('assistant', '');
    const requestMessages = [...messagesRef.current, userMessage];
    const pendingMessages = [...requestMessages, assistantMessage];

    autoScrollEnabledRef.current = true;
    updateMessages(pendingMessages);
    setDraftMessage('');
    setPendingImageAttachments([]);
    setIsSending(true);
    scrollMessagesToEnd();

    try {
      const assistantReply = await requestAiAssistantReply(requestMessages, screenKnowledge, selectedModel, {
        onChunk: (_, fullContent) => {
          updateMessages((currentMessages) => currentMessages.map((message) => (
            message.id === assistantMessage.id
              ? { ...message, content: fullContent }
              : message
          )), false);
        },
      });

      updateMessages((currentMessages) => currentMessages.map((message) => (
        message.id === assistantMessage.id
          ? { ...message, content: assistantReply }
          : message
      )));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI 服务暂时不可用，请稍后再试。';

      updateMessages((currentMessages) => {
        const nextMessages = currentMessages.filter((message) => (
          message.id !== assistantMessage.id || message.content.trim().length > 0
        ));

        return [...nextMessages, createAiAssistantMessage('system', errorMessage)];
      });
    } finally {
      setIsSending(false);
    }
  }, [draftMessage, isSending, pendingImageAttachments.length, screenKnowledge, scrollMessagesToEnd, selectedModel, updateMessages]);

  const isSendDisabled = isSending || !draftMessage.trim();
  const sendButtonLabel = isSending ? '发送中' : '发送';

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
       * 渲染位置: 全局页面可拖拽浮层
       * 展示内容: 可点击打开 AI 抽屉、可拖动调整位置的悬浮球
       * 数据来源: 组件内部固定文案、图标与 floatingPosition 手势状态
       */}
      <Animated.View
        {...floatingPanResponder.panHandlers}
        style={[styles.floatingButton, { transform: floatingPosition.getTranslateTransform() }]}>
        <Pressable
          accessibilityHint="轻点打开 AI 助手，拖动可调整悬浮球位置"
          accessibilityLabel="打开 AI 助手"
          accessibilityRole="button"
          disabled={isCapturingScreenImage}
          onPress={handleFloatingButtonPress}
          style={styles.floatingButtonContent}>
          {isCapturingScreenImage ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <MaterialIcons name="auto-awesome" size={24} color="#FFFFFF" />
          )}
          <ThemedText style={styles.floatingLabel}>AI</ThemedText>
        </Pressable>
      </Animated.View>

      <Modal animationType="fade" transparent visible={isDrawerVisible} onRequestClose={() => closeDrawer()}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="关闭 AI 助手遮罩" style={styles.backdrop} onPress={() => closeDrawer()} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            pointerEvents="box-none"
            style={styles.keyboardAvoider}>
            <Animated.View style={drawerStyle}>
              <View style={styles.header}>
                {/*
                 * 渲染位置: AI 抽屉顶部导航栏
                 * 展示内容: 历史对话菜单入口、当前对话标题和新对话按钮
                 * 数据来源: 固定占位标题 conversationTitle 与组件内 startNewConversation 操作
                 */}
                <View style={styles.conversationNav}>
                  <Pressable
                    accessibilityLabel="打开已保存的 AI 多轮对话菜单"
                    accessibilityRole="button"
                    onPress={() => showPendingFeature('历史对话菜单')}
                    style={styles.menuButton}>
                    <MaterialIcons name="menu-open" size={24} color="#111827" />
                  </Pressable>
                  <ThemedText numberOfLines={1} style={styles.conversationTitle}>
                    {conversationTitle}
                  </ThemedText>
                  <Pressable
                    accessibilityLabel="开启一轮新 AI 对话"
                    accessibilityRole="button"
                    disabled={isSending}
                    onPress={startNewConversation}
                    style={[styles.newConversationButton, isSending && styles.newConversationButtonDisabled]}>
                    <MaterialIcons name="add" size={30} color="#111827" />
                  </Pressable>
                </View>

                {/*
                 * 渲染位置: AI 抽屉顶部品牌与模型区域
                 * 展示内容: Asteasia 品牌、brain 图标和当前模型名称，点击模型后弹出选择
                 * 数据来源: models 与 selectedModel 状态
                 */}
                <View style={styles.identityRow}>
                  <ThemedText style={styles.brandTitle}>Asteasia</ThemedText>
                  <Pressable
                    accessibilityLabel="选择 AI 模型"
                    onPress={() => setIsModelSheetVisible(true)}
                    style={styles.modelSelector}>
                    <MaterialIcons name="psychology" size={27} color="#4B5563" />
                    <View style={styles.modelPill}>
                      <ThemedText numberOfLines={1} style={styles.modelText}>
                        {isModelsLoading ? '正在加载模型...' : selectedModelLabel}
                      </ThemedText>
                    </View>
                  </Pressable>
                </View>
                {modelsError ? (
                  <ThemedText numberOfLines={2} style={styles.modelStatusText}>
                    模型列表加载失败，当前使用默认模型。
                  </ThemedText>
                ) : null}
              </View>

              {/*
               * 渲染位置: AI 抽屉顶部知识库折叠区
               * 展示内容: 当前屏幕知识库入口，展开后显示可滚动摘要小窗和刷新入口
               * 数据来源: expo-router 当前路径、路由参数和本地页面业务数据
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
                      <ThemedText style={styles.knowledgeMeta}>
                        {isScreenKnowledgeLoading ? '正在读取屏幕文字...' : `更新时间：${formatKnowledgeTime(screenKnowledge.updatedAt)}`}
                      </ThemedText>
                      <ThemedText style={styles.knowledgeText}>{screenKnowledge.summary}</ThemedText>
                      <Pressable
                        disabled={isScreenKnowledgeLoading || isCapturingScreenImage}
                        onPress={captureCurrentScreen}
                        style={[
                          styles.captureButton,
                          (isScreenKnowledgeLoading || isCapturingScreenImage) && styles.captureButtonDisabled,
                        ]}>
                        <ThemedText style={styles.captureText}>
                          {isCapturingScreenImage ? '截图中...' : isScreenKnowledgeLoading ? '读取中...' : '读取当前屏幕（一键截图）'}
                        </ThemedText>
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
              <ScrollView
                ref={messageScrollRef}
                contentContainerStyle={styles.messageList}
                onContentSizeChange={handleMessageListContentChange}
                onScroll={handleMessageListScroll}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}>
                {isHistoryLoading ? (
                  <View style={styles.loadingBubble}>
                    <ActivityIndicator color="#1664FF" />
                    <ThemedText style={styles.loadingText}>正在读取历史对话...</ThemedText>
                  </View>
                ) : (
                  messages.map((message, index) => (
                    <View
                      key={message.id}
                      style={[
                        styles.messageBubble,
                        message.role === 'user' && styles.userBubble,
                        message.role === 'system' && styles.systemBubble,
                      ]}>
                      {/*
                       * 渲染位置: AI 对话消息气泡内部
                       * 展示内容: 用户纯文本消息、AI 的 Markdown 回复或系统提示文案
                       * 数据来源: messages 状态中的单条 message
                       */}
                      {message.role === 'assistant' && message.content.trim() ? (
                        <Markdown style={markdownStyles}>
                          {message.content}
                        </Markdown>
                      ) : (
                        <ThemedText
                          style={[
                            styles.messageText,
                            message.role === 'user' && styles.userMessageText,
                            message.role === 'system' && styles.systemMessageText,
                          ]}>
                          {message.content}
                        </ThemedText>
                      )}
                      {message.role === 'assistant' && !message.content.trim() && isSending && index === messages.length - 1 ? (
                        <View style={styles.streamingState}>
                          <ActivityIndicator color="#1664FF" size="small" />
                          <ThemedText style={styles.loadingText}>AI 正在思考...</ThemedText>
                        </View>
                      ) : null}
                    </View>
                  ))
                )}
              </ScrollView>

              <View style={styles.bottomArea}>
                {/*
                 * 渲染位置: AI 抽屉底部顶部操作栏
                 * 展示内容: 左侧工具按钮组和右侧发送按钮
                 * 数据来源: 固定功能入口、draftMessage 状态与 isSending 状态
                 */}
                <View style={styles.composerHeader}>
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
                  <Pressable
                    accessibilityLabel="发送消息"
                    disabled={isSendDisabled}
                    onPress={sendMessage}
                    style={[styles.sendActionButton, isSendDisabled && styles.sendButtonDisabled]}>
                    {isSending ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <MaterialIcons name="send" size={18} color="#FFFFFF" />
                    )}
                    <ThemedText style={styles.sendActionText}>{sendButtonLabel}</ThemedText>
                  </Pressable>
                </View>

                {/*
                 * 渲染位置: AI 抽屉底部
                 * 展示内容: 紧凑的单区输入框
                 * 数据来源: draftMessage 状态
                 */}
                <View style={styles.composer}>
                  {pendingImageAttachments.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.attachmentScroller}
                      contentContainerStyle={styles.attachmentList}>
                      {/*
                       * 渲染位置: AI 抽屉底部输入框上方
                       * 展示内容: 待发送的屏幕截图或用户上传图片缩略图
                       * 数据来源: pendingImageAttachments 状态
                       */}
                      {pendingImageAttachments.map((attachment) => (
                        <View key={attachment.id} style={styles.attachmentCard}>
                          <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
                          <View style={styles.attachmentMeta}>
                            <MaterialIcons
                              name={attachment.source === 'screenshot' ? 'screenshot-monitor' : 'image'}
                              size={14}
                              color="#1664FF"
                            />
                            <ThemedText numberOfLines={1} style={styles.attachmentName}>
                              {attachment.name}
                            </ThemedText>
                          </View>
                          <Pressable
                            accessibilityLabel={`移除图片附件 ${attachment.name}`}
                            onPress={() => removeImageAttachment(attachment.id)}
                            style={styles.removeAttachmentButton}>
                            <MaterialIcons name="close" size={14} color="#FFFFFF" />
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}
                  <TextInput
                    multiline
                    placeholder="输入对话内容..."
                    cursorColor="#111827"
                    keyboardAppearance="light"
                    placeholderTextColor="#000000"
                    selectionColor="#111827"
                    value={draftMessage}
                    onChangeText={setDraftMessage}
                    style={styles.input}
                    textAlignVertical="top"
                  />
                </View>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={isModelSheetVisible} onRequestClose={() => setIsModelSheetVisible(false)}>
        <View style={styles.modelSheetBackdrop}>
          <Pressable
            accessibilityLabel="关闭模型选择弹层"
            onPress={() => setIsModelSheetVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.modelSheet}>
            <ThemedText style={styles.modelSheetTitle}>选择模型</ThemedText>
            {modelsError ? (
              <View style={styles.modelErrorBanner}>
                <ThemedText style={styles.modelErrorText}>{modelsError}</ThemedText>
                <Pressable onPress={() => void loadModels()} style={styles.modelRetryButton}>
                  <ThemedText style={styles.modelRetryText}>
                    {isModelsLoading ? '重试中...' : '重新加载'}
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            {isModelsLoading ? (
              <View style={styles.modelLoadingState}>
                <ActivityIndicator color="#1664FF" />
                <ThemedText style={styles.modelLoadingText}>正在获取模型列表...</ThemedText>
              </View>
            ) : (
              <ScrollView style={styles.modelList} showsVerticalScrollIndicator>
                {/*
                 * 渲染位置: 模型选择弹层列表区
                 * 展示内容: 当前可切换的 AI 模型名称和选中态
                 * 数据来源: /api/ai/models 返回的 models 状态
                 */}
                {models.map((model) => (
                  <Pressable key={model.id} onPress={() => selectModel(model.id)} style={styles.modelOption}>
                    <ThemedText numberOfLines={1} style={styles.modelOptionText}>{model.label}</ThemedText>
                    {model.id === selectedModel ? (
                      <MaterialIcons name="check" size={20} color="#1664FF" />
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function formatModelLabel(model: string) {
  return model.replace(/-/g, ' ').replace(/^gemini/i, 'gemini');
}

function formatKnowledgeTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatAttachmentTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function waitForScreenSettled() {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      requestAnimationFrame(() => resolve());
    }, DRAWER_ANIMATION_MS + 80);
  });
}

const markdownStyles = {
  body: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  heading1: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  heading2: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  heading3: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  bullet_list: {
    marginTop: 0,
    marginBottom: 8,
  },
  ordered_list: {
    marginTop: 0,
    marginBottom: 8,
  },
  list_item: {
    color: '#334155',
    marginBottom: 4,
  },
  strong: {
    color: '#0F172A',
    fontWeight: '700',
  },
  em: {
    fontStyle: 'italic',
  },
  code_inline: {
    color: '#1664FF',
    backgroundColor: '#EAF2FF',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  code_block: {
    color: '#E2E8F0',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  fence: {
    color: '#E2E8F0',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  blockquote: {
    borderLeftWidth: 4,
    borderLeftColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  link: {
    color: '#1664FF',
  },
} as const;

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4F46E5',
    shadowColor: '#312E81',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  floatingButtonContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
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
    minHeight: 118,
    marginBottom: 12,
  },
  conversationNav: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  menuButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#F5F6F8',
  },
  conversationTitle: {
    flex: 1,
    marginHorizontal: 16,
    color: '#111827',
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 24,
    textAlign: 'center',
  },
  newConversationButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newConversationButtonDisabled: {
    opacity: 0.5,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTitle: {
    color: '#000000',
    fontSize: 32,
    fontWeight: '100',
    lineHeight: 38,
  },
  modelSelector: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginLeft: 18,
  },
  modelPill: {
    flex: 1,
    maxWidth: 176,
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
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
  modelStatusText: {
    maxWidth: 212,
    marginTop: 4,
    color: '#D97706',
    fontSize: 12,
    lineHeight: 16,
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
  knowledgeMeta: {
    marginBottom: 6,
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
  },
  captureButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#1664FF',
  },
  captureButtonDisabled: {
    opacity: 0.56,
  },
  captureText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  attachmentScroller: {
    marginBottom: 8,
  },
  attachmentList: {
    gap: 8,
    paddingRight: 4,
  },
  attachmentCard: {
    width: 92,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D6E4FF',
    backgroundColor: '#FFFFFF',
    padding: 5,
  },
  attachmentImage: {
    width: '100%',
    height: 58,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  attachmentMeta: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
  },
  attachmentName: {
    flex: 1,
    color: '#334155',
    fontSize: 10,
    lineHeight: 14,
  },
  removeAttachmentButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#0F172A',
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
  streamingState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 12,
  },
  toolBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
  },
  toolButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#EFEFEF',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  input: {
    minHeight: 28,
    maxHeight: 96,
    color: '#000000',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    paddingVertical: 0,
  },
  sendActionButton: {
    minWidth: 88,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: '#8EA46F',
    paddingHorizontal: 12,
  },
  sendActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
  modelErrorBanner: {
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    padding: 12,
    gap: 8,
  },
  modelErrorText: {
    color: '#9A3412',
    fontSize: 12,
    lineHeight: 18,
  },
  modelRetryButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#1664FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  modelRetryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  modelLoadingState: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modelLoadingText: {
    color: '#64748B',
    fontSize: 13,
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
