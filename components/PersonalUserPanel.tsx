import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AstesiaLogo } from '@/components/AstesiaLogo';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import {
  clearAuthSession,
  getAiQuotaSummary,
  loadAuthSession,
  loginWithEmailPassword,
  registerWithEmailCode,
  requestRegisterCode,
  type AiQuotaSummary,
  type AuthSession,
} from '@/services/auth-session';

type AuthMode = 'login' | 'register';

const SETTINGS_ICON = require('@/assets/figma-icons/personal-user-panel/settings.png');
const ARROW_ICON = require('@/assets/figma-icons/personal-user-panel/arrow-rise.png');

export function PersonalUserPanel() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [quotaSummary, setQuotaSummary] = useState<AiQuotaSummary | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isQuotaLoading, setIsQuotaLoading] = useState(false);
  const [isAuthModalVisible, setIsAuthModalVisible] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authVerificationCode, setAuthVerificationCode] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // 格式化: quotaSummary/null + loading 状态 → 可直接展示的计划与额度文案 → 用户中心指标区展示文本
  // 说明: 未登录时不展示指标，已登录时透出计划与剩余额度
  const planLabel = `所属计划: ${sessionUser?.planName ?? '--'}`;
  const quotaLabel = `AI 剩余额度: ${getQuotaText(quotaSummary, isQuotaLoading)}`;

  const openAuthModal = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthVerificationCode('');
    setAuthPassword('');
    setIsAuthModalVisible(true);
  };

  const closeAuthModal = () => {
    if (isSubmitting || isSendingCode) {
      return;
    }

    setIsAuthModalVisible(false);
  };

  const refreshSessionState = async () => {
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
  };

  const handleSendVerificationCode = async () => {
    const normalizedEmail = authEmail.trim();

    if (!normalizedEmail) {
      Alert.alert('邮箱不能为空', '请先输入邮箱地址。');
      return;
    }

    setIsSendingCode(true);

    try {
      const result = await requestRegisterCode(normalizedEmail);

      Alert.alert(
        '验证码已发送',
        result.verificationCode
          ? `当前环境未接入真实邮件发送，开发验证码为：${result.verificationCode}`
          : result.message
      );
    } catch (error) {
      Alert.alert('发送失败', getErrorMessage(error));
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleSubmitAuth = async () => {
    const normalizedEmail = authEmail.trim();
    const normalizedPassword = authPassword.trim();

    if (!normalizedEmail) {
      Alert.alert('邮箱不能为空', '请输入邮箱地址。');
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

    setIsSubmitting(true);

    try {
      if (authMode === 'register') {
        await registerWithEmailCode(
          normalizedEmail,
          authVerificationCode.trim(),
          normalizedPassword
        );
      } else {
        await loginWithEmailPassword(normalizedEmail, normalizedPassword);
      }

      setIsAuthModalVisible(false);
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

    Alert.alert(
      '个人账号管理',
      `邮箱：${sessionUser.email}\n所属计划：${sessionUser.planName}\n累计消耗：$${quotaSummary?.totalChargedUsd ?? '0'}`,
      [
        { text: '关闭', style: 'cancel' },
        {
          text: '退出登录',
          style: 'destructive',
          onPress: async () => {
            await clearAuthSession();
            setSession(null);
            setQuotaSummary(null);
          },
        },
      ]
    );
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
          <View style={styles.card}>
            <View style={styles.headerRow}>
              {sessionUser.avatarUrl ? (
                <Image source={{ uri: sessionUser.avatarUrl }} contentFit="cover" style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <ThemedText style={styles.avatarFallbackText}>{avatarFallbackText}</ThemedText>
                </View>
              )}
              <View style={styles.headerTextGroup}>
                <ThemedText numberOfLines={1} style={styles.userNameText}>
                  {sessionUser.name}
                </ThemedText>
                <ThemedText numberOfLines={1} style={styles.userSubtitleText}>
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
              <ThemedText numberOfLines={1} style={styles.metricText}>
                {planLabel}
              </ThemedText>
              <View style={styles.quotaMetric}>
                {isQuotaLoading ? <ActivityIndicator size="small" color="#111111" /> : null}
                <ThemedText numberOfLines={1} style={styles.metricText}>
                  {quotaLabel}
                </ThemedText>
              </View>
            </View>

            <View style={styles.divider} />

            {/*
             * 渲染位置: 用户信息卡底部操作区
             * 展示内容: 个人账号管理入口，点击后可查看当前账号信息或退出登录
             * 数据来源: sessionUser 与 quotaSummary
             */}
            <Pressable accessibilityRole="button" style={styles.footerRow} onPress={handleManageAccount}>
              <View style={styles.footerLeft}>
                <Image source={SETTINGS_ICON} contentFit="contain" style={styles.footerSettingsIcon} />
                <ThemedText style={styles.footerText}>个人账号管理</ThemedText>
              </View>
              <Image source={ARROW_ICON} contentFit="contain" style={styles.footerArrowIcon} />
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
            style={[styles.card, styles.loggedOutCard, isBootstrapping ? styles.buttonDisabled : null]}
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
                  style={styles.loggedOutTitle}>
                  登录Astesia
                </ThemedText>
                <ThemedText
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={styles.loggedOutSubtitle}>
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
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                {authMode === 'register' ? '邮箱注册' : '邮箱登录'}
              </ThemedText>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={closeAuthModal}>
                <MaterialIcons name="close" size={24} color="#334155" />
              </Pressable>
            </View>

            <View style={styles.modeSwitchRow}>
              <AuthModeButton
                active={authMode === 'login'}
                label="登录"
                onPress={() => setAuthMode('login')}
              />
              <AuthModeButton
                active={authMode === 'register'}
                label="注册"
                onPress={() => setAuthMode('register')}
              />
            </View>

            {/*
             * 渲染位置: 用户身份弹层表单区域
             * 展示内容: 邮箱、验证码、密码输入，以及发送验证码与提交操作
             * 数据来源: authEmail、authVerificationCode、authPassword 本地表单状态
             */}
            <View style={styles.formGroup}>
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="请输入邮箱"
                placeholderTextColor="#94A3B8"
                style={styles.input}
                value={authEmail}
                onChangeText={setAuthEmail}
              />

              {authMode === 'register' ? (
                <View style={styles.verificationRow}>
                  <TextInput
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder="请输入验证码"
                    placeholderTextColor="#94A3B8"
                    style={[styles.input, styles.verificationInput]}
                    value={authVerificationCode}
                    onChangeText={setAuthVerificationCode}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSendingCode}
                    style={[styles.verificationButton, isSendingCode ? styles.buttonDisabled : null]}
                    onPress={() => void handleSendVerificationCode()}>
                    <ThemedText style={styles.verificationButtonText}>
                      {isSendingCode ? '发送中' : '获取验证码'}
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}

              <TextInput
                secureTextEntry
                placeholder={authMode === 'register' ? '请设置登录密码' : '请输入登录密码'}
                placeholderTextColor="#94A3B8"
                style={styles.input}
                value={authPassword}
                onChangeText={setAuthPassword}
              />
            </View>

            <ThemedText style={styles.formHelpText}>
              {authMode === 'register'
                ? '注册使用邮箱 + 验证码，完成后后续使用邮箱 + 密码登录。'
                : '登录成功后会展示用户头像、所属计划和当前 AI 剩余额度。'}
            </ThemedText>

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting || isBootstrapping}
              style={[styles.submitButton, (isSubmitting || isBootstrapping) ? styles.buttonDisabled : null]}
              onPress={() => void handleSubmitAuth()}>
              <ThemedText style={styles.submitButtonText}>
                {isSubmitting ? '提交中...' : authMode === 'register' ? '确认注册' : '确认登录'}
              </ThemedText>
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
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.modeSwitchButton, active ? styles.modeSwitchButtonActive : null]}
      onPress={onPress}>
      <ThemedText style={[styles.modeSwitchButtonText, active ? styles.modeSwitchButtonTextActive : null]}>
        {label}
      </ThemedText>
    </Pressable>
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
 * 统一提取接口或运行时异常的可展示文案
 *
 * @param error - 捕获到的异常对象
 * @returns 适合直接展示给用户的错误文案
 * @example
 *   getErrorMessage(new Error('登录失败')) // => '登录失败'
 */
function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '服务暂时不可用，请稍后重试。';
}

const styles = StyleSheet.create({
  card: {
    height: 164,
    borderRadius: 25,
    borderCurve: 'continuous',
    paddingTop: 17,
    paddingRight: 16,
    paddingBottom: 12,
    paddingLeft: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
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
    color: '#000000',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '400',
    flexShrink: 1,
  },
  loggedOutSubtitle: {
    color: '#9CA3AF',
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
    backgroundColor: '#D9D9D9',
  },
  avatarFallback: {
    width: 47,
    height: 47,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D9D9D9',
  },
  avatarFallbackText: {
    color: '#334155',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
  },
  headerTextGroup: {
    flex: 1,
    gap: 4,
  },
  userNameText: {
    color: '#000000',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '400',
  },
  userSubtitleText: {
    color: '#000000',
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
    color: '#000000',
    fontSize: 12,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    marginTop: 12,
    backgroundColor: '#000000',
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
    color: '#000000',
    fontSize: 12,
    lineHeight: 16,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 16,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitle: {
    color: '#0F172A',
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
    backgroundColor: '#F1F5F9',
  },
  modeSwitchButtonActive: {
    backgroundColor: '#111111',
  },
  modeSwitchButtonText: {
    color: '#475569',
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
    borderColor: '#CBD5E1',
    borderRadius: 16,
    paddingHorizontal: 14,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
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
    backgroundColor: '#111111',
  },
  verificationButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  formHelpText: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 20,
  },
  submitButton: {
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F766E',
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
