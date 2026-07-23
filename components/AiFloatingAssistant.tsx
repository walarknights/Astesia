import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Easing,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
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
import { MermaidDiagram } from '@/components/MermaidDiagram';
import { AppPalette } from '@/constants/theme';
import {
  AI_ASSISTANT_WELCOME_MESSAGE,
  DEFAULT_AI_CONVERSATION_TITLE,
  DEFAULT_AI_MODEL_ID,
  MAX_AI_CONVERSATION_TITLE_LENGTH,
  createAiAssistantConversation,
  createAiAssistantMessage,
  deleteAiAssistantConversation,
  isDefaultAiConversationTitle,
  loadAiAssistantConversations,
  normalizeAiConversationTitle,
  requestAiAssistantReply,
  requestAiConversationTitle,
  requestAiModels,
  saveAiAssistantConversation,
  type AiAssistantConversation,
  type AiAssistantMessage,
  type AiAssistantStreamStatus,
  type AiModel,
} from '@/services/ai-assistant';
import { buildAiScreenKnowledge, type AiScreenKnowledgeSnapshot } from '@/services/ai-screen-knowledge';
import { useScreenCapture } from '@/services/screen-capture';

const DRAWER_WIDTH_RATIO = 0.92;
const CONVERSATION_DRAWER_WIDTH_RATIO = 0.75;
const DRAWER_MAX_WIDTH = 350;
const DRAWER_ANIMATION_MS = 240;
const KNOWLEDGE_PANEL_ANIMATION_MS = 180;
const KNOWLEDGE_INCLUDE_TOGGLE_ANIMATION_MS = 220;
const KNOWLEDGE_PANEL_HEIGHT = 220;
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

type ScreenKnowledgeOverride = {
  key: string;
  snapshot: AiScreenKnowledgeSnapshot;
};

export function AiFloatingAssistant() {
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams();
  const { captureAppScreen } = useScreenCapture();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const drawerWidth = Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH);
  const drawerTranslateX = useRef(new Animated.Value(-drawerWidth)).current;
  const knowledgePanelProgress = useRef(new Animated.Value(0)).current;
  const knowledgeIncludeProgress = useRef(new Animated.Value(0)).current;
  const floatingPosition = useRef(new Animated.ValueXY({ x: 0, y: FLOATING_BUTTON_INITIAL_TOP })).current;
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [currentConversation, setCurrentConversation] = useState<AiAssistantConversation>(() => createAiAssistantConversation());
  const [conversations, setConversations] = useState<AiAssistantConversation[]>([]);
  const [messages, setMessages] = useState<AiAssistantMessage[]>(currentConversation.messages);
  const [models, setModels] = useState<AiModel[]>([{ id: DEFAULT_AI_MODEL_ID, label: DEFAULT_AI_MODEL_ID }]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_AI_MODEL_ID);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [streamStatus, setStreamStatus] = useState<AiAssistantStreamStatus>('thinking');
  const [isModelsLoading, setIsModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isWebSearchAvailable, setIsWebSearchAvailable] = useState(false);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  const [isModelSheetVisible, setIsModelSheetVisible] = useState(false);
  const [isConversationDrawerVisible, setIsConversationDrawerVisible] = useState(false);
  const [activeConversationActionId, setActiveConversationActionId] = useState<string | null>(null);
  const [conversationTitleDraft, setConversationTitleDraft] = useState('');
  const [isConversationTitleEditing, setIsConversationTitleEditing] = useState(false);
  const [isTitleSummarizing, setIsTitleSummarizing] = useState(false);
  const [conversationSyncError, setConversationSyncError] = useState<string | null>(null);
  const [isKnowledgeExpanded, setIsKnowledgeExpanded] = useState(false);
  // [变更] 修改前: 知识库浮层直接挂在 knowledgeSection 内，并依赖局部绝对定位覆盖消息区
  // [变更] 修改后: 记录知识库入口在抽屉中的锚点位置，把浮层提升到抽屉级绝对定位层
  // [原因] 避免 Android 上子视图超出父容器边界后可见但不可触摸，导致内容无法滚动
  const [knowledgePanelAnchor, setKnowledgePanelAnchor] = useState<{ left: number; top: number } | null>(null);
  // [变更] 修改前: 屏幕知识会在发送消息时默认参与 AI 请求
  // [变更] 修改后: 增加显式选择状态，只有用户主动开启时才把当前屏幕知识带入对话
  // [原因] 满足“默认不添加到对话中，由用户自己选择”的交互要求
  const [shouldIncludeScreenKnowledge, setShouldIncludeScreenKnowledge] = useState(false);
  const [pendingImageAttachments, setPendingImageAttachments] = useState<PendingImageAttachment[]>([]);
  const [isCapturingScreenImage, setIsCapturingScreenImage] = useState(false);
  const [screenKnowledge, setScreenKnowledge] = useState<AiScreenKnowledgeSnapshot>(() => ({
    route: pathname,
    summary: `当前页面路径：${pathname}。正在读取屏幕文字内容...`,
    source: 'fallback',
    updatedAt: new Date().toISOString(),
  }));
  const [isScreenKnowledgeLoading, setIsScreenKnowledgeLoading] = useState(false);
  const [isKnowledgeEditing, setIsKnowledgeEditing] = useState(false);
  const [screenKnowledgeDraft, setScreenKnowledgeDraft] = useState('');
  const [screenKnowledgeOverride, setScreenKnowledgeOverride] = useState<ScreenKnowledgeOverride | null>(null);
  const isMountedRef = useRef(true);
  const messageScrollRef = useRef<ScrollView | null>(null);
  const messagesRef = useRef<AiAssistantMessage[]>([AI_ASSISTANT_WELCOME_MESSAGE]);
  const currentConversationRef = useRef(currentConversation);
  const conversationsRef = useRef<AiAssistantConversation[]>([]);
  const autoScrollEnabledRef = useRef(true);
  const activeAiRequestAbortControllerRef = useRef<AbortController | null>(null);
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
  const currentKnowledgeKey = useMemo(
    () => `${pathname}::${routeParamSignature}`,
    [pathname, routeParamSignature]
  );

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      activeAiRequestAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setIsKnowledgeEditing(false);
  }, [currentKnowledgeKey]);

  useEffect(() => {
    currentConversationRef.current = currentConversation;
  }, [currentConversation]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

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
    setIsWebSearchAvailable(result.webSearchAvailable);
    setIsWebSearchEnabled((currentValue) => currentValue && result.webSearchAvailable);
    setSelectedModel((currentModel) => (
      nextModels.some((model) => model.id === currentModel) ? currentModel : nextModels[0].id
    ));
    setIsModelsLoading(false);
  }, []);

  useEffect(() => {
    let active = true;

    const syncConversations = async () => {
      const storedConversations = await loadAiAssistantConversations();
      const nextConversation = storedConversations[0] ?? createAiAssistantConversation();
      const nextConversations = storedConversations.length > 0
        ? storedConversations
        : [nextConversation];

      if (active) {
        currentConversationRef.current = nextConversation;
        conversationsRef.current = nextConversations;
        messagesRef.current = nextConversation.messages;
        setCurrentConversation(nextConversation);
        setConversations(nextConversations);
        setMessages(nextConversation.messages);
        setIsHistoryLoading(false);
      }
    };

    void syncConversations();

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
  // [变更] 修改前: 历史抽屉宽度按屏幕宽度 25% 计算，并额外限制到 180
  // [变更] 修改后: 历史抽屉宽度改为主 AI 抽屉宽度的 50%，与主面板保持稳定比例
  // [原因] 历史标题和时间需要更充足的展示空间，避免在窄屏下列表信息被过度压缩
  const conversationDrawerWidth = drawerWidth * CONVERSATION_DRAWER_WIDTH_RATIO;
  const conversationTitle = currentConversation.title || DEFAULT_AI_CONVERSATION_TITLE;
  const activeScreenKnowledge = useMemo(() => {
    if (screenKnowledgeOverride?.key === currentKnowledgeKey) {
      return screenKnowledgeOverride.snapshot;
    }

    return screenKnowledge;
  }, [currentKnowledgeKey, screenKnowledge, screenKnowledgeOverride]);
  const isVisibleScreenKnowledgeLoading = isScreenKnowledgeLoading && activeScreenKnowledge.source !== 'user-edited';
  useEffect(() => {
    if (!isKnowledgeEditing) {
      setScreenKnowledgeDraft(activeScreenKnowledge.summary);
    }
  }, [activeScreenKnowledge, isKnowledgeEditing]);
  const activeConversationAction = useMemo(() => {
    if (!activeConversationActionId) {
      return null;
    }

    return conversations.find((conversation) => conversation.id === activeConversationActionId)
      ?? (currentConversation.id === activeConversationActionId ? currentConversation : null);
  }, [activeConversationActionId, conversations, currentConversation]);
  const knowledgePanelAnimatedStyle = useMemo(
    () => ({
      height: knowledgePanelProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, KNOWLEDGE_PANEL_HEIGHT],
      }),
      marginTop: knowledgePanelProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 8],
      }),
      opacity: knowledgePanelProgress,
    }),
    [knowledgePanelProgress]
  );
  const knowledgeCaretAnimatedStyle = useMemo(
    () => ({
      transform: [
        {
          rotate: knowledgePanelProgress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', '180deg'],
          }),
        },
      ],
    }),
    [knowledgePanelProgress]
  );
  // [变更] 修改前: “加入对话”按钮状态切换时只会立即替换图标
  // [变更] 修改后: 增加按钮底色、缩放和图标交叉淡入淡出动画
  // [原因] 让知识库开关的视觉反馈更顺滑，减少硬切换的突兀感
  const knowledgeIncludeButtonAnimatedStyle = useMemo(
    () => ({
      backgroundColor: knowledgeIncludeProgress.interpolate({
        inputRange: [0, 1],
        outputRange: ['rgba(255, 255, 255, 0)', 'rgba(22, 100, 255, 0.12)'],
      }),
      borderColor: knowledgeIncludeProgress.interpolate({
        inputRange: [0, 1],
        outputRange: ['rgba(148, 163, 184, 0.32)', 'rgba(22, 100, 255, 0.26)'],
      }),
      transform: [
        {
          scale: knowledgeIncludeProgress.interpolate({
            inputRange: [0, 0.65, 1],
            outputRange: [1, 1.08, 1],
          }),
        },
      ],
    }),
    [knowledgeIncludeProgress]
  );
  const knowledgeIncludeInactiveIconAnimatedStyle = useMemo(
    () => ({
      opacity: knowledgeIncludeProgress.interpolate({
        inputRange: [0, 0.6, 1],
        outputRange: [1, 0.18, 0],
      }),
      transform: [
        {
          scale: knowledgeIncludeProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.82],
          }),
        },
      ],
    }),
    [knowledgeIncludeProgress]
  );
  const knowledgeIncludeActiveIconAnimatedStyle = useMemo(
    () => ({
      opacity: knowledgeIncludeProgress,
      transform: [
        {
          scale: knowledgeIncludeProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.72, 1],
          }),
        },
        {
          rotate: knowledgeIncludeProgress.interpolate({
            inputRange: [0, 1],
            outputRange: ['-18deg', '0deg'],
          }),
        },
      ],
    }),
    [knowledgeIncludeProgress]
  );

  useEffect(() => {
    Animated.timing(knowledgePanelProgress, {
      toValue: isKnowledgeExpanded ? 1 : 0,
      duration: KNOWLEDGE_PANEL_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isKnowledgeExpanded, knowledgePanelProgress]);

  useEffect(() => {
    Animated.timing(knowledgeIncludeProgress, {
      toValue: shouldIncludeScreenKnowledge ? 1 : 0,
      duration: KNOWLEDGE_INCLUDE_TOGGLE_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [knowledgeIncludeProgress, shouldIncludeScreenKnowledge]);

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

  const syncConversationToStorage = useCallback((conversation: AiAssistantConversation, shouldSetCurrent = false) => {
    if (shouldSetCurrent) {
      currentConversationRef.current = conversation;
      messagesRef.current = conversation.messages;
      setCurrentConversation(conversation);
      setMessages(conversation.messages);
    }

    setConversations((currentConversations) => {
      const nextConversations = upsertAiConversationList(currentConversations, conversation);
      conversationsRef.current = nextConversations;
      return nextConversations;
    });

    void saveAiAssistantConversation(conversation).then((result) => {
      if (!isMountedRef.current) {
        return;
      }

      setConversationSyncError(result.errorMessage);
      setConversations((currentConversations) => {
        const nextConversations = upsertAiConversationList(currentConversations, result.conversation);
        conversationsRef.current = nextConversations;
        return nextConversations;
      });

      if (shouldSetCurrent && currentConversationRef.current.id === result.conversation.id) {
        currentConversationRef.current = result.conversation;
        messagesRef.current = result.conversation.messages;
        setCurrentConversation(result.conversation);
        setMessages(result.conversation.messages);
      }
    });
  }, []);

  const updateMessages = useCallback((updater: MessageStateUpdater, shouldPersist = true) => {
    setMessages((currentMessages) => {
      const nextMessages = typeof updater === 'function'
        ? updater(currentMessages)
        : updater;
      const nextConversation = {
        ...currentConversationRef.current,
        messages: nextMessages,
        updatedAt: new Date().toISOString(),
      };

      messagesRef.current = nextMessages;
      currentConversationRef.current = nextConversation;
      setCurrentConversation(nextConversation);

      if (shouldPersist) {
        syncConversationToStorage(nextConversation);
      }

      return nextMessages;
    });
  }, [syncConversationToStorage]);

  const appendSystemMessage = useCallback((content: string) => {
    updateMessages(
      [...messagesRef.current, createAiAssistantMessage('system', content)]
    );
  }, [updateMessages]);

  const refreshScreenKnowledge = useCallback(async () => {
    setIsScreenKnowledgeLoading(true);

    try {
      const nextKnowledge = await buildAiScreenKnowledge(pathname, screenKnowledgeRouteParams);

      if (isMountedRef.current) {
        setScreenKnowledge(nextKnowledge);
      }

      return nextKnowledge;
    } finally {
      if (isMountedRef.current) {
        setIsScreenKnowledgeLoading(false);
      }
    }
  // [变更] 修改前: 知识库只读取当前路径的占位文案
  // [变更] 修改后: 路由或参数变化时重建页面文字摘要
  // [原因] 让 AI 对话能够结合当前页面真实业务文本回答
  }, [pathname, screenKnowledgeRouteParams]);

  const startEditingScreenKnowledge = useCallback(() => {
    setScreenKnowledgeDraft(activeScreenKnowledge.summary);
    setIsKnowledgeEditing(true);
  }, [activeScreenKnowledge.summary]);

  const cancelEditingScreenKnowledge = useCallback(() => {
    setScreenKnowledgeDraft(activeScreenKnowledge.summary);
    setIsKnowledgeEditing(false);
  }, [activeScreenKnowledge.summary]);

  const saveScreenKnowledgeEdit = useCallback(() => {
    const nextSummary = screenKnowledgeDraft.trim();

    if (!nextSummary) {
      Alert.alert('无法保存', '屏幕知识库内容不能为空。');
      return;
    }

    // [变更] 修改前: 屏幕知识只能展示自动读取结果，用户无法修正或补充内容
    // [变更] 修改后: 允许用户保存一份当前路由下的手动摘要覆盖自动读取结果
    // [原因] 满足“用户能够编辑屏幕知识库内容”的需求，同时保留自动读取作为可恢复的基础数据
    const nextSnapshot: AiScreenKnowledgeSnapshot = {
      ...activeScreenKnowledge,
      summary: nextSummary,
      source: 'user-edited',
      updatedAt: new Date().toISOString(),
    };

    setScreenKnowledgeOverride({
      key: currentKnowledgeKey,
      snapshot: nextSnapshot,
    });
    setScreenKnowledgeDraft(nextSummary);
    setIsKnowledgeEditing(false);
  }, [activeScreenKnowledge, currentKnowledgeKey, screenKnowledgeDraft]);

  const restoreAutoScreenKnowledge = useCallback(() => {
    setScreenKnowledgeOverride((currentOverride) => (
      currentOverride?.key === currentKnowledgeKey ? null : currentOverride
    ));
    setIsKnowledgeEditing(false);
    void refreshScreenKnowledge();
  }, [currentKnowledgeKey, refreshScreenKnowledge]);

  useEffect(() => {
    void refreshScreenKnowledge();
  }, [refreshScreenKnowledge]);

  useEffect(() => {
    if (!isDrawerVisible) {
      return;
    }

    // [变更] 修改前: 屏幕知识只会在路由变化时刷新一次，同一路由内的异步数据更新不会重新读取
    // [变更] 修改后: 每次打开 AI 抽屉时重新读取当前页面摘要
    // [原因] 首页天气、笔记列表和待办列表会在当前路由内继续加载或编辑，需要在查看前拿到最新内容
    void refreshScreenKnowledge();
  }, [isDrawerVisible, refreshScreenKnowledge]);

  useEffect(() => {
    if (!isDrawerVisible || !isKnowledgeExpanded) {
      return;
    }

    // [变更] 修改前: 抽屉打开后若页面内容继续变化，展开知识库时仍可能看到旧摘要
    // [变更] 修改后: 知识库展开时再次触发一次刷新
    // [原因] 保证用户真正查看“当前屏幕知识库”时拿到尽可能新的页面上下文
    void refreshScreenKnowledge();
  }, [isDrawerVisible, isKnowledgeExpanded, refreshScreenKnowledge]);

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
          await refreshScreenKnowledge();
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

    const nextConversation = createAiAssistantConversation();

    // [变更] 修改前: “+” 仅清空当前消息数组
    // [变更] 修改后: 创建独立会话并保存到本地缓存和远端
    // [原因] 多轮对话需要保留旧会话，同时让新会话拥有独立 id 与标题
    setDraftMessage('');
    setPendingImageAttachments([]);
    setIsConversationDrawerVisible(false);
    autoScrollEnabledRef.current = true;
    syncConversationToStorage(nextConversation, true);
    scrollMessagesToEnd(false);
  }, [isSending, scrollMessagesToEnd, syncConversationToStorage]);

  const selectModel = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    setIsModelSheetVisible(false);
  }, []);

  const selectConversation = useCallback((conversation: AiAssistantConversation) => {
    currentConversationRef.current = conversation;
    messagesRef.current = conversation.messages;
    autoScrollEnabledRef.current = true;
    setCurrentConversation(conversation);
    setMessages(conversation.messages);
    setDraftMessage('');
    setPendingImageAttachments([]);
    setIsConversationDrawerVisible(false);
    scrollMessagesToEnd(false);
  }, [scrollMessagesToEnd]);

  const closeConversationActions = useCallback(() => {
    setActiveConversationActionId(null);
    setConversationTitleDraft('');
    setIsConversationTitleEditing(false);
  }, []);

  const handleKnowledgeSectionLayout = useCallback((event: LayoutChangeEvent) => {
    const { height: layoutHeight, x, y } = event.nativeEvent.layout;
    const nextAnchor = {
      left: Math.round(x),
      top: Math.round(y + layoutHeight),
    };

    setKnowledgePanelAnchor((currentAnchor) => (
      currentAnchor && currentAnchor.left === nextAnchor.left && currentAnchor.top === nextAnchor.top
        ? currentAnchor
        : nextAnchor
    ));
  }, []);

  // [变更] 修改前: 历史对话长按直接使用系统 Alert，标题只能作为静态文案展示
  // [变更] 修改后: 改为打开组件内自定义操作弹层，可从标题本身进入编辑态
  // [原因] 满足“点击标题即可修改”的交互诉求，同时保留删除和总结标题能力
  const openConversationActions = useCallback((
    conversation: AiAssistantConversation,
    shouldStartEditing = false
  ) => {
    setActiveConversationActionId(conversation.id);
    setConversationTitleDraft(conversation.title);
    setIsConversationTitleEditing(shouldStartEditing);
  }, []);

  const summarizeConversationTitle = useCallback(async (
    conversationId: string,
    summaryMessages?: AiAssistantMessage[],
    conversationMessages?: AiAssistantMessage[]
  ) => {
    if (isTitleSummarizing) {
      return;
    }

    const targetConversation = conversationsRef.current.find((conversation) => conversation.id === conversationId)
      ?? (currentConversationRef.current.id === conversationId ? currentConversationRef.current : null);
    const nextSummaryMessages = summaryMessages ?? targetConversation?.messages;

    if (!targetConversation || !nextSummaryMessages || nextSummaryMessages.length === 0) {
      return;
    }

    setIsTitleSummarizing(true);

    try {
      const title = await requestAiConversationTitle(nextSummaryMessages);
      const now = new Date().toISOString();
      const nextConversation = {
        ...targetConversation,
        title,
        messages: conversationMessages ?? targetConversation.messages,
        titleGeneratedAt: now,
        updatedAt: now,
      };

      syncConversationToStorage(nextConversation, currentConversationRef.current.id === conversationId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '对话标题总结失败，请稍后重试。';
      Alert.alert('总结标题失败', errorMessage);
    } finally {
      if (isMountedRef.current) {
        setIsTitleSummarizing(false);
      }
    }
  }, [isTitleSummarizing, syncConversationToStorage]);

  // [变更] 修改前: 会话标题只能依赖 AI 自动总结生成
  // [变更] 修改后: 支持用户手动重命名，并继续复用现有本地/远端同步链路
  // [原因] 让用户可以直接修正历史会话标题，避免只能反复触发 AI 总结
  const renameConversationTitle = useCallback((conversationId: string, nextTitle: string) => {
    const targetConversation = conversationsRef.current.find((conversation) => conversation.id === conversationId)
      ?? (currentConversationRef.current.id === conversationId ? currentConversationRef.current : null);

    if (!targetConversation) {
      return;
    }

    const now = new Date().toISOString();
    const nextConversation = {
      ...targetConversation,
      title: normalizeAiConversationTitle(nextTitle),
      updatedAt: now,
    };

    syncConversationToStorage(nextConversation, currentConversationRef.current.id === conversationId);
  }, [syncConversationToStorage]);

  const confirmConversationTitleEdit = useCallback(() => {
    if (!activeConversationAction) {
      return;
    }

    const nextTitle = normalizeAiConversationTitle(conversationTitleDraft);

    if (nextTitle !== activeConversationAction.title) {
      renameConversationTitle(activeConversationAction.id, conversationTitleDraft);
    }

    closeConversationActions();
  }, [
    activeConversationAction,
    closeConversationActions,
    conversationTitleDraft,
    renameConversationTitle,
  ]);

  const deleteConversation = useCallback((conversationId: string) => {
    const nextConversations = conversationsRef.current.filter((conversation) => conversation.id !== conversationId);
    const fallbackConversation = nextConversations[0] ?? createAiAssistantConversation();

    conversationsRef.current = nextConversations.length > 0 ? nextConversations : [fallbackConversation];
    setConversations(conversationsRef.current);

    if (currentConversationRef.current.id === conversationId) {
      selectConversation(fallbackConversation);
    }

    void deleteAiAssistantConversation(conversationId).then((result) => {
      if (isMountedRef.current) {
        setConversationSyncError(result.errorMessage);
      }
    });

    if (nextConversations.length === 0) {
      syncConversationToStorage(fallbackConversation, currentConversationRef.current.id === fallbackConversation.id);
    }
  }, [selectConversation, syncConversationToStorage]);

  const handleConversationLongPress = useCallback((conversation: AiAssistantConversation) => {
    openConversationActions(conversation);
  }, [openConversationActions]);

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

  // [新增] 发送中的按钮需要复用为停止入口，通过 AbortController 终止当前 AI 流式请求
  // [原因] 长回复或联网搜索耗时较长时，用户应能主动结束本轮对话
  const stopStreamingReply = useCallback(() => {
    activeAiRequestAbortControllerRef.current?.abort();
  }, []);

  const sendMessage = useCallback(async () => {
    if (isSending) {
      return;
    }

    const nextMessage = draftMessage.trim();

    if (!nextMessage) {
      return;
    }

    const abortController = new AbortController();
    const userMessage = createAiAssistantMessage('user', nextMessage);
    const assistantMessage = createAiAssistantMessage('assistant', '');
    const requestMessages = [...messagesRef.current, userMessage];
    const pendingMessages = [...requestMessages, assistantMessage];
    const activeConversationId = currentConversationRef.current.id;
    const shouldAutoSummarizeTitle = (
      countUserMessages(requestMessages) === 1
      && isDefaultAiConversationTitle(currentConversationRef.current.title)
    );

    activeAiRequestAbortControllerRef.current = abortController;
    setIsSending(true);
    setStreamStatus('thinking');

    try {
      let requestKnowledgeSnapshot = activeScreenKnowledge;

      if (shouldIncludeScreenKnowledge && activeScreenKnowledge.source !== 'user-edited') {
        try {
          // [变更] 修改前: 发送时直接复用当前面板里的屏幕知识，可能落后于同页内最新图表状态
          // [变更] 修改后: 自动知识库在发送前再次读取当前页面摘要，手动编辑内容仍保留用户版本
          // [原因] 股票区间切换、天气更新等同路由内数据变化，需要在真正发起对话前拿到最新上下文
          const latestKnowledge = await refreshScreenKnowledge();

          if (latestKnowledge) {
            requestKnowledgeSnapshot = latestKnowledge;
          }
        } catch {
          requestKnowledgeSnapshot = activeScreenKnowledge;
        }
      }

      // [变更] 修改前: 每次发送都会无条件携带当前屏幕知识
      // [变更] 修改后: 仅在用户显式开启后，才把 route/summary 注入本轮 AI 请求
      // [原因] 当前屏幕知识属于可选辅助上下文，不应默认影响所有对话
      const requestScreenKnowledge = shouldIncludeScreenKnowledge
        ? { route: requestKnowledgeSnapshot.route, summary: requestKnowledgeSnapshot.summary }
        : null;

      if (abortController.signal.aborted) {
        return;
      }

      // [变更] 修改前: 图片附件状态会拼接成用户气泡里的说明文字
      // [变更] 修改后: 用户消息只保留输入框文本，附件继续停留在独立附件 UI 中
      // [原因] 屏幕截图当前还未接入多模态发送，不能伪装成用户输入内容
      autoScrollEnabledRef.current = true;
      updateMessages(pendingMessages);
      setDraftMessage('');
      setPendingImageAttachments([]);
      scrollMessagesToEnd();

      // [变更] 修改前: AI 请求只上传消息内容，不携带当前会话 id
      // [变更] 修改后: 把 activeConversationId 一并传给服务层，并用 AbortSignal 支持用户停止回复
      // [原因] 服务端需要按用户 + 会话归档 token 消耗与扣费记录，前端也需要能主动终止长回复
      const assistantReply = await requestAiAssistantReply(requestMessages, requestScreenKnowledge, selectedModel, {
        conversationId: activeConversationId,
        signal: abortController.signal,
        webSearchEnabled: isWebSearchEnabled,
        onStatusChange: setStreamStatus,
        onChunk: (_, fullContent) => {
          updateMessages((currentMessages) => currentMessages.map((message) => (
            message.id === assistantMessage.id
              ? { ...message, content: fullContent }
              : message
          )), false);
        },
      });

      const finalMessages = messagesRef.current.map((message) => (
        message.id === assistantMessage.id
          ? { ...message, content: assistantReply }
          : message
      ));

      updateMessages(finalMessages);

      if (shouldAutoSummarizeTitle) {
        void summarizeConversationTitle(activeConversationId, [
          userMessage,
          { ...assistantMessage, content: assistantReply },
        ], finalMessages);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        updateMessages((currentMessages) => {
          if (!currentMessages.some((message) => message.id === userMessage.id)) {
            return currentMessages;
          }

          const nextMessages = currentMessages.filter((message) => (
            message.id !== assistantMessage.id || message.content.trim().length > 0
          ));

          return [...nextMessages, createAiAssistantMessage('system', '已停止本轮回复。')];
        });
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'AI 服务暂时不可用，请稍后再试。';

      updateMessages((currentMessages) => {
        const nextMessages = currentMessages.filter((message) => (
          message.id !== assistantMessage.id || message.content.trim().length > 0
        ));

        return [...nextMessages, createAiAssistantMessage('system', errorMessage)];
      });
    } finally {
      if (activeAiRequestAbortControllerRef.current === abortController) {
        activeAiRequestAbortControllerRef.current = null;
      }

      setIsSending(false);
      setStreamStatus('thinking');
    }
  }, [
    draftMessage,
    isSending,
    activeScreenKnowledge,
    refreshScreenKnowledge,
    scrollMessagesToEnd,
    selectedModel,
    shouldIncludeScreenKnowledge,
    isWebSearchEnabled,
    summarizeConversationTitle,
    updateMessages,
  ]);

  const handleSendActionPress = useCallback(() => {
    if (isSending) {
      stopStreamingReply();
      return;
    }

    void sendMessage();
  }, [isSending, sendMessage, stopStreamingReply]);

  // [变更] 修改前: 发送中按钮禁用，只能等待 AI 流自然结束
  // [变更] 修改后: 仅在空闲且无输入时禁用，发送中保持可点击并触发停止
  // [原因] 用户需要在长回复或搜索过程中主动终止当前对话
  const isSendDisabled = !isSending && !draftMessage.trim();
  const sendButtonLabel = isSending ? '停止' : '发送';
  const streamingStatusLabel = formatAiStreamStatus(streamStatus);
  const toggleWebSearch = useCallback(() => {
    if (!isWebSearchAvailable) {
      Alert.alert('联网搜索不可用', '服务端尚未配置联网搜索能力。');
      return;
    }

    setIsWebSearchEnabled((currentValue) => !currentValue);
  }, [isWebSearchAvailable]);

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
                 * 展示内容: 历史对话菜单入口、可点击修改的当前对话标题和新对话按钮
                 * 数据来源: currentConversation.title、openConversationActions 与 startNewConversation
                 */}
                <View style={styles.conversationNav}>
                  <Pressable
                    accessibilityLabel="打开已保存的 AI 多轮对话菜单"
                    accessibilityRole="button"
                    onPress={() => setIsConversationDrawerVisible(true)}
                    style={styles.menuButton}>
                    <MaterialIcons name="menu-open" size={24} color={AppPalette.text} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="修改当前对话标题"
                    accessibilityRole="button"
                    onPress={() => openConversationActions(currentConversation, true)}
                    style={styles.conversationTitleBox}>
                    <ThemedText numberOfLines={1} style={styles.conversationTitle}>
                      {conversationTitle}
                    </ThemedText>
                    {isTitleSummarizing ? (
                      <ActivityIndicator color={AppPalette.textMuted} size="small" />
                    ) : null}
                  </Pressable>
                  <Pressable
                    accessibilityLabel="开启一轮新 AI 对话"
                    accessibilityRole="button"
                    disabled={isSending}
                    onPress={startNewConversation}
                    style={[styles.newConversationButton, isSending && styles.newConversationButtonDisabled]}>
                    <MaterialIcons name="add" size={30} color={AppPalette.text} />
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
                    <MaterialIcons name="psychology" size={27} color={AppPalette.brandLight} />
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
               * 展示内容: 当前屏幕知识库入口、是否加入对话的选择按钮，展开后显示可滚动摘要小窗和刷新入口
               * 数据来源: expo-router 当前路径、路由参数、本地页面业务数据和 shouldIncludeScreenKnowledge 状态
               */}
              <View onLayout={handleKnowledgeSectionLayout} style={styles.knowledgeSection}>
                <View style={styles.knowledgeToggle}>
                  <Pressable
                    accessibilityLabel="展开或收起当前屏幕知识库"
                    accessibilityRole="button"
                    onPress={() => setIsKnowledgeExpanded((visible) => !visible)}
                    style={styles.knowledgeExpandButton}>
                    <MaterialIcons name="summarize" size={24} color={AppPalette.brandLight} />
                    <ThemedText numberOfLines={1} style={styles.knowledgeTitle}>
                      当前屏幕知识库
                    </ThemedText>
                  </Pressable>
                  {/*
                   * 渲染位置: AI 抽屉顶部知识库入口右侧
                   * 展示内容: 控制是否把当前屏幕知识加入本轮对话的选择按钮
                   * 数据来源: shouldIncludeScreenKnowledge 状态
                   */}
                  <Pressable
                    accessibilityHint="轻点切换发送消息时是否附带当前屏幕知识"
                    accessibilityLabel="将当前屏幕知识加入对话"
                    accessibilityRole="switch"
                    accessibilityState={{ checked: shouldIncludeScreenKnowledge }}
                    onPress={() => setShouldIncludeScreenKnowledge((current) => !current)}
                    style={styles.knowledgeIncludePressable}>
                    {/*
                     * 渲染位置: AI 抽屉顶部知识库入口右侧选择开关内部
                     * 展示内容: 未选中圆环与选中勾选图标的平滑切换动画
                     * 数据来源: shouldIncludeScreenKnowledge 状态与 knowledgeIncludeProgress 动画进度
                     */}
                    <Animated.View style={[styles.knowledgeIncludeButton, knowledgeIncludeButtonAnimatedStyle]}>
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.knowledgeIncludeIconLayer, knowledgeIncludeInactiveIconAnimatedStyle]}>
                        <MaterialIcons name="radio-button-unchecked" size={22} color="#94A3B8" />
                      </Animated.View>
                      <Animated.View
                        pointerEvents="none"
                        style={[styles.knowledgeIncludeIconLayer, knowledgeIncludeActiveIconAnimatedStyle]}>
                        <MaterialIcons name="check-circle" size={22} color={AppPalette.brandLight} />
                      </Animated.View>
                    </Animated.View>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="展开或收起当前屏幕知识库"
                    accessibilityRole="button"
                    onPress={() => setIsKnowledgeExpanded((visible) => !visible)}
                    style={styles.knowledgeCaretButton}>
                    <Animated.View style={[styles.knowledgeCaret, knowledgeCaretAnimatedStyle]}>
                      <MaterialIcons name="arrow-drop-down" size={36} color={AppPalette.text} />
                    </Animated.View>
                  </Pressable>
                </View>
              </View>
              {knowledgePanelAnchor ? (
                <Animated.View
                  pointerEvents={isKnowledgeExpanded ? 'auto' : 'none'}
                  style={[
                    styles.knowledgePanelShell,
                    knowledgePanelAnimatedStyle,
                    {
                      left: knowledgePanelAnchor.left,
                      top: knowledgePanelAnchor.top,
                    },
                  ]}>
                  {/*
                   * 渲染位置: AI 抽屉顶部知识库入口下方的浮层面板
                   * 展示内容: 当前页面文字摘要、手动编辑区和知识库操作按钮
                   * 数据来源: activeScreenKnowledge、screenKnowledgeDraft、isKnowledgeEditing 与截图操作状态
                   */}
                  <View style={styles.knowledgePanel}>
                    {isKnowledgeEditing ? (
                      <>
                        <ThemedText style={styles.knowledgeMeta}>
                          编辑模式 · 保存后会覆盖当前屏幕知识库内容
                        </ThemedText>
                        {/*
                         * 渲染位置: 屏幕知识库浮层面板内部
                         * 展示内容: 可手动编辑的屏幕知识库文本输入框
                         * 数据来源: screenKnowledgeDraft 状态
                         */}
                        <TextInput
                          multiline
                          onChangeText={setScreenKnowledgeDraft}
                          placeholder="可手动补充当前页面重点，例如用户意图、隐藏信息或需要 AI 特别注意的内容"
                          placeholderTextColor="#94A3B8"
                          style={styles.knowledgeEditor}
                          textAlignVertical="top"
                          value={screenKnowledgeDraft}
                        />
                        {/*
                         * 渲染位置: 屏幕知识库浮层底部
                         * 展示内容: 编辑态下的保存与取消操作
                         * 数据来源: isKnowledgeEditing 状态和 screenKnowledgeDraft 状态
                         */}
                        <View style={styles.knowledgeActionRow}>
                          <Pressable
                            accessibilityLabel="保存屏幕知识库内容"
                            accessibilityRole="button"
                            onPress={saveScreenKnowledgeEdit}
                            style={styles.knowledgeActionButton}>
                            <ThemedText style={styles.knowledgeActionButtonText}>保存</ThemedText>
                          </Pressable>
                          <Pressable
                            accessibilityLabel="取消编辑屏幕知识库内容"
                            accessibilityRole="button"
                            onPress={cancelEditingScreenKnowledge}
                            style={[styles.knowledgeActionButton, styles.knowledgeActionButtonSecondary]}>
                            <ThemedText
                              style={[
                                styles.knowledgeActionButtonText,
                                styles.knowledgeActionButtonTextSecondary,
                              ]}>
                              取消
                            </ThemedText>
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <ScrollView
                        contentContainerStyle={styles.knowledgeScrollContent}
                        keyboardShouldPersistTaps="handled"
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                        style={styles.knowledgeScroll}>
                        <ThemedText style={styles.knowledgeMeta}>
                          {isVisibleScreenKnowledgeLoading
                            ? '正在读取屏幕文字...'
                            : `${shouldIncludeScreenKnowledge ? '已加入对话' : '未加入对话'} · ${formatKnowledgeSourceLabel(activeScreenKnowledge.source)} · 更新时间：${formatKnowledgeTime(activeScreenKnowledge.updatedAt)}`}
                        </ThemedText>
                        <ThemedText style={styles.knowledgeText}>{activeScreenKnowledge.summary}</ThemedText>
                        {/*
                         * 渲染位置: 屏幕知识库浮层底部
                         * 展示内容: 编辑、恢复自动读取/重新读取、读取当前屏幕三类操作按钮
                         * 数据来源: activeScreenKnowledge.source、isScreenKnowledgeLoading 和截图操作状态
                         */}
                        <View style={styles.knowledgeActionRow}>
                          <Pressable
                            accessibilityLabel="编辑屏幕知识库内容"
                            accessibilityRole="button"
                            disabled={isVisibleScreenKnowledgeLoading}
                            onPress={startEditingScreenKnowledge}
                            style={[
                              styles.knowledgeActionButton,
                              styles.knowledgeActionButtonSecondary,
                              isVisibleScreenKnowledgeLoading && styles.knowledgeActionButtonDisabled,
                            ]}>
                            <ThemedText
                              style={[
                                styles.knowledgeActionButtonText,
                                styles.knowledgeActionButtonTextSecondary,
                              ]}>
                              编辑
                            </ThemedText>
                          </Pressable>
                          <Pressable
                            accessibilityLabel={activeScreenKnowledge.source === 'user-edited' ? '恢复自动读取的屏幕知识库内容' : '重新读取当前屏幕知识库内容'}
                            accessibilityRole="button"
                            disabled={isVisibleScreenKnowledgeLoading}
                            onPress={activeScreenKnowledge.source === 'user-edited'
                              ? restoreAutoScreenKnowledge
                              : () => void refreshScreenKnowledge()}
                            style={[
                              styles.knowledgeActionButton,
                              styles.knowledgeActionButtonSecondary,
                              isVisibleScreenKnowledgeLoading && styles.knowledgeActionButtonDisabled,
                            ]}>
                            <ThemedText
                              style={[
                                styles.knowledgeActionButtonText,
                                styles.knowledgeActionButtonTextSecondary,
                              ]}>
                              {activeScreenKnowledge.source === 'user-edited' ? '恢复自动读取' : '重新读取'}
                            </ThemedText>
                          </Pressable>
                          <Pressable
                            accessibilityLabel="读取当前屏幕并截图"
                            accessibilityRole="button"
                            disabled={isVisibleScreenKnowledgeLoading || isCapturingScreenImage}
                            onPress={captureCurrentScreen}
                            style={[
                              styles.knowledgeActionButton,
                              (isVisibleScreenKnowledgeLoading || isCapturingScreenImage) && styles.knowledgeActionButtonDisabled,
                            ]}>
                            <ThemedText style={styles.knowledgeActionButtonText}>
                              {isCapturingScreenImage ? '截图中...' : '读取当前屏幕'}
                            </ThemedText>
                          </Pressable>
                        </View>
                      </ScrollView>
                    )}
                  </View>
                </Animated.View>
              ) : null}

              {/*
               * 渲染位置: AI 抽屉中部消息区
               * 展示内容: 用户、AI 与系统历史对话
               * 数据来源: messages 状态和本地持久化记录
               */}
              {/*
               * [变更] 修改前: 屏幕知识库展开后，底部消息列表仍会接管纵向手势
               * [变更] 修改后: 知识库展开期间暂时禁用消息列表的触摸和滚动
               * [原因] 让知识库浮层内的 ScrollView 能优先响应下滑操作
               */}
              <ScrollView
                ref={messageScrollRef}
                contentContainerStyle={styles.messageList}
                onContentSizeChange={handleMessageListContentChange}
                onScroll={handleMessageListScroll}
                pointerEvents={isKnowledgeExpanded ? 'none' : 'auto'}
                scrollEnabled={!isKnowledgeExpanded}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}>
                {isHistoryLoading ? (
                  <View style={styles.loadingBubble}>
                    <ActivityIndicator color={AppPalette.brandLight} />
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
                        <Markdown rules={markdownRules} style={markdownStyles}>
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
                          <ActivityIndicator color={AppPalette.brandLight} size="small" />
                          <ThemedText style={styles.loadingText}>{streamingStatusLabel}</ThemedText>
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
                      <MaterialIcons name="image" size={22} color={AppPalette.textMuted} />
                    </Pressable>
                    <Pressable accessibilityLabel="上传文件" onPress={pickDocument} style={styles.toolButton}>
                      <MaterialIcons name="folder-open" size={22} color={AppPalette.textMuted} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={isWebSearchEnabled ? '关闭联网搜索' : '开启联网搜索'}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: isWebSearchEnabled, disabled: isSending }}
                      disabled={isSending}
                      onPress={toggleWebSearch}
                      style={[
                        styles.toolButton,
                        isWebSearchEnabled && styles.toolButtonActive,
                        !isWebSearchAvailable && styles.toolButtonUnavailable,
                      ]}>
                      <MaterialIcons
                        name="travel-explore"
                        size={22}
                        color={isWebSearchEnabled ? '#FFFFFF' : AppPalette.textMuted}
                      />
                    </Pressable>
                    <Pressable accessibilityLabel="AI 配置" onPress={() => showPendingFeature('AI 配置')} style={styles.toolButton}>
                      <MaterialIcons name="add" size={22} color={AppPalette.textMuted} />
                    </Pressable>
                  </View>
                  {/*
                   * 渲染位置: AI 抽屉底部操作栏右侧
                   * 展示内容: 空闲时显示发送入口，发送中显示转圈动画并可点击停止回复
                   * 数据来源: isSending 与 draftMessage 状态
                   */}
                  <Pressable
                    accessibilityLabel={isSending ? '停止 AI 回复' : '发送消息'}
                    disabled={isSendDisabled}
                    onPress={handleSendActionPress}
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
                    cursorColor={AppPalette.brandLight}
                    keyboardAppearance="dark"
                    placeholderTextColor={AppPalette.textSubtle}
                    selectionColor={AppPalette.brandLight}
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

      <Modal
        animationType="fade"
        transparent
        visible={isConversationDrawerVisible}
        onRequestClose={() => setIsConversationDrawerVisible(false)}>
        <View style={styles.conversationDrawerRoot}>
          <Pressable
            accessibilityLabel="关闭多轮对话列表遮罩"
            onPress={() => setIsConversationDrawerVisible(false)}
            style={styles.conversationDrawerBackdrop}
          />
          {/*
           * 渲染位置: AI 对话页左侧历史会话抽屉
           * 展示内容: 已保存的多轮对话标题、更新时间、同步提示和长按操作入口
           * 数据来源: conversations 状态、本地缓存和 /api/ai/conversations 远端接口
           */}
          <View
            style={[
              styles.conversationDrawer,
              {
                width: conversationDrawerWidth,
                paddingTop: insets.top + 20,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}>
            <View style={styles.conversationDrawerHeader}>
              <MaterialIcons name="history" size={18} color="#111827" />
              <ThemedText style={styles.conversationDrawerTitle}>历史</ThemedText>
            </View>
            {conversationSyncError ? (
              <ThemedText numberOfLines={3} style={styles.conversationSyncText}>
                远端同步失败，已保存在本地
              </ThemedText>
            ) : null}
            <ScrollView
              contentContainerStyle={styles.conversationListContent}
              showsVerticalScrollIndicator={false}>
              {isHistoryLoading ? (
                <ActivityIndicator color="#1664FF" size="small" />
              ) : (
                conversations.map((conversation) => {
                  const isActiveConversation = conversation.id === currentConversation.id;

                  return (
                    <Pressable
                      key={conversation.id}
                      accessibilityLabel={`切换到对话 ${conversation.title}`}
                      accessibilityRole="button"
                      onLongPress={() => handleConversationLongPress(conversation)}
                      onPress={() => selectConversation(conversation)}
                      style={[
                        styles.conversationListItem,
                        isActiveConversation && styles.conversationListItemActive,
                      ]}>
                      <ThemedText
                        numberOfLines={2}
                        style={[
                          styles.conversationListTitle,
                          isActiveConversation && styles.conversationListTitleActive,
                        ]}>
                        {conversation.title}
                      </ThemedText>
                      <ThemedText numberOfLines={1} style={styles.conversationListTime}>
                        {formatConversationUpdatedAt(conversation.updatedAt)}
                      </ThemedText>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <ThemedText style={styles.conversationDrawerHint}>长按后可点击标题修改，也可删除或总结标题</ThemedText>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={activeConversationAction !== null}
        onRequestClose={closeConversationActions}>
        <View style={styles.conversationActionRoot}>
          <Pressable
            accessibilityLabel="关闭对话操作弹层"
            onPress={closeConversationActions}
            style={StyleSheet.absoluteFill}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.conversationActionKeyboardAvoider}>
            <View style={styles.conversationActionSheet}>
              {/*
               * 渲染位置: 历史对话长按后的操作弹层顶部
               * 展示内容: 当前会话标题，非编辑态可点击进入重命名，编辑态展示标题输入框
               * 数据来源: activeConversationAction 与 conversationTitleDraft 状态
               */}
              {isConversationTitleEditing ? (
                <>
                  <ThemedText style={styles.conversationActionLabel}>修改对话标题</ThemedText>
                  <TextInput
                    autoFocus
                    cursorColor="#111827"
                    keyboardAppearance="light"
                    onChangeText={(nextTitle) => {
                      // 格式化: 用户输入标题文本 → 按 Unicode 字符截断到 12 个以内 → 避免代理对字符被截断
                      // 说明: 标题编辑需要兼容 emoji 等字符，避免出现半个字符的异常展示
                      setConversationTitleDraft(
                        Array.from(nextTitle).slice(0, MAX_AI_CONVERSATION_TITLE_LENGTH).join('')
                      );
                    }}
                    onSubmitEditing={confirmConversationTitleEdit}
                    placeholder="输入对话标题"
                    placeholderTextColor="#94A3B8"
                    returnKeyType="done"
                    selectionColor="#111827"
                    style={styles.conversationActionInput}
                    value={conversationTitleDraft}
                  />
                  <ThemedText style={styles.conversationActionHint}>
                    {`${Array.from(conversationTitleDraft).length}/${MAX_AI_CONVERSATION_TITLE_LENGTH}，留空会恢复默认标题`}
                  </ThemedText>
                </>
              ) : (
                <>
                  <Pressable
                    accessibilityLabel={`修改对话标题 ${activeConversationAction?.title ?? DEFAULT_AI_CONVERSATION_TITLE}`}
                    accessibilityRole="button"
                    onPress={() => {
                      if (!activeConversationAction) {
                        return;
                      }

                      setConversationTitleDraft(activeConversationAction.title);
                      setIsConversationTitleEditing(true);
                    }}
                    style={styles.conversationActionTitleButton}>
                    <ThemedText style={styles.conversationActionTitle}>
                      {activeConversationAction?.title ?? DEFAULT_AI_CONVERSATION_TITLE}
                    </ThemedText>
                    <ThemedText style={styles.conversationActionTitleHint}>点击标题可修改</ThemedText>
                  </Pressable>
                  <ThemedText style={styles.conversationActionSubtitle}>选择对话操作</ThemedText>
                </>
              )}
              <View style={styles.conversationActionButtonRow}>
                {isConversationTitleEditing ? (
                  <>
                    <Pressable
                      accessibilityLabel="保存对话标题"
                      accessibilityRole="button"
                      onPress={confirmConversationTitleEdit}
                      style={styles.conversationActionButton}>
                      <ThemedText style={styles.conversationActionButtonText}>保存</ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="取消修改对话标题"
                      accessibilityRole="button"
                      onPress={closeConversationActions}
                      style={styles.conversationActionButton}>
                      <ThemedText style={styles.conversationActionButtonText}>取消</ThemedText>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      accessibilityLabel="总结当前对话标题"
                      accessibilityRole="button"
                      disabled={isTitleSummarizing}
                      onPress={() => {
                        if (!activeConversationAction) {
                          return;
                        }

                        closeConversationActions();
                        void summarizeConversationTitle(activeConversationAction.id);
                      }}
                      style={[
                        styles.conversationActionButton,
                        isTitleSummarizing && styles.conversationActionButtonDisabled,
                      ]}>
                      <ThemedText
                        style={[
                          styles.conversationActionButtonText,
                          isTitleSummarizing && styles.conversationActionButtonTextDisabled,
                        ]}>
                        {isTitleSummarizing ? '总结中' : '总结标题'}
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="删除当前对话"
                      accessibilityRole="button"
                      onPress={() => {
                        if (!activeConversationAction) {
                          return;
                        }

                        closeConversationActions();
                        deleteConversation(activeConversationAction.id);
                      }}
                      style={styles.conversationActionButton}>
                      <ThemedText
                        style={[
                          styles.conversationActionButtonText,
                          styles.conversationActionButtonTextDanger,
                        ]}>
                        删除
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="取消对话操作"
                      accessibilityRole="button"
                      onPress={closeConversationActions}
                      style={styles.conversationActionButton}>
                      <ThemedText style={styles.conversationActionButtonText}>取消</ThemedText>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
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

function formatKnowledgeSourceLabel(source: AiScreenKnowledgeSnapshot['source']) {
  if (source === 'user-edited') {
    return '手动编辑';
  }

  if (source === 'fallback') {
    return '基础读取';
  }

  return '自动读取';
}

function formatAttachmentTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatConversationUpdatedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function upsertAiConversationList(
  conversations: AiAssistantConversation[],
  conversation: AiAssistantConversation
) {
  const conversationMap = new Map(conversations.map((item) => [item.id, item]));
  const storedConversation = conversationMap.get(conversation.id);

  if (
    !storedConversation
    || new Date(conversation.updatedAt).getTime() >= new Date(storedConversation.updatedAt).getTime()
  ) {
    conversationMap.set(conversation.id, conversation);
  }

  return Array.from(conversationMap.values()).sort((currentConversation, nextConversation) => (
    new Date(nextConversation.updatedAt).getTime() - new Date(currentConversation.updatedAt).getTime()
  ));
}

function countUserMessages(messages: AiAssistantMessage[]) {
  return messages.filter((message) => message.role === 'user' && message.content.trim().length > 0).length;
}

/**
 * 将 AI 流阶段转换为用户可读的等待提示。
 *
 * @param status - 当前流式响应阶段
 * @returns AI 消息气泡中的状态文案
 * @example
 *   formatAiStreamStatus('searching') // => '正在联网搜索...'
 */
function formatAiStreamStatus(status: AiAssistantStreamStatus) {
  if (status === 'searching') {
    return '正在联网搜索...';
  }

  if (status === 'writing') {
    return '正在整理回答...';
  }

  return 'AI 正在思考...';
}

function waitForScreenSettled() {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      requestAnimationFrame(() => resolve());
    }, DRAWER_ANIMATION_MS + 80);
  });
}

type MarkdownFenceNode = ASTNode & {
  sourceInfo?: string;
};

const markdownRules: RenderRules = {
  fence: (node, _children, _parent, styles, inheritedStyles = {}) => {
    const language = String((node as MarkdownFenceNode).sourceInfo || '').trim().toLowerCase();
    // 格式化: Markdown fence 文本 → 去除解析器附加的末尾换行 → 可渲染代码或 Mermaid 源码
    // 说明: 避免普通代码块和图表底部多出空行
    const content = node.content.endsWith('\n')
      ? node.content.slice(0, -1)
      : node.content;

    if (language === 'mermaid') {
      /*
       * 渲染位置: AI Markdown 回复中的 mermaid 代码块
       * 展示内容: 流程图、时序图等可视化图表
       * 数据来源: Markdown AST 节点中的 Mermaid 源码
       */
      return <MermaidDiagram key={node.key} chart={content} />;
    }

    /*
     * 渲染位置: AI Markdown 回复中的普通围栏代码块
     * 展示内容: 保留原格式的代码文本
     * 数据来源: Markdown AST 节点内容
     */
    return (
      <ThemedText key={node.key} style={[inheritedStyles, styles.fence]}>
        {content}
      </ThemedText>
    );
  },
};

const markdownStyles = {
  body: {
    color: AppPalette.text,
    fontSize: 14,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  heading1: {
    color: AppPalette.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  heading2: {
    color: AppPalette.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  heading3: {
    color: AppPalette.text,
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
    color: AppPalette.text,
    marginBottom: 4,
  },
  strong: {
    color: AppPalette.text,
    fontWeight: '700',
  },
  em: {
    fontStyle: 'italic',
  },
  code_inline: {
    color: AppPalette.brandLight,
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
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
    borderLeftColor: AppPalette.brandLight,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  link: {
    color: AppPalette.brandLight,
  },
} as const;

const styles = StyleSheet.create({
  // [变更] 修改前: AI 抽屉采用纯白背景、亮蓝控件与浅灰气泡
  // [变更] 修改后: 使用深色玻璃抽屉、靛青紫控件与渐变感消息层级
  // [原因] AI 是推广页核心卖点，需要与品牌视觉保持最高一致性
  floatingButton: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: AppPalette.brand,
    shadowColor: AppPalette.brandLight,
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
    backgroundColor: 'rgba(2, 2, 8, 0.66)',
  },
  keyboardAvoider: {
    flex: 1,
    alignItems: 'flex-start',
  },
  drawer: {
    height: '100%',
    borderRightWidth: 1,
    borderRightColor: AppPalette.border,
    backgroundColor: AppPalette.surface,
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
    backgroundColor: AppPalette.surfaceSoft,
  },
  conversationTitleBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
  },
  conversationTitle: {
    flexShrink: 1,
    color: AppPalette.text,
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
    color: AppPalette.text,
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
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    paddingHorizontal: 10,
  },
  modelText: {
    color: AppPalette.text,
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
  conversationDrawerRoot: {
    flex: 1,
  },
  conversationDrawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 2, 8, 0.62)',
  },
  conversationDrawer: {
    height: '100%',
    borderRightWidth: 1,
    borderRightColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceElevated,
    paddingLeft: 8,
    paddingRight: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 18,
  },
  // [变更] 修改前: 历史抽屉整体收紧后，左侧阅读留白偏少
  // [变更] 修改后: 保持纵向紧凑，仅把抽屉和卡片的左内边距回调一些
  // [原因] 让标题和时间的起始线更稳定，避免内容过于贴左
  conversationDrawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  conversationDrawerTitle: {
    color: AppPalette.text,
    fontSize: 15,
    fontWeight: '800',
  },
  conversationSyncText: {
    marginBottom: 6,
    color: '#D97706',
    fontSize: 11,
    lineHeight: 15,
  },
  conversationListContent: {
    gap: 6,
    paddingBottom: 8,
  },
  conversationListItem: {
    minHeight: 54,
    borderRadius: 10,
    backgroundColor: AppPalette.surfaceSoft,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 6,
  },
  conversationListItemActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
  },
  conversationListTitle: {
    color: AppPalette.textMuted,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  conversationListTitleActive: {
    color: AppPalette.brandLight,
  },
  conversationListTime: {
    marginTop: 2,
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 15,
  },
  conversationDrawerHint: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 15,
  },
  conversationActionRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(2, 2, 8, 0.74)',
  },
  conversationActionKeyboardAvoider: {
    width: '100%',
  },
  conversationActionSheet: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceElevated,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
  },
  conversationActionTitleButton: {
    paddingBottom: 12,
  },
  conversationActionTitle: {
    color: AppPalette.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
  },
  conversationActionTitleHint: {
    marginTop: 4,
    color: '#0F9D8A',
    fontSize: 12,
    lineHeight: 16,
  },
  conversationActionSubtitle: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  conversationActionLabel: {
    marginBottom: 10,
    color: AppPalette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  conversationActionInput: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    backgroundColor: AppPalette.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: AppPalette.text,
    fontSize: 16,
    lineHeight: 22,
  },
  conversationActionHint: {
    marginTop: 8,
    marginBottom: 20,
    color: AppPalette.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  conversationActionButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 18,
  },
  conversationActionButton: {
    minWidth: 64,
    alignItems: 'center',
    paddingVertical: 8,
  },
  conversationActionButtonDisabled: {
    opacity: 0.5,
  },
  conversationActionButtonText: {
    color: '#0F9D8A',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  conversationActionButtonTextDanger: {
    color: '#DC2626',
  },
  conversationActionButtonTextDisabled: {
    color: '#94A3B8',
  },
  knowledgeSection: {
    marginLeft: 13,
    marginBottom: 12,
    zIndex: 10,
    elevation: 10,
  },
  knowledgeToggle: {
    width: 283,
    height: 37,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.16)',
  },
  knowledgeExpandButton: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
  },
  knowledgeTitle: {
    marginLeft: 13,
    color: AppPalette.brandLight,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 37,
    flexShrink: 1,
  },
  knowledgeIncludePressable: {
    width: 34,
    height: 34,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knowledgeIncludeButton: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knowledgeIncludeIconLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knowledgeCaretButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knowledgeCaret: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // [变更] 修改前: 知识库面板相对 knowledgeSection 做局部绝对定位，超出父容器部分在 Android 上触摸不稳定
  // [变更] 修改后: 面板改为相对抽屉根节点的绝对定位浮层，覆盖消息区但不改变主布局
  // [原因] 保留覆盖式展示效果的同时，让面板完整区域都能接收到滚动手势
  knowledgePanelShell: {
    position: 'absolute',
    zIndex: 20,
    elevation: 20,
    width: 283,
    overflow: 'hidden',
  },
  knowledgePanel: {
    width: 283,
    height: KNOWLEDGE_PANEL_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    backgroundColor: AppPalette.surfaceElevated,
    padding: 10,
  },
  // [变更] 修改前: 知识库面板里的 ScrollView 没有占满固定高度容器，内容过长时无法稳定下滑
  // [变更] 修改后: 为 ScrollView 补齐 flex 高度约束，并给内容区保留少量底部留白
  // [原因] 让“当前屏幕知识库”在摘要较长时可以正常纵向滚动查看
  knowledgeScroll: {
    flex: 1,
  },
  knowledgeScrollContent: {
    paddingBottom: 6,
  },
  knowledgeText: {
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  knowledgeMeta: {
    marginBottom: 6,
    color: AppPalette.textSubtle,
    fontSize: 11,
    lineHeight: 16,
  },
  knowledgeEditor: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    backgroundColor: AppPalette.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: AppPalette.text,
    fontSize: 13,
    lineHeight: 19,
  },
  knowledgeActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  knowledgeActionButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: AppPalette.brand,
  },
  knowledgeActionButtonSecondary: {
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
  },
  knowledgeActionButtonDisabled: {
    opacity: 0.56,
  },
  knowledgeActionButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  knowledgeActionButtonTextSecondary: {
    color: AppPalette.brandLight,
  },
  captureButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: AppPalette.brand,
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
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
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
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderColor: AppPalette.borderStrong,
    backgroundColor: AppPalette.brand,
  },
  systemBubble: {
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    backgroundColor: 'rgba(99, 102, 241, 0.14)',
  },
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: AppPalette.textMuted,
    fontSize: 13,
  },
  streamingState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  messageText: {
    color: AppPalette.text,
    fontSize: 14,
    lineHeight: 20,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  systemMessageText: {
    color: AppPalette.brandLight,
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
    borderRadius: 8,
  },
  toolButtonActive: {
    backgroundColor: AppPalette.brand,
  },
  toolButtonUnavailable: {
    opacity: 0.4,
  },
  composer: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  input: {
    minHeight: 28,
    maxHeight: 96,
    color: AppPalette.text,
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
    backgroundColor: AppPalette.brand,
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
    backgroundColor: 'rgba(2, 2, 8, 0.74)',
  },
  modelSheet: {
    maxHeight: '62%',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceElevated,
    padding: 16,
  },
  modelSheetTitle: {
    color: AppPalette.text,
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
    backgroundColor: AppPalette.brand,
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
    color: AppPalette.textMuted,
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
    borderBottomColor: AppPalette.border,
    gap: 10,
  },
  modelOptionText: {
    flex: 1,
    color: AppPalette.text,
    fontSize: 14,
  },
});
