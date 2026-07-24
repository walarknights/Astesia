import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
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

import { AstesiaLogo } from '@/components/AstesiaLogo';
import { ThemedText } from '@/components/themed-text';
import { getPersonalSurfacePalette, type PersonalSurfacePalette } from '@/constants/personal-theme';
import { PRIVACY_POLICY_CONTENT, PRIVACY_POLICY_TITLE } from '@/constants/privacy-policy';
import { AppPalette, Fonts } from '@/constants/theme';
import { useAppColorScheme } from '@/services/app-settings';
import {
  getAiQuotaSummary,
  loadAuthSession,
  loginWithEmailPassword,
  registerWithEmailCode,
  requestRegisterCode,
  type AiQuotaSummary,
  type AuthSession,
} from '@/services/auth-session';
import { DEFAULT_APP_CONTENT_BLOCKS, loadAppContentBlocks } from '@/services/app-content';

type AuthMode = 'login' | 'register';
type VerificationCooldownState = {
  email: string;
  remainingSeconds: number;
};

const SETTINGS_ICON = require('@/assets/figma-icons/personal-user-panel/settings.png');
const ARROW_ICON = require('@/assets/figma-icons/personal-user-panel/arrow-rise.png');

export function PersonalUserPanel() {
  const router = useRouter();
  const colorScheme = useAppColorScheme();
  const panelTheme = getPersonalSurfacePalette(colorScheme);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [quotaSummary, setQuotaSummary] = useState<AiQuotaSummary | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isQuotaLoading, setIsQuotaLoading] = useState(false);
  const [isAuthModalVisible, setIsAuthModalVisible] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authVerificationCode, setAuthVerificationCode] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [hasAcceptedPrivacyPolicy, setHasAcceptedPrivacyPolicy] = useState(false);
  const [isPrivacyPolicyVisible, setIsPrivacyPolicyVisible] = useState(false);
  const [privacyPolicyTitle, setPrivacyPolicyTitle] = useState(PRIVACY_POLICY_TITLE);
  const [privacyPolicyContent, setPrivacyPolicyContent] = useState(PRIVACY_POLICY_CONTENT);
  const [verificationCooldown, setVerificationCooldown] = useState<VerificationCooldownState | null>(null);

  useEffect(() => {
    let active = true;

    const syncUserPanel = async () => {
      try {
        const currentSession = await loadAuthSession();

        if (!active) {
          return;
        }

        setSession(currentSession);

        if (!currentSession) {
          setQuotaSummary(null);
          return;
        }

        setIsQuotaLoading(true);

        try {
          const summary = await getAiQuotaSummary();

          if (active) {
            setQuotaSummary(summary);
          }
        } catch {
          if (active) {
            setQuotaSummary(null);
          }
        } finally {
          if (active) {
            setIsQuotaLoading(false);
          }
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    };

    void syncUserPanel();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const syncPrivacyPolicy = async () => {
      const contentBlocks = await loadAppContentBlocks();
      const privacyBlock = contentBlocks.privacy ?? DEFAULT_APP_CONTENT_BLOCKS.privacy;

      if (!active) {
        return;
      }

      setPrivacyPolicyTitle(privacyBlock.title || PRIVACY_POLICY_TITLE);
      setPrivacyPolicyContent(privacyBlock.content || PRIVACY_POLICY_CONTENT);
    };

    void syncPrivacyPolicy();

    return () => {
      active = false;
    };
  }, []);

  // [变更] 修改前: 获取验证码按钮只在请求进行中短暂禁用，请求结束后会立即恢复可点击
  // [变更] 修改后: 为当前邮箱维护剩余倒计时，并按秒递减到 0 后自动解除禁用
  // [原因] 降低重复点击造成的无效发码请求，同时让用户在前端直接看到节流状态
  useEffect(() => {
    if (!verificationCooldown || verificationCooldown.remainingSeconds <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      setVerificationCooldown((currentValue) => {
        if (!currentValue) {
          return null;
        }

        if (currentValue.remainingSeconds <= 1) {
          return null;
        }

        return {
          ...currentValue,
          remainingSeconds: currentValue.remainingSeconds - 1,
        };
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [verificationCooldown]);

  const sessionUser = session?.user ?? null;

  const avatarFallbackText = useMemo(() => {
    const userName = sessionUser?.name?.trim();

    if (userName) {
      return Array.from(userName)[0] ?? 'A';
    }

    return 'A';
  }, [sessionUser?.name]);

  const subtitleText = useMemo(() => {
    if (!sessionUser) {
      return '';
    }

    if (sessionUser.signature && sessionUser.signature !== '欢迎来到 Astesia') {
      return sessionUser.signature;
    }

    return sessionUser.email;
  }, [sessionUser]);

  // [变更] 修改前: 倒计时状态与当前输入邮箱无关，若用户输错邮箱后改正，前端无法细粒度放行
  // [变更] 修改后: 将按钮禁用态与“当前输入邮箱 + 剩余秒数”绑定，仅命中同一邮箱时才展示节流
  // [原因] 既拦住同邮箱重复发码，也不影响用户修正邮箱后重新获取验证码
  const normalizedAuthEmail = authEmail.trim().toLowerCase();
  const verificationCooldownSeconds = verificationCooldown?.email === normalizedAuthEmail
    ? verificationCooldown.remainingSeconds
    : 0;
  const isVerificationCoolingDown = verificationCooldownSeconds > 0;
  const isVerificationButtonDisabled = isSendingCode || isVerificationCoolingDown;
  const verificationButtonText = isSendingCode
    ? '发送中'
    : isVerificationCoolingDown
      ? `${verificationCooldownSeconds}s后重试`
      : '获取验证码';

  // 格式化: quotaSummary/null + loading 状态 → 可直接展示的计划与额度文案 → 用户中心指标区展示文本
  // 说明: 未登录时不展示指标，已登录时透出计划与剩余额度
  const planLabel = `所属计划: ${sessionUser?.planName ?? '--'}`;
  const quotaLabel = `AI 剩余额度: ${getQuotaText(quotaSummary, isQuotaLoading)}`;
  const cardSurfaceStyle = {
    borderColor: panelTheme.cardBorder,
    backgroundColor: panelTheme.cardBackground,
    shadowColor: panelTheme.shadowColor,
    shadowOpacity: panelTheme.cardShadowOpacity,
  };
  const modalSurfaceStyle = {
    borderColor: panelTheme.cardBorder,
    backgroundColor: panelTheme.modalBackground,
  };
  const inputSurfaceStyle = {
    borderColor: panelTheme.inputBorder,
    color: panelTheme.text,
    backgroundColor: panelTheme.inputBackground,
  };

  // [变更] 修改前: 登录 / 注册切换时仅重置验证码与密码，注册新增字段会残留在弹层里
  // [变更] 修改后: 统一在模式切换时重置验证码、密码、确认密码和显隐状态，登录态顺手清空注册用户名
  // [原因] 避免在登录与注册之间来回切换时带出旧表单数据
  const switchAuthMode = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthVerificationCode('');
    setAuthPassword('');
    setAuthConfirmPassword('');
    setIsPasswordVisible(false);
    setIsConfirmPasswordVisible(false);

    if (mode === 'login') {
      setAuthDisplayName('');
    }
  };

  const openAuthModal = (mode: AuthMode) => {
    switchAuthMode(mode);
    setHasAcceptedPrivacyPolicy(false);
    setIsAuthModalVisible(true);
  };

  const closeAuthModal = () => {
    if (isSubmitting || isSendingCode) {
      return;
    }

    setIsAuthModalVisible(false);
  };

  const closePrivacyPolicy = () => {
    setIsPrivacyPolicyVisible(false);
  };

  const refreshSessionState = useCallback(async () => {
    const currentSession = await loadAuthSession();
    setSession(currentSession);

    if (!currentSession) {
      setQuotaSummary(null);
      return;
    }

    setIsQuotaLoading(true);

    try {
      setQuotaSummary(await getAiQuotaSummary());
    } catch {
      setQuotaSummary(null);
    } finally {
      setIsQuotaLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshSessionState();
    }, [refreshSessionState])
  );

  const handleSendVerificationCode = async () => {
    if (!normalizedAuthEmail) {
      Alert.alert('邮箱不能为空', '请先输入邮箱地址。');
      return;
    }

    if (!hasAcceptedPrivacyPolicy) {
      Alert.alert('请先同意隐私政策', '阅读并同意隐私政策后才能获取注册验证码。');
      return;
    }

    if (isVerificationCoolingDown) {
      Alert.alert('请稍后再试', `验证码已发送，请在 ${verificationCooldownSeconds} 秒后重试。`);
      return;
    }

    setIsSendingCode(true);

    try {
      const result = await requestRegisterCode(normalizedAuthEmail);
      setVerificationCooldown({
        email: normalizedAuthEmail,
        remainingSeconds: result.cooldownSeconds,
      });

      Alert.alert(
        '验证码已发送',
        result.verificationCode
          ? `当前环境未接入真实邮件发送，开发验证码为：${result.verificationCode}`
          : result.message
      );
    } catch (error) {
      const retryAfterSeconds = getRetryAfterSeconds(error);

      if (retryAfterSeconds > 0) {
        setVerificationCooldown({
          email: normalizedAuthEmail,
          remainingSeconds: retryAfterSeconds,
        });
      }

      Alert.alert(retryAfterSeconds > 0 ? '请稍后再试' : '发送失败', getErrorMessage(error));
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleSubmitAuth = async () => {
    const normalizedDisplayName = authDisplayName.trim();
    const normalizedEmail = authEmail.trim();
    const normalizedPassword = authPassword.trim();
    const normalizedConfirmPassword = authConfirmPassword.trim();

    if (!normalizedEmail) {
      Alert.alert('邮箱不能为空', '请输入邮箱地址。');
      return;
    }

    if (!hasAcceptedPrivacyPolicy) {
      Alert.alert('请先同意隐私政策', '阅读并同意隐私政策后才能继续登录或注册。');
      return;
    }

    if (authMode === 'register' && !normalizedDisplayName) {
      Alert.alert('用户名不能为空', '请输入注册用户名。');
      return;
    }

    if (!normalizedPassword) {
      Alert.alert('密码不能为空', '请输入密码。');
      return;
    }

    if (authMode === 'register' && !authVerificationCode.trim()) {
      Alert.alert('验证码不能为空', '请输入注册验证码。');
      return;
    }

    if (authMode === 'register' && !normalizedConfirmPassword) {
      Alert.alert('确认密码不能为空', '请再次输入登录密码。');
      return;
    }

    if (authMode === 'register' && normalizedPassword !== normalizedConfirmPassword) {
      Alert.alert('两次密码不一致', '请确认两次输入的密码完全一致。');
      return;
    }

    setIsSubmitting(true);

    try {
      if (authMode === 'register') {
        await registerWithEmailCode(
          normalizedEmail,
          authVerificationCode.trim(),
          normalizedPassword,
          normalizedDisplayName
        );
      } else {
        await loginWithEmailPassword(normalizedEmail, normalizedPassword);
      }

      setIsAuthModalVisible(false);
      setVerificationCooldown(null);
      await refreshSessionState();
      Alert.alert(authMode === 'register' ? '注册成功' : '登录成功', '用户信息已经同步到当前设备。');
    } catch (error) {
      Alert.alert(authMode === 'register' ? '注册失败' : '登录失败', getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManageAccount = () => {
    if (!sessionUser) {
      openAuthModal('login');
      return;
    }

    router.push('/account-management');
  };

  // [变更] 修改前: 用户面板文件被撤销，个人页顶部缺少登录入口和用户信息展示
  // [变更] 修改后: 恢复用户面板组件，并补齐未登录品牌卡片、已登录信息卡片和邮箱登录弹层
  // [原因] 保持个人页顶部的用户中心闭环，并对齐最新未登录态设计
  return (
    <>
      {sessionUser ? (
        <>
          {/*
           * 渲染位置: 个人页顶部核心信息区
           * 展示内容: 已登录用户的头像、昵称、所属计划、AI 剩余额度和账号管理入口
           * 数据来源: auth-session 中的本地会话与 AI 额度摘要接口
           */}
          <View style={[styles.card, cardSurfaceStyle]}>
            <View style={styles.headerRow}>
              {sessionUser.avatarUrl ? (
                <Image
                  source={{ uri: sessionUser.avatarUrl }}
                  contentFit="cover"
                  style={[styles.avatarImage, { backgroundColor: panelTheme.avatarBackground }]}
                />
              ) : (
                <View style={[styles.avatarFallback, { backgroundColor: panelTheme.avatarBackground }]}>
                  <ThemedText style={[styles.avatarFallbackText, { color: panelTheme.brandLight }]}>
                    {avatarFallbackText}
                  </ThemedText>
                </View>
              )}
              <View style={styles.headerTextGroup}>
                <ThemedText numberOfLines={1} style={[styles.userNameText, { color: panelTheme.text }]}>
                  {sessionUser.name}
                </ThemedText>
                <ThemedText numberOfLines={1} style={[styles.userSubtitleText, { color: panelTheme.textMuted }]}>
                  {subtitleText}
                </ThemedText>
              </View>
            </View>

            {/*
             * 渲染位置: 用户信息卡中部指标区
             * 展示内容: 当前账号所属计划与 AI 剩余额度
             * 数据来源: sessionUser.planName 与 quotaSummary
             */}
            <View style={styles.metricsRow}>
              <ThemedText numberOfLines={1} style={[styles.metricText, { color: panelTheme.textMuted }]}>
                {planLabel}
              </ThemedText>
              <View style={styles.quotaMetric}>
                {isQuotaLoading ? <ActivityIndicator size="small" color={panelTheme.text} /> : null}
                <ThemedText numberOfLines={1} style={[styles.metricText, { color: panelTheme.textMuted }]}>
                  {quotaLabel}
                </ThemedText>
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: panelTheme.divider }]} />

            {/*
             * 渲染位置: 用户信息卡底部操作区
             * 展示内容: 个人账号管理入口，点击后进入资料编辑与退出登录页面
             * 数据来源: sessionUser 登录状态与 expo-router 路由
             */}
            <Pressable accessibilityRole="button" style={styles.footerRow} onPress={handleManageAccount}>
              <View style={styles.footerLeft}>
                <Image
                  source={SETTINGS_ICON}
                  contentFit="contain"
                  style={[styles.footerSettingsIcon, { tintColor: panelTheme.icon }]}
                />
                <ThemedText style={[styles.footerText, { color: panelTheme.textMuted }]}>个人账号管理</ThemedText>
              </View>
              <Image
                source={ARROW_ICON}
                contentFit="contain"
                style={[styles.footerArrowIcon, { tintColor: panelTheme.icon }]}
              />
            </Pressable>
          </View>
        </>
      ) : (
        <>
          {/*
           * 渲染位置: 个人页顶部未登录入口卡片
           * 展示内容: Astesia 图标、“登录Astesia”标题和灰色斜体副标题，点击整卡打开登录弹层
           * 数据来源: 本地 session 为空时的未登录状态
           */}
          <Pressable
            accessibilityRole="button"
            disabled={isBootstrapping}
            style={[
              styles.card,
              cardSurfaceStyle,
              styles.loggedOutCard,
              isBootstrapping ? styles.buttonDisabled : null,
            ]}
            onPress={() => openAuthModal('login')}>
            <View style={styles.loggedOutContent}>
              <View style={styles.loggedOutLogoWrap}>
                <AstesiaLogo size={72} />
              </View>
              <View style={styles.loggedOutTextGroup}>
                <ThemedText
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={[styles.loggedOutTitle, { color: panelTheme.text }]}>
                  登录Astesia
                </ThemedText>
                <ThemedText
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={[styles.loggedOutSubtitle, { color: panelTheme.textMuted }]}>
                  开启自己的本地生活管理
                </ThemedText>
              </View>
            </View>
          </Pressable>
        </>
      )}

      <Modal
        animationType="slide"
        transparent
        visible={isAuthModalVisible}
        onRequestClose={closeAuthModal}>
        <KeyboardAvoidingView
          // [变更] 修改前: 登录注册底部弹层没有参与键盘布局，邮箱和密码字段可能被直接覆盖
          // [变更] 修改后: 原生端按键盘高度缩短弹层，并允许较长的注册表单纵向滚动
          // [原因] 小屏设备在注册模式下无法同时容纳完整表单与软键盘
          behavior={Platform.select({ android: 'height', ios: 'padding' })}
          style={[styles.modalBackdrop, { backgroundColor: panelTheme.modalBackdrop }]}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.authModalScrollContent}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.authModalScroll}>
            <View style={[styles.modalCard, modalSurfaceStyle]}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={[styles.modalTitle, { color: panelTheme.text }]}>
                {authMode === 'register' ? '邮箱注册' : '邮箱登录'}
              </ThemedText>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={closeAuthModal}>
                <MaterialIcons name="close" size={24} color={panelTheme.icon} />
              </Pressable>
            </View>

            <View style={styles.modeSwitchRow}>
              <AuthModeButton
                active={authMode === 'login'}
                label="登录"
                theme={panelTheme}
                onPress={() => switchAuthMode('login')}
              />
              <AuthModeButton
                active={authMode === 'register'}
                label="注册"
                theme={panelTheme}
                onPress={() => switchAuthMode('register')}
              />
            </View>

            {/*
             * 渲染位置: 用户身份弹层表单区域
             * 展示内容: 用户名、邮箱、验证码、密码、确认密码输入，以及发送验证码与提交操作
             * 数据来源: authDisplayName、authEmail、authVerificationCode、authPassword、authConfirmPassword 本地表单状态
             */}
            <View style={styles.formGroup}>
              {authMode === 'register' ? (
                <TextInput
                  maxLength={24}
                  placeholder="请输入用户名"
                  placeholderTextColor={panelTheme.placeholder}
                  style={[styles.input, inputSurfaceStyle]}
                  value={authDisplayName}
                  onChangeText={setAuthDisplayName}
                />
              ) : null}

              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="请输入邮箱"
                placeholderTextColor={panelTheme.placeholder}
                style={[styles.input, inputSurfaceStyle]}
                value={authEmail}
                onChangeText={setAuthEmail}
              />

              {authMode === 'register' ? (
                <View style={styles.verificationRow}>
                  {/*
                   * 渲染位置: 注册弹层的验证码输入区域
                   * 展示内容: 验证码输入框与获取验证码按钮，按钮会展示发送中或剩余倒计时
                   * 数据来源: authVerificationCode、isSendingCode、verificationCooldown 本地状态
                   */}
                  <TextInput
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder="请输入验证码"
                    placeholderTextColor={panelTheme.placeholder}
                    style={[styles.input, inputSurfaceStyle, styles.verificationInput]}
                    value={authVerificationCode}
                    onChangeText={setAuthVerificationCode}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={isVerificationButtonDisabled}
                    style={[styles.verificationButton, isVerificationButtonDisabled ? styles.buttonDisabled : null]}
                    onPress={() => void handleSendVerificationCode()}>
                    <ThemedText style={styles.verificationButtonText}>
                      {verificationButtonText}
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}

              <PasswordInputField
                isVisible={isPasswordVisible}
                placeholder={authMode === 'register' ? '请设置登录密码' : '请输入登录密码'}
                theme={panelTheme}
                value={authPassword}
                onChangeText={setAuthPassword}
                onToggleVisibility={() => setIsPasswordVisible((currentValue) => !currentValue)}
              />

              {authMode === 'register' ? (
                <PasswordInputField
                  isVisible={isConfirmPasswordVisible}
                  placeholder="请再次输入登录密码"
                  theme={panelTheme}
                  value={authConfirmPassword}
                  onChangeText={setAuthConfirmPassword}
                  onToggleVisibility={() => setIsConfirmPasswordVisible((currentValue) => !currentValue)}
                />
              ) : null}
            </View>

            <ThemedText style={[styles.formHelpText, { color: panelTheme.textMuted }]}>
              {authMode === 'register'
                ? '注册使用用户名 + 邮箱 + 验证码，完成后后续使用邮箱 + 密码登录。'
                : '登录成功后会展示用户头像、所属计划和当前 AI 剩余额度。'}
            </ThemedText>

            {/*
             * 渲染位置: 登录 / 注册弹层提交按钮上方
             * 展示内容: 隐私政策同意勾选与查看政策入口
             * 数据来源: hasAcceptedPrivacyPolicy 本地状态与 /api/app/content 隐私政策内容
             */}
            <View style={styles.privacyAgreementRow}>
              <Pressable
                accessibilityLabel="同意隐私政策"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hasAcceptedPrivacyPolicy }}
                hitSlop={8}
                style={[
                  styles.privacyCheckbox,
                  {
                    borderColor: panelTheme.inputBorder,
                    backgroundColor: panelTheme.inputBackground,
                  },
                  hasAcceptedPrivacyPolicy
                    ? {
                        borderColor: panelTheme.brand,
                        backgroundColor: panelTheme.brand,
                      }
                    : null,
                ]}
                onPress={() => setHasAcceptedPrivacyPolicy((currentValue) => !currentValue)}>
                {hasAcceptedPrivacyPolicy ? <MaterialIcons name="check" size={15} color="#FFFFFF" /> : null}
              </Pressable>
              <ThemedText style={[styles.privacyAgreementText, { color: panelTheme.textMuted }]}>
                我已阅读并同意
                <ThemedText
                  accessibilityRole="button"
                  style={[styles.privacyLinkText, { color: panelTheme.brandLight }]}
                  onPress={() => setIsPrivacyPolicyVisible(true)}>
                  《隐私政策》
                </ThemedText>
              </ThemedText>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || isBootstrapping}
              style={[
                styles.submitButton,
                { backgroundColor: panelTheme.brand },
                (isSubmitting || isBootstrapping || !hasAcceptedPrivacyPolicy) ? styles.buttonDisabled : null,
              ]}
              onPress={() => void handleSubmitAuth()}>
              <ThemedText style={styles.submitButtonText}>
                {isSubmitting ? '提交中...' : authMode === 'register' ? '确认注册' : '确认登录'}
              </ThemedText>
            </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={isPrivacyPolicyVisible}
        onRequestClose={closePrivacyPolicy}>
        <View style={[styles.modalBackdrop, { backgroundColor: panelTheme.modalBackdrop }]}>
          <View style={[styles.modalCard, modalSurfaceStyle, styles.privacyPolicyCard]}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={[styles.modalTitle, { color: panelTheme.text }]}>
                {privacyPolicyTitle}
              </ThemedText>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={closePrivacyPolicy}>
                <MaterialIcons name="close" size={24} color={panelTheme.icon} />
              </Pressable>
            </View>
            {/*
             * 渲染位置: 隐私政策弹层正文区域
             * 展示内容: 完整隐私政策纯文本，支持滚动查看
             * 数据来源: /api/app/content 响应，接口失败时回退 constants/privacy-policy.ts
             */}
            <ScrollView style={styles.privacyPolicyScroll} contentContainerStyle={styles.privacyPolicyContent}>
              <ThemedText style={[styles.privacyPolicyText, { color: panelTheme.textMuted }]}>
                {privacyPolicyContent}
              </ThemedText>
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              style={[styles.submitButton, { backgroundColor: panelTheme.brand }]}
              onPress={closePrivacyPolicy}>
              <ThemedText style={styles.submitButtonText}>我知道了</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function AuthModeButton({
  active,
  label,
  theme,
  onPress,
}: {
  active: boolean;
  label: string;
  theme: PersonalSurfacePalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[
        styles.modeSwitchButton,
        { backgroundColor: theme.softButtonBackground },
        active ? { backgroundColor: theme.brand } : null,
      ]}
      onPress={onPress}>
      <ThemedText
        style={[
          styles.modeSwitchButtonText,
          { color: theme.textMuted },
          active ? styles.modeSwitchButtonTextActive : null,
        ]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function PasswordInputField({
  isVisible,
  placeholder,
  theme,
  value,
  onChangeText,
  onToggleVisibility,
}: {
  isVisible: boolean;
  placeholder: string;
  theme: PersonalSurfacePalette;
  value: string;
  onChangeText: (value: string) => void;
  onToggleVisibility: () => void;
}) {
  return (
    <View
      style={[
        styles.passwordInputRow,
        {
          borderColor: theme.inputBorder,
          backgroundColor: theme.inputBackground,
        },
      ]}>
      {/*
       * 渲染位置: 登录 / 注册弹层的密码输入行
       * 展示内容: 密码输入框与显示 / 隐藏密码按钮
       * 数据来源: PasswordInputField 组件入参中的 value、placeholder、isVisible
       */}
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!isVisible}
        placeholder={placeholder}
        placeholderTextColor={theme.placeholder}
        style={[styles.passwordTextInput, { color: theme.text }]}
        value={value}
        onChangeText={onChangeText}
      />
      <Pressable
        accessibilityLabel={isVisible ? '隐藏密码' : '显示密码'}
        accessibilityRole="button"
        hitSlop={8}
        style={styles.passwordVisibilityButton}
        onPress={onToggleVisibility}>
        <MaterialIcons name={isVisible ? 'visibility-off' : 'visibility'} size={20} color={theme.icon} />
      </Pressable>
    </View>
  );
}

/**
 * 将额度摘要和加载状态整理为卡片可直接展示的额度文案
 *
 * @param quotaSummary - 当前用户的额度摘要
 * @param isQuotaLoading - 是否正在读取额度
 * @returns 卡片上展示的额度文本
 * @example
 *   getQuotaText(null, true) // => '读取中...'
 */
function getQuotaText(quotaSummary: AiQuotaSummary | null, isQuotaLoading: boolean) {
  if (isQuotaLoading) {
    return '读取中...';
  }

  if (!quotaSummary) {
    return '--';
  }

  return `$${quotaSummary.remainingBalanceUsd}`;
}

/**
 * 从接口异常中提取验证码节流剩余秒数，供按钮倒计时与错误提示复用
 *
 * @param error - requestRegisterCode 抛出的异常对象
 * @returns 服务端返回的剩余等待秒数；没有则返回 0
 * @example
 *   getRetryAfterSeconds(Object.assign(new Error('too many requests'), { retryAfterSeconds: 32 })) // => 32
 */
function getRetryAfterSeconds(error: unknown) {
  const retryAfterSeconds = Number((error as { retryAfterSeconds?: unknown })?.retryAfterSeconds);

  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? Math.ceil(retryAfterSeconds)
    : 0;
}

/**
 * 统一提取接口或运行时异常的可展示文案
 *
 * @param error - 捕获到的异常对象
 * @returns 适合直接展示给用户的错误文案
 * @example
 *   getErrorMessage(new Error('登录失败')) // => '登录失败'
 */
function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    if (isNetworkRequestMessage(error.message)) {
      return '当前无法连接认证服务，请确认网络连接或稍后重试。';
    }

    return error.message;
  }

  return '服务暂时不可用，请稍后重试。';
}

function isNetworkRequestMessage(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  return normalizedValue.includes('network request failed')
    || normalizedValue.includes('failed to fetch')
    || normalizedValue.includes('fetch failed')
    || normalizedValue.includes('load failed');
}

const styles = StyleSheet.create({
  // [变更] 修改前: 用户信息与登录弹层采用高对比纯白卡片
  // [变更] 修改后: 统一为深色玻璃表面、浅色文本与靛青主按钮
  // [原因] 登录模块需要与个人页及推广页保持同一套视觉层级
  card: {
    height: 164,
    borderRadius: 25,
    borderCurve: 'continuous',
    paddingTop: 17,
    paddingRight: 16,
    paddingBottom: 12,
    paddingLeft: 16,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  loggedOutCard: {
    justifyContent: 'center',
  },
  loggedOutContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 20,
  },
  loggedOutLogoWrap: {
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loggedOutTextGroup: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  loggedOutTitle: {
    color: AppPalette.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '400',
    flexShrink: 1,
  },
  loggedOutSubtitle: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 18,
    fontStyle: 'italic',
    flexShrink: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 17,
  },
  avatarImage: {
    width: 47,
    height: 47,
    borderRadius: 999,
    backgroundColor: AppPalette.surfaceElevated,
  },
  avatarFallback: {
    width: 47,
    height: 47,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.surfaceElevated,
  },
  avatarFallbackText: {
    color: AppPalette.brandLight,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
  },
  headerTextGroup: {
    flex: 1,
    gap: 4,
  },
  userNameText: {
    color: AppPalette.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '400',
  },
  userSubtitleText: {
    color: AppPalette.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 15,
  },
  quotaMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '48%',
  },
  metricText: {
    flexShrink: 1,
    color: AppPalette.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    marginTop: 12,
    backgroundColor: AppPalette.border,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 'auto',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerSettingsIcon: {
    width: 17,
    height: 17,
  },
  footerArrowIcon: {
    width: 21.29,
    height: 27.22,
  },
  footerText: {
    color: AppPalette.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 2, 8, 0.74)',
  },
  authModalScroll: {
    flex: 1,
  },
  authModalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceElevated,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitle: {
    color: AppPalette.text,
  },
  modeSwitchRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeSwitchButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.surfaceSoft,
  },
  modeSwitchButtonActive: {
    backgroundColor: AppPalette.brand,
  },
  modeSwitchButtonText: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  modeSwitchButtonTextActive: {
    color: '#FFFFFF',
  },
  formGroup: {
    gap: 12,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    borderRadius: 16,
    paddingHorizontal: 14,
    color: AppPalette.text,
    backgroundColor: AppPalette.surface,
    fontSize: 14,
    lineHeight: 20,
  },
  passwordInputRow: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppPalette.surface,
  },
  passwordTextInput: {
    flex: 1,
    paddingVertical: 14,
    color: AppPalette.text,
    fontSize: 14,
    lineHeight: 20,
  },
  passwordVisibilityButton: {
    marginLeft: 8,
    padding: 4,
  },
  verificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  verificationInput: {
    flex: 1,
  },
  verificationButton: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.purple,
  },
  verificationButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  formHelpText: {
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  privacyAgreementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  privacyCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.surface,
  },
  privacyCheckboxChecked: {
    borderColor: AppPalette.brand,
    backgroundColor: AppPalette.brand,
  },
  privacyAgreementText: {
    flex: 1,
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  privacyLinkText: {
    color: AppPalette.brandLight,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  privacyPolicyCard: {
    maxHeight: '86%',
  },
  privacyPolicyScroll: {
    maxHeight: 520,
  },
  privacyPolicyContent: {
    paddingBottom: 8,
  },
  privacyPolicyText: {
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 22,
  },
  submitButton: {
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.brand,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '700',
    fontFamily: Fonts.sans,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
