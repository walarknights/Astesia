import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { File as ExpoFile } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppPalette, Fonts } from '@/constants/theme';
import {
  clearAuthSession,
  loadAuthSession,
  updateAuthProfile,
  type AuthSession,
} from '@/services/auth-session';

const ACCOUNT_MANAGEMENT_DESCRIPTION = '管理当前登录账号的基础资料。修改邮箱或登录密码时，需要先验证当前密码。';
const PLAN_LOCKED_TIP = '当前无法更改所属计划';
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export default function AccountManagementScreen() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [isAvatarRemoved, setIsAvatarRemoved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isCurrentPasswordVisible, setIsCurrentPasswordVisible] = useState(false);
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const syncAccountSession = async () => {
      const currentSession = await loadAuthSession();

      if (!active) {
        return;
      }

      setSession(currentSession);
      setDisplayName(currentSession?.user.name ?? '');
      setEmail(currentSession?.user.email ?? '');
      setAvatarPreviewUri(currentSession?.user.avatarUrl ?? null);
      setAvatarDataUrl(null);
      setIsAvatarRemoved(false);
      setIsLoading(false);
    };

    void syncAccountSession();

    return () => {
      active = false;
    };
  }, []);

  const sessionUser = session?.user ?? null;
  const normalizedEmail = normalizeProfileEmail(email);
  const isEmailChanged = Boolean(sessionUser && normalizedEmail !== sessionUser.email);
  const isPasswordChanging = newPassword.trim().length > 0 || confirmPassword.trim().length > 0;
  const isAvatarChanged = Boolean(avatarDataUrl || (isAvatarRemoved && sessionUser?.avatarUrl));
  const needsCurrentPassword = isEmailChanged || isPasswordChanging;
  const avatarFallbackText = useMemo(() => {
    const normalizedDisplayName = displayName.trim();
    return Array.from(normalizedDisplayName || sessionUser?.name || 'A')[0] ?? 'A';
  }, [displayName, sessionUser?.name]);
  const isDirty = useMemo(() => {
    if (!sessionUser) {
      return false;
    }

    return displayName.trim() !== sessionUser.name
      || isEmailChanged
      || isPasswordChanging
      || isAvatarChanged;
  }, [displayName, isAvatarChanged, isEmailChanged, isPasswordChanging, sessionUser]);

  const handleSelectAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('无法打开图库', '请允许访问系统图库后再选择头像。');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      allowsMultipleSelection: false,
      aspect: [1, 1],
      base64: true,
      mediaTypes: ['images'],
      quality: 0.82,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    try {
      const avatarAsset = result.assets[0];
      const normalizedAvatar = await getAvatarDataUrl({
        uri: avatarAsset.uri,
        name: avatarAsset.fileName,
        mimeType: avatarAsset.mimeType,
        base64: avatarAsset.base64,
      });

      setAvatarPreviewUri(avatarAsset.uri);
      setAvatarDataUrl(normalizedAvatar);
      setIsAvatarRemoved(false);
    } catch (error) {
      Alert.alert('头像不可用', getAvatarErrorMessage(error));
    }
  };

  const handleRemoveAvatar = () => {
    if (!sessionUser?.avatarUrl && !avatarDataUrl) {
      return;
    }

    setAvatarPreviewUri(null);
    setAvatarDataUrl(null);
    setIsAvatarRemoved(true);
  };

  const handleSubmit = async () => {
    if (!sessionUser) {
      Alert.alert('请先登录', '登录后才能管理个人账号。');
      return;
    }

    const normalizedDisplayName = displayName.trim();
    const normalizedCurrentPassword = currentPassword.trim();
    const normalizedNewPassword = newPassword.trim();
    const normalizedConfirmPassword = confirmPassword.trim();

    if (!normalizedDisplayName) {
      Alert.alert('用户名不能为空', '请输入要展示的用户名。');
      return;
    }

    if (!normalizedEmail) {
      Alert.alert('邮箱格式不正确', '请输入有效的邮箱地址。');
      return;
    }

    if (needsCurrentPassword && !normalizedCurrentPassword) {
      Alert.alert('需要当前密码', '修改邮箱或密码时，请先输入当前密码。');
      return;
    }

    if (isPasswordChanging && normalizedNewPassword.length < 6) {
      Alert.alert('新密码太短', '新密码至少需要 6 位。');
      return;
    }

    if (isPasswordChanging && normalizedNewPassword !== normalizedConfirmPassword) {
      Alert.alert('两次密码不一致', '请确认新密码和确认密码完全一致。');
      return;
    }

    setIsSaving(true);

    try {
      const updatedSession = await updateAuthProfile({
        displayName: normalizedDisplayName,
        email: normalizedEmail,
        currentPassword: needsCurrentPassword ? normalizedCurrentPassword : undefined,
        newPassword: isPasswordChanging ? normalizedNewPassword : undefined,
        avatarDataUrl: avatarDataUrl ?? undefined,
        removeAvatar: isAvatarRemoved,
      });

      setSession(updatedSession);
      setDisplayName(updatedSession.user.name);
      setEmail(updatedSession.user.email);
      setAvatarPreviewUri(updatedSession.user.avatarUrl ?? null);
      setAvatarDataUrl(null);
      setIsAvatarRemoved(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('保存成功', '账号信息已经更新。');
    } catch (error) {
      Alert.alert('保存失败', getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('退出登录', '退出后本机将清理当前账号登录态，是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await clearAuthSession();
          setSession(null);
          router.replace('/personal');
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={['#1E1E3A', '#151526', AppPalette.background]}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gradientBackground}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            // [变更] 修改前: 仅 iOS 启用键盘避让，Android 页面底部的邮箱和密码输入可能被遮挡
            // [变更] 修改后: Android 缩短表单可用高度，由内部滚动容器将聚焦输入框移入可视区
            // [原因] 账号表单较长，需要让所有平台都能在键盘弹出后继续滚动到当前字段
            behavior={Platform.select({ android: 'height', ios: 'padding' })}
            style={styles.keyboardAvoidingView}>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" style={styles.iconButton} onPress={() => router.back()}>
                <MaterialIcons name="arrow-back" size={24} color={AppPalette.text} />
              </Pressable>
              <ThemedText style={styles.headerTitle}>账号管理</ThemedText>
              <View style={styles.headerSpacer} />
            </View>

            <ScrollView
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}>
              {/*
               * 渲染位置: 账号管理页顶部说明卡片
               * 展示内容: 页面标题、账号管理说明和当前账号邮箱摘要
               * 数据来源: 静态说明文案与 session 中的当前用户信息
               */}
              <View style={styles.heroCard}>
                <View style={styles.heroIcon}>
                  <MaterialIcons name="manage-accounts" size={28} color="#FFFFFF" />
                </View>
                <ThemedText style={styles.heroTitle}>个人账号管理</ThemedText>
                <ThemedText style={styles.heroDescription}>{ACCOUNT_MANAGEMENT_DESCRIPTION}</ThemedText>
                <View style={styles.summaryChip}>
                  <ThemedText style={styles.summaryLabel}>当前账号</ThemedText>
                  <ThemedText numberOfLines={1} style={styles.summaryValue}>
                    {isLoading ? '读取中...' : sessionUser?.email ?? '未登录'}
                  </ThemedText>
                </View>
              </View>

              {isLoading ? (
                <View style={styles.stateCard}>
                  <ActivityIndicator color={AppPalette.brandLight} />
                  <ThemedText style={styles.stateText}>正在读取账号信息...</ThemedText>
                </View>
              ) : null}

              {!isLoading && !sessionUser ? (
                <View style={styles.stateCard}>
                  <MaterialIcons name="lock-outline" size={28} color={AppPalette.textMuted} />
                  <ThemedText style={styles.stateTitle}>请先登录</ThemedText>
                  <ThemedText style={styles.stateText}>登录后才能修改用户名、邮箱和密码。</ThemedText>
                  <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => router.back()}>
                    <ThemedText style={styles.primaryButtonText}>返回个人页登录</ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {!isLoading && sessionUser ? (
                <>
                  {/*
                   * 渲染位置: 账号管理页资料表单区
                   * 展示内容: 用户名、邮箱、所属计划只读提示和密码修改输入
                   * 数据来源: session 用户资料与本地表单状态
                   */}
                  <View style={styles.formCard}>
                    <SectionHeader icon="person" title="基础资料" />
                    {/*
                     * 渲染位置: 账号管理页基础资料卡片顶部
                     * 展示内容: 当前头像预览、选择图片按钮和移除头像按钮
                     * 数据来源: session 用户头像与本地选择图片状态
                     */}
                    <View style={styles.avatarEditor}>
                      <View style={styles.avatarPreview}>
                        {avatarPreviewUri ? (
                          <Image source={{ uri: avatarPreviewUri }} contentFit="cover" style={styles.avatarImage} />
                        ) : (
                          <ThemedText style={styles.avatarFallbackText}>{avatarFallbackText}</ThemedText>
                        )}
                      </View>
                      <View style={styles.avatarActions}>
                        <Pressable
                          accessibilityRole="button"
                          disabled={isSaving}
                          style={[styles.avatarActionButton, isSaving ? styles.buttonDisabled : null]}
                          onPress={() => void handleSelectAvatar()}>
                          <MaterialIcons name="photo-camera" size={18} color={AppPalette.text} />
                          <ThemedText style={styles.avatarActionText}>选择头像</ThemedText>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={isSaving || (!avatarPreviewUri && !sessionUser.avatarUrl)}
                          style={[
                            styles.avatarRemoveButton,
                            (isSaving || (!avatarPreviewUri && !sessionUser.avatarUrl)) ? styles.buttonDisabled : null,
                          ]}
                          onPress={handleRemoveAvatar}>
                          <ThemedText style={styles.avatarRemoveText}>移除</ThemedText>
                        </Pressable>
                        <ThemedText style={styles.avatarHint}>支持 JPG、PNG、WebP，最大 2MB。</ThemedText>
                      </View>
                    </View>
                    <AccountTextField
                      label="用户名"
                      maxLength={24}
                      placeholder="请输入用户名"
                      value={displayName}
                      onChangeText={setDisplayName}
                    />
                    <AccountTextField
                      autoCapitalize="none"
                      keyboardType="email-address"
                      label="邮箱"
                      placeholder="请输入邮箱"
                      value={email}
                      onChangeText={setEmail}
                    />
                  </View>

                  <View style={styles.formCard}>
                    <SectionHeader icon="workspace-premium" title="所属计划" />
                    <View style={styles.planCard}>
                      <View style={styles.planCopy}>
                        <ThemedText style={styles.planLabel}>当前计划</ThemedText>
                        <ThemedText style={styles.planValue}>{sessionUser.planName}</ThemedText>
                      </View>
                      <View style={styles.lockBadge}>
                        <MaterialIcons name="lock" size={16} color={AppPalette.textMuted} />
                      </View>
                    </View>
                    <ThemedText style={styles.planTip}>{PLAN_LOCKED_TIP}</ThemedText>
                  </View>

                  <View style={styles.formCard}>
                    <SectionHeader icon="password" title="登录密码" />
                    <PasswordInputField
                      isVisible={isCurrentPasswordVisible}
                      label="当前密码"
                      placeholder={needsCurrentPassword ? '请输入当前密码' : '修改邮箱或密码时填写'}
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      onToggleVisibility={() => setIsCurrentPasswordVisible((currentValue) => !currentValue)}
                    />
                    <PasswordInputField
                      isVisible={isNewPasswordVisible}
                      label="新密码"
                      placeholder="不修改则留空"
                      value={newPassword}
                      onChangeText={setNewPassword}
                      onToggleVisibility={() => setIsNewPasswordVisible((currentValue) => !currentValue)}
                    />
                    <PasswordInputField
                      isVisible={isConfirmPasswordVisible}
                      label="确认新密码"
                      placeholder="再次输入新密码"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      onToggleVisibility={() => setIsConfirmPasswordVisible((currentValue) => !currentValue)}
                    />
                    <ThemedText style={styles.helpText}>
                      只修改用户名时无需输入当前密码；修改邮箱或登录密码时会校验当前密码。
                    </ThemedText>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    disabled={isSaving || !isDirty}
                    style={[styles.primaryButton, (isSaving || !isDirty) ? styles.buttonDisabled : null]}
                    onPress={() => void handleSubmit()}>
                    <ThemedText style={styles.primaryButtonText}>
                      {isSaving ? '保存中...' : '保存修改'}
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    disabled={isSaving}
                    style={[styles.logoutButton, isSaving ? styles.buttonDisabled : null]}
                    onPress={handleLogout}>
                    <ThemedText style={styles.logoutButtonText}>退出登录</ThemedText>
                  </Pressable>
                </>
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

function SectionHeader({ icon, title }: { icon: keyof typeof MaterialIcons.glyphMap; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIcon}>
        <MaterialIcons name={icon} size={19} color={AppPalette.brandLight} />
      </View>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
    </View>
  );
}

function AccountTextField({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
  keyboardType,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address';
  maxLength?: number;
}) {
  return (
    <View style={styles.fieldGroup}>
      <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
      <TextInput
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  );
}

function PasswordInputField({
  label,
  isVisible,
  placeholder,
  value,
  onChangeText,
  onToggleVisibility,
}: {
  label: string;
  isVisible: boolean;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  onToggleVisibility: () => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <ThemedText style={styles.fieldLabel}>{label}</ThemedText>
      <View style={styles.passwordInputRow}>
        {/*
         * 渲染位置: 账号管理页密码输入行
         * 展示内容: 密码输入框与显示 / 隐藏密码按钮
         * 数据来源: PasswordInputField 组件入参中的 value、placeholder、isVisible
         */}
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!isVisible}
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
          style={styles.passwordTextInput}
          value={value}
          onChangeText={onChangeText}
        />
        <Pressable
          accessibilityLabel={isVisible ? '隐藏密码' : '显示密码'}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.passwordVisibilityButton}
          onPress={onToggleVisibility}>
          <MaterialIcons name={isVisible ? 'visibility-off' : 'visibility'} size={20} color="#64748B" />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * 归一化账号管理表单中的邮箱输入。
 *
 * @param value - 用户输入的邮箱文本
 * @returns 通过基础格式校验的邮箱；无效时返回空字符串
 * @example
 *   normalizeProfileEmail(' Demo@Example.com ') // => 'demo@example.com'
 */
function normalizeProfileEmail(value: string) {
  const normalizedValue = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue) ? normalizedValue : '';
}

/**
 * 将图库返回的头像资源转换成服务端可校验的 data URI。
 *
 * @param asset - ImagePicker 返回的头像资源
 * @returns JPG/PNG/WebP data URI
 * @example
 *   await getAvatarDataUrl({ uri, mimeType: 'image/png', base64 })
 */
async function getAvatarDataUrl(asset: {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  base64?: string | null;
}) {
  const mimeType = getSupportedAvatarMimeType(asset);

  if (!mimeType) {
    throw new Error('UNSUPPORTED_AVATAR_FORMAT');
  }

  if (asset.uri.startsWith('data:')) {
    return normalizeExistingAvatarDataUrl(asset.uri, mimeType);
  }

  const base64Text = typeof asset.base64 === 'string' && asset.base64
    ? asset.base64
    : Platform.OS === 'web'
      ? ''
      : await new ExpoFile(asset.uri).base64();
  const normalizedBase64Text = base64Text.replace(/\s/g, '');

  if (!normalizedBase64Text) {
    throw new Error('AVATAR_READ_FAILED');
  }

  if (getBase64ByteLength(normalizedBase64Text) > AVATAR_MAX_BYTES) {
    throw new Error('AVATAR_TOO_LARGE');
  }

  return `data:${mimeType};base64,${normalizedBase64Text}`;
}

function getSupportedAvatarMimeType(asset: { uri: string; name?: string | null; mimeType?: string | null }) {
  const normalizedMimeType = asset.mimeType?.toLowerCase();

  if (normalizedMimeType === 'image/jpg') {
    return 'image/jpeg';
  }

  if (normalizedMimeType && AVATAR_MIME_TYPES.includes(normalizedMimeType as (typeof AVATAR_MIME_TYPES)[number])) {
    return normalizedMimeType;
  }

  const extension = getFileExtension(asset.name) ?? getFileExtension(asset.uri);

  if (extension === 'jpg' || extension === 'jpeg') {
    return 'image/jpeg';
  }

  if (extension === 'png') {
    return 'image/png';
  }

  if (extension === 'webp') {
    return 'image/webp';
  }

  return null;
}

function normalizeExistingAvatarDataUrl(value: string, fallbackMimeType: string) {
  const matchedValue = /^data:(image\/(?:jpe?g|png|webp));base64,([a-z0-9+/=\s]+)$/i.exec(value.trim());

  if (!matchedValue) {
    throw new Error('UNSUPPORTED_AVATAR_FORMAT');
  }

  const mimeType = matchedValue[1].toLowerCase() === 'image/jpg'
    ? 'image/jpeg'
    : matchedValue[1].toLowerCase();
  const base64Text = matchedValue[2].replace(/\s/g, '');

  if (!AVATAR_MIME_TYPES.includes(mimeType as (typeof AVATAR_MIME_TYPES)[number])) {
    throw new Error('UNSUPPORTED_AVATAR_FORMAT');
  }

  if (getBase64ByteLength(base64Text) > AVATAR_MAX_BYTES) {
    throw new Error('AVATAR_TOO_LARGE');
  }

  return `data:${mimeType || fallbackMimeType};base64,${base64Text}`;
}

function getFileExtension(value?: string | null) {
  if (!value) {
    return null;
  }

  const sanitizedValue = value.split('?')[0].split('#')[0];
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(sanitizedValue);

  return extensionMatch?.[1]?.toLowerCase() ?? null;
}

function getBase64ByteLength(value: string) {
  const paddingLength = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - paddingLength;
}

/**
 * 统一提取账号管理接口异常的用户可读文案。
 *
 * @param error - 捕获到的异常对象
 * @returns 适合 Alert 展示的错误文案
 * @example
 *   getErrorMessage(new Error('当前密码不正确。')) // => '当前密码不正确。'
 */
function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '账号信息暂时无法保存，请稍后重试。';
}

function getAvatarErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return '头像暂时无法读取，请换一张图片重试。';
  }

  if (error.message === 'UNSUPPORTED_AVATAR_FORMAT') {
    return '请选择 JPG、PNG 或 WebP 格式的图片。';
  }

  if (error.message === 'AVATAR_TOO_LARGE') {
    return '头像图片不能超过 2MB。';
  }

  return '头像暂时无法读取，请换一张图片重试。';
}

const styles = StyleSheet.create({
  gradientBackground: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerTitle: {
    color: AppPalette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  headerSpacer: {
    width: 42,
    height: 42,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 32,
    gap: 16,
  },
  heroCard: {
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 28,
    padding: 20,
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.brand,
  },
  heroTitle: {
    color: AppPalette.text,
    fontFamily: Fonts.serifSemiBold,
    fontSize: 30,
    lineHeight: 36,
  },
  heroDescription: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 22,
  },
  summaryChip: {
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  summaryLabel: {
    color: AppPalette.textSubtle,
    fontSize: 12,
    lineHeight: 16,
  },
  summaryValue: {
    marginTop: 4,
    color: AppPalette.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  stateCard: {
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 24,
    padding: 20,
    alignItems: 'center',
    gap: 10,
    backgroundColor: AppPalette.surfaceSoft,
  },
  stateTitle: {
    color: AppPalette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  stateText: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  formCard: {
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 24,
    padding: 16,
    gap: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(51, 112, 255, 0.16)',
  },
  sectionTitle: {
    color: AppPalette.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  avatarEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    borderRadius: 20,
    padding: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  avatarPreview: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: AppPalette.surfaceElevated,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallbackText: {
    color: AppPalette.brandLight,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
  },
  avatarActions: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  avatarActionButton: {
    minHeight: 38,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(51, 112, 255, 0.72)',
  },
  avatarActionText: {
    color: AppPalette.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  avatarRemoveButton: {
    minHeight: 38,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.38)',
    backgroundColor: 'rgba(127, 29, 29, 0.16)',
  },
  avatarRemoveText: {
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  avatarHint: {
    width: '100%',
    color: AppPalette.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    color: AppPalette.textSubtle,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
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
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  planCopy: {
    flex: 1,
    gap: 4,
  },
  planLabel: {
    color: AppPalette.textSubtle,
    fontSize: 12,
    lineHeight: 16,
  },
  planValue: {
    color: AppPalette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  lockBadge: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.surfaceSoft,
  },
  planTip: {
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  helpText: {
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.brand,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    fontFamily: Fonts.sans,
  },
  logoutButton: {
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.48)',
    backgroundColor: 'rgba(127, 29, 29, 0.18)',
  },
  logoutButtonText: {
    color: '#FCA5A5',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
