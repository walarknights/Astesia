import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AstesiaLogo } from '@/components/AstesiaLogo';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { PersonalUserPanel } from '@/components/PersonalUserPanel';
import { ThemedText } from '@/components/themed-text';
import {
  getPersonalSurfacePalette,
  PERSONAL_SURFACE_PALETTE,
  type PersonalSurfacePalette,
} from '@/constants/personal-theme';
import { AppPalette, Fonts } from '@/constants/theme';
import {
  loadPersonalBackgroundImageUri,
  persistPersonalBackgroundImage,
} from '@/services/personal-background-image-storage';
import { storage } from '@/services/storage';
import {
  isExportableStorageKey,
  LOCAL_BACKUP_STORAGE_KEY,
  NOTES_STORAGE_KEY,
} from '@/services/storage-keys';
import { sanitizeNotesStorageValue } from '@/services/notes-storage';
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type FontSizeMode,
  type HomeLayout,
  type PersonalBackground,
  type ThemeMode,
  useAppSettings,
} from '@/services/app-settings';
import {
  DEFAULT_APP_CONTENT_BLOCKS,
  loadAppContentBlocks,
  type AppContentKey,
} from '@/services/app-content';

type ChoiceOption<T extends string> = {
  label: string;
  value: T;
};

type DialogState = {
  title: string;
  content: string;
  editable?: boolean;
};

type BuiltInPersonalBackground = Exclude<PersonalBackground, 'custom'>;

const BACKGROUND_IMAGES: Record<BuiltInPersonalBackground, number> = {
  person: require('@/assets/images/personBack.jpg'),
  sunny: require('@/assets/images/sunny.jpg'),
  cloudy: require('@/assets/images/cloudy.jpg'),
  rainy: require('@/assets/images/rainy.jpg'),
};

const THEME_OPTIONS: ChoiceOption<ThemeMode>[] = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色模式', value: 'light' },
  { label: '深色模式', value: 'dark' },
];

const FONT_SIZE_OPTIONS: ChoiceOption<FontSizeMode>[] = [
  { label: '小号', value: 'small' },
  { label: '标准', value: 'medium' },
  { label: '大号', value: 'large' },
];

const HOME_LAYOUT_OPTIONS: ChoiceOption<HomeLayout>[] = [
  { label: '天气首页', value: 'weather' },
  { label: '笔记优先', value: 'notes' },
  { label: '记账优先', value: 'accounting' },
];

const BACKGROUND_OPTIONS: ChoiceOption<PersonalBackground>[] = [
  { label: '默认背景', value: 'person' },
  { label: '晴天背景', value: 'sunny' },
  { label: '多云背景', value: 'cloudy' },
  { label: '雨天背景', value: 'rainy' },
  { label: '自定义背景', value: 'custom' },
];

const FEEDBACK_EMAIL = '13062323959@163.com';
const FEEDBACK_SUBJECT = 'Astesia Feedback';

const PersonalSurfaceThemeContext = createContext<PersonalSurfacePalette>(PERSONAL_SURFACE_PALETTE.dark);

function usePersonalSurfaceTheme() {
  return useContext(PersonalSurfaceThemeContext);
}

export default function PersonalScreen() {
  const router = useRouter();
  const { settings, updateSettings, resetSettings, resolvedColorScheme } = useAppSettings();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [importText, setImportText] = useState('');
  const [appContentBlocks, setAppContentBlocks] = useState(DEFAULT_APP_CONTENT_BLOCKS);
  const [customBackgroundImageUri, setCustomBackgroundImageUri] = useState<string | null>(null);
  const [isBackgroundModalVisible, setIsBackgroundModalVisible] = useState(false);
  const [isSavingBackgroundImage, setIsSavingBackgroundImage] = useState(false);
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const selectedBuiltInBackground = settings.personalBackground === 'custom' ? 'person' : settings.personalBackground;
  const backgroundImage = settings.personalBackground === 'custom' && customBackgroundImageUri
    ? { uri: customBackgroundImageUri }
    : BACKGROUND_IMAGES[selectedBuiltInBackground];
  const personalTheme = getPersonalSurfacePalette(resolvedColorScheme);

  useEffect(() => {
    let active = true;

    const syncAppContentBlocks = async () => {
      const remoteContentBlocks = await loadAppContentBlocks();

      if (active) {
        setAppContentBlocks(remoteContentBlocks);
      }
    };

    const syncPersonalBackgroundImage = async () => {
      const storedUri = await loadPersonalBackgroundImageUri();

      if (active) {
        setCustomBackgroundImageUri(storedUri);
      }
    };

    void syncAppContentBlocks();
    void syncPersonalBackgroundImage();

    return () => {
      active = false;
    };
  }, []);

  const handleOpenAppContent = (key: AppContentKey) => {
    const contentBlock = appContentBlocks[key] ?? DEFAULT_APP_CONTENT_BLOCKS[key];

    setDialog({
      title: contentBlock.title,
      content: contentBlock.content,
    });
  };

  const handleSelect = <T extends string,>(
    title: string,
    currentValue: T,
    options: ChoiceOption<T>[],
    onSelect: (value: T) => void
  ) => {
    Alert.alert(
      title,
      '请选择一个选项，本地会自动保存。',
      [
        ...options.map((option) => ({
          text: option.value === currentValue ? `${option.label}（当前）` : option.label,
          onPress: () => onSelect(option.value),
        })),
        { text: '取消', style: 'cancel' as const },
      ],
      { cancelable: true }
    );
  };

  const handleExportData = async () => {
    try {
      const exportedData = await collectStorageSnapshot();
      setDialog({
        title: '数据导出',
        content: JSON.stringify(exportedData, null, 2),
      });
    } catch {
      Alert.alert('导出失败', '暂时无法读取本地数据，请稍后重试。');
    }
  };

  const handleOpenImport = () => {
    setImportText('');
    setDialog({
      title: '数据导入',
      content: '请粘贴此前从“数据导出”得到的 JSON 内容。',
      editable: true,
    });
  };

  const handleApplyImport = async () => {
    try {
      const parsedData = JSON.parse(importText);
      const importedStorage = getImportStorage(parsedData);
      const entries = getImportEntries(importedStorage);

      if (entries.length === 0) {
        Alert.alert('导入失败', '没有找到可导入的数据。');
        return;
      }

      await storage.multiSet(entries);

      if (typeof importedStorage[APP_SETTINGS_STORAGE_KEY] === 'string') {
        updateSettings(
          JSON.parse(importedStorage[APP_SETTINGS_STORAGE_KEY]) as Partial<AppSettings>
        );
      }

      setDialog(null);
      setImportText('');
      Alert.alert('导入完成', '本地数据已写入，部分页面可能需要重新打开后刷新。');
    } catch {
      Alert.alert('导入失败', 'JSON 格式不正确，或数据结构不符合导出格式。');
    }
  };

  const handleBackupData = async () => {
    try {
      const exportedData = await collectStorageSnapshot();
      await storage.setItem(LOCAL_BACKUP_STORAGE_KEY, JSON.stringify(exportedData));
      Alert.alert('备份完成', '已在本机保存一份本地备份。');
    } catch {
      Alert.alert('备份失败', '暂时无法写入本地备份。');
    }
  };

  const handleRestoreBackup = async () => {
    Alert.alert('恢复备份', '恢复会覆盖当前本地数据，是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复',
        onPress: async () => {
          try {
            const backup = await storage.getItem(LOCAL_BACKUP_STORAGE_KEY);

            if (!backup) {
              Alert.alert('暂无备份', '还没有找到本机备份，请先执行“本地备份”。');
              return;
            }

            const importedStorage = getImportStorage(JSON.parse(backup));
            const entries = getImportEntries(importedStorage);

            if (entries.length === 0) {
              Alert.alert('恢复失败', '备份中没有找到可恢复的业务数据。');
              return;
            }

            await storage.multiSet(entries);

            if (typeof importedStorage[APP_SETTINGS_STORAGE_KEY] === 'string') {
              updateSettings(
                JSON.parse(importedStorage[APP_SETTINGS_STORAGE_KEY]) as Partial<AppSettings>
              );
            }

            Alert.alert('恢复完成', '备份数据已恢复到本机。');
          } catch {
            Alert.alert('恢复失败', '备份数据无法读取或已经损坏。');
          }
        },
      },
    ]);
  };

  const handleClearCache = async () => {
    Alert.alert('清理缓存', '只会清理临时缓存，不会删除正式数据。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清理',
        onPress: async () => {
          const keys = await storage.getAllKeys();
          const cacheKeys = keys.filter((key) => key.includes('cache') || key.includes('pending'));

          if (cacheKeys.length > 0) {
            await storage.multiRemove(cacheKeys);
          }

          Alert.alert('清理完成', cacheKeys.length > 0 ? '缓存已清理。' : '当前没有可清理的缓存。');
        },
      },
    ]);
  };

  const handleClearAllData = async () => {
    Alert.alert('清空全部数据', '会删除笔记、记账、待办和天气记录等正式数据，设置偏好会保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认清空',
        style: 'destructive',
        onPress: async () => {
          const keys = await storage.getAllKeys();
          // [变更] 修改前: 除设置与备份外删除统一存储层中的全部 key
          // [变更] 修改后: 只删除白名单内的正式业务数据并保留登录会话
          // [原因] “清空数据”不应隐式删除 SecureStore 凭证或造成内存登录态不一致
          const dataKeys = keys.filter(
            (key) => key !== APP_SETTINGS_STORAGE_KEY && isExportableStorageKey(key)
          );

          if (dataKeys.length > 0) {
            await storage.multiRemove(dataKeys);
          }

          Alert.alert('已清空', dataKeys.length > 0 ? '本地正式数据已清空。' : '当前没有正式数据需要清空。');
        },
      },
    ]);
  };

  const handleResetSettings = () => {
    Alert.alert('恢复默认设置', '会重置主题、字体、首页布局和背景偏好。', [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复默认',
        onPress: () => {
          resetSettings();
          Alert.alert('已恢复', '设置已恢复为默认状态。');
        },
      },
    ]);
  };

  const closeBackgroundModal = () => {
    if (isSavingBackgroundImage) {
      return;
    }

    setIsBackgroundModalVisible(false);
  };

  const handleSelectBuiltInBackground = (personalBackground: BuiltInPersonalBackground) => {
    updateSettings({ personalBackground });
    setIsBackgroundModalVisible(false);
  };

  const saveBackgroundImageFromPicker = async (asset: {
    uri: string;
    name?: string | null;
    mimeType?: string | null;
    file?: globalThis.File | null;
    base64?: string | null;
  }) => {
    try {
      setIsSavingBackgroundImage(true);
      const nextBackgroundImageUri = await persistPersonalBackgroundImage(asset);
      setCustomBackgroundImageUri(nextBackgroundImageUri);
      updateSettings({ personalBackground: 'custom' });
      setIsBackgroundModalVisible(false);
    } catch (error) {
      const isUnsupportedImage = error instanceof Error && error.message === 'UNSUPPORTED_IMAGE_FORMAT';
      Alert.alert(
        isUnsupportedImage ? '图片格式不支持' : '保存失败',
        isUnsupportedImage
          ? '请选择 jpg、png、webp、gif、heic 或 heif 格式的图片'
          : '背景图片暂未保存成功，请稍后重试'
      );
    } finally {
      setIsSavingBackgroundImage(false);
    }
  };

  const handleOpenBackgroundGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('无法打开图库', '请允许访问系统图库后再选择背景图片');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: false,
      mediaTypes: ['images'],
      // [变更] 修改前: Web 端只依赖 picker 返回的临时 URI
      // [变更] 修改后: Web 端额外请求 base64，并把 file/base64 交给持久化层统一转换
      // [原因] PWA 刷新后 blob 地址会失效，自定义背景图需要改为可长期保存的数据地址
      base64: Platform.OS === 'web',
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const [asset] = result.assets;
    await saveBackgroundImageFromPicker({
      uri: asset.uri,
      name: asset.fileName,
      file: asset.file,
      base64: asset.base64,
      mimeType: asset.mimeType,
    });
  };

  const handleOpenBackgroundFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: 'image/*',
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const [asset] = result.assets;
    await saveBackgroundImageFromPicker({
      uri: asset.uri,
      name: asset.name,
      file: asset.file,
      base64: asset.base64,
      mimeType: asset.mimeType,
    });
  };

  // [变更] 修改前: 先用 canOpenURL 判断 mailto 可用性，部分端上会误判导致无法拉起邮件客户端
  // [变更] 修改后: 直接 openURL 打开系统邮件客户端，失败时提示用户手动发送
  // [原因] canOpenURL 对 mailto 的多端可靠性不足，直接打开再兜底更符合反馈入口预期
  const handleFeedback = async () => {
    const feedbackBody = [
      '请在这里填写你的反馈：',
      '',
      `应用版本：${version}`,
      `运行平台：${Platform.OS}`,
    ].join('\n');
    const mailUrl = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}&body=${encodeURIComponent(feedbackBody)}`;

    try {
      await Linking.openURL(mailUrl);
      return;
    } catch {
      // openURL 在无默认邮件客户端或浏览器拦截时可能抛错，统一走手动邮件兜底。
    }

    Alert.alert('意见反馈', `无法自动打开邮件客户端，请发送邮件到 ${FEEDBACK_EMAIL}。`);
  };

  return (
    <PersonalSurfaceThemeContext.Provider value={personalTheme}>
      <ParallaxScrollView
        headerBackgroundColor={{
          light: PERSONAL_SURFACE_PALETTE.light.headerBackground,
          dark: PERSONAL_SURFACE_PALETTE.dark.headerBackground,
        }}
        headerImage={
          <View style={styles.headerImage}>
            {/*
             * 渲染位置: 个人页顶部头图
             * 展示内容: 内置背景或用户上传的自定义背景图片
             * 数据来源: settings.personalBackground 与 customBackgroundImageUri
             */}
            <Image
              source={backgroundImage}
              contentFit="cover"
              style={[StyleSheet.absoluteFillObject, styles.weatherBackgroundImage]}
            />
            <View style={[styles.headerOverlay, { backgroundColor: personalTheme.headerOverlay }]} />
            <View style={styles.headerContent}>
              <View style={styles.logoWrapper}>
                <AstesiaLogo size={112} />
              </View>
              <View style={styles.headerTextGroup}>
                <ThemedText style={styles.titleText}>Astesia</ThemedText>
                <ThemedText style={styles.subtitleText}>本地生活管理中心</ThemedText>
              </View>
            </View>
          </View>
        }>
        <PersonalUserPanel />

        <SettingSection title="外观设置">
          {/* <SettingButton
            icon="palette"
            title="主题设置"
            description={`当前：${getOptionLabel(THEME_OPTIONS, settings.themeMode)}`}
            onPress={() =>
              handleSelect('主题设置', settings.themeMode, THEME_OPTIONS, (themeMode) =>
                updateSettings({ themeMode })
              )
            }
          /> */}
          <SettingButton
            icon="format-size"
            title="字体大小"
            description={`当前：${getOptionLabel(FONT_SIZE_OPTIONS, settings.fontSize)}`}
            onPress={() =>
              handleSelect('字体大小', settings.fontSize, FONT_SIZE_OPTIONS, (fontSize) =>
                updateSettings({ fontSize })
              )
            }
          />
          <SettingButton
            icon="wallpaper"
            title="背景设置"
            description={`当前：${getOptionLabel(BACKGROUND_OPTIONS, settings.personalBackground)}`}
            onPress={() => setIsBackgroundModalVisible(true)}
          />
          <SettingButton
            icon="home"
            title="首页布局"
            description={`当前：${getOptionLabel(HOME_LAYOUT_OPTIONS, settings.homeLayout)}`}
            onPress={() =>
              handleSelect('首页布局', settings.homeLayout, HOME_LAYOUT_OPTIONS, (homeLayout) =>
                updateSettings({ homeLayout })
              )
            }
          />
        </SettingSection>

        <SettingSection title="数据管理">
          <SettingButton icon="file-download" title="数据导出" description="导出本地 JSON 数据" onPress={handleExportData} />
          <SettingButton icon="file-upload" title="数据导入" description="从导出的 JSON 恢复数据" onPress={handleOpenImport} />
          <SettingButton icon="backup" title="本地备份" description="在本机保存一份备份" onPress={handleBackupData} />
          <SettingButton icon="restore" title="恢复备份" description="从本机备份覆盖恢复" onPress={handleRestoreBackup} />
          <SettingButton icon="cleaning-services" title="清理缓存" description="清理临时缓存，不删正式数据" onPress={handleClearCache} />
          <SettingButton danger icon="delete-forever" title="清空全部数据" description="删除正式数据，保留设置偏好" onPress={handleClearAllData} />
        </SettingSection>

        <SettingSection title="关于">
          {/*
           * 渲染位置: 个人页“关于”分组顶部
           * 展示内容: 更新公告、使用帮助、隐私说明和关于应用弹窗入口
           * 数据来源: /api/app/content 响应与 DEFAULT_APP_CONTENT_BLOCKS 兜底内容
           */}
          <SettingButton
            icon="campaign"
            title="更新公告"
            description="查看当前版本更新内容"
            onPress={() => handleOpenAppContent('updateAnnouncement')}
          />
          <SettingButton
            icon="help-outline"
            title="使用帮助"
            description="查看登录方式、数据说明和核心功能指引"
            onPress={() => handleOpenAppContent('help')}
          />
          <SettingButton
            icon="privacy-tip"
            title="隐私说明"
            description="说明登录态、AI 数据与本地数据边界"
            onPress={() => handleOpenAppContent('privacy')}
          />
          {/*
           * 渲染位置: 个人页“关于”分组内
           * 展示内容: 模型价格页面入口，说明可查看 AI 模型输入和输出单价
           * 数据来源: 静态入口文案与 expo-router 路由
           */}
          <SettingButton
            icon="attach-money"
            title="模型价格"
            description="查看当前可用 AI 模型的输入、缓存和输出单价"
            onPress={() => router.push('/model-pricing')}
          />
          {/*
           * 渲染位置: 个人页“关于”分组内
           * 展示内容: 意见反馈邮件入口，点击后打开系统邮件客户端
           * 数据来源: 静态反馈邮箱与 handleFeedback
           */}
          <SettingButton icon="feedback" title="意见反馈" description="通过邮件发送建议" onPress={() => void handleFeedback()} />
          <SettingButton
            icon="system-update"
            title="检查更新"
            description="当前暂无在线更新服务"
            onPress={() => Alert.alert('检查更新', `当前版本 ${version}，暂未接入在线更新服务。`)}
          />
          {/* <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <View style={[styles.iconBadge, { backgroundColor: '#F3E8FF' }]}>
                <MaterialIcons name="science" size={22} color="#7C3AED" />
              </View>
                <View style={styles.switchTextGroup}>
                  <ThemedText style={styles.settingTitle}>实验功能</ThemedText>
                  <ThemedText style={styles.settingDescription}>预留后续功能入口</ThemedText>
                </View> 
            </View>
            <Switch
              value={settings.experimentalFeatures}
              onValueChange={(experimentalFeatures) => updateSettings({ experimentalFeatures })}
            />
          </View> */}
          <SettingButton
            icon="info-outline"
            title="关于应用"
            description={`Astesia ${version}`}
            onPress={() => handleOpenAppContent('about')}
          />
          <SettingButton
            icon="restart-alt"
            title="恢复默认设置"
            description={`默认：${getOptionLabel(THEME_OPTIONS, DEFAULT_APP_SETTINGS.themeMode)} / ${getOptionLabel(FONT_SIZE_OPTIONS, DEFAULT_APP_SETTINGS.fontSize)}`}
            onPress={handleResetSettings}
          />
        </SettingSection>
      </ParallaxScrollView>

      <Modal animationType="slide" transparent visible={dialog !== null} onRequestClose={() => setDialog(null)}>
        <KeyboardAvoidingView
          // [变更] 修改前: 数据导入弹层固定在屏幕底部，长文本输入区可能被键盘遮住
          // [变更] 修改后: 原生端按键盘高度收缩弹层，内部内容继续支持滚动
          // [原因] 导入 JSON 时需要持续看到当前编辑位置和确认按钮
          behavior={Platform.select({ android: 'height', ios: 'padding' })}
          style={[styles.modalBackdrop, { backgroundColor: personalTheme.modalBackdrop }]}>
          <View
            style={[
              styles.modalCard,
              {
                borderColor: personalTheme.cardBorder,
                backgroundColor: personalTheme.modalBackground,
              },
            ]}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={[styles.modalTitle, { color: personalTheme.text }]}>
                {dialog?.title}
              </ThemedText>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setDialog(null)}>
                <MaterialIcons name="close" size={24} color={personalTheme.icon} />
              </Pressable>
            </View>
            <ScrollView
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              style={styles.modalScroll}>
              {dialog?.editable ? (
                <>
                  <ThemedText style={[styles.modalCopy, { color: personalTheme.textMuted }]}>
                    {dialog.content}
                  </ThemedText>
                  <TextInput
                    multiline
                    value={importText}
                    onChangeText={setImportText}
                    placeholder="粘贴 JSON 数据"
                    placeholderTextColor={personalTheme.placeholder}
                    style={[
                      styles.importInput,
                      {
                        borderColor: personalTheme.inputBorder,
                        color: personalTheme.text,
                        backgroundColor: personalTheme.inputBackground,
                      },
                    ]}
                    textAlignVertical="top"
                  />
                </>
              ) : (
                <TextInput
                  multiline
                  editable={false}
                  value={dialog?.content ?? ''}
                  style={[
                    styles.exportOutput,
                    {
                      color: personalTheme.textMuted,
                      backgroundColor: personalTheme.inputBackground,
                    },
                  ]}
                />
              )}
            </ScrollView>
            {dialog?.editable ? (
              <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => void handleApplyImport()}>
                <ThemedText style={styles.primaryButtonText}>确认导入</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        transparent
        visible={isBackgroundModalVisible}
        animationType="fade"
        onRequestClose={closeBackgroundModal}>
        <View style={[styles.modalBackdrop, { backgroundColor: personalTheme.modalBackdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeBackgroundModal} />
          {/*
           * 渲染位置: 个人页背景设置弹层
           * 展示内容: 内置背景选择，以及打开图库/打开文件上传自定义背景
           * 数据来源: settings.personalBackground、customBackgroundImageUri、isSavingBackgroundImage
           */}
          <View
            style={[
              styles.modalCard,
              {
                borderColor: personalTheme.cardBorder,
                backgroundColor: personalTheme.modalBackground,
              },
            ]}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={[styles.modalTitle, { color: personalTheme.text }]}>背景设置</ThemedText>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={closeBackgroundModal}>
                <MaterialIcons name="close" size={24} color={personalTheme.icon} />
              </Pressable>
            </View>
            <ThemedText style={[styles.backgroundModalDescription, { color: personalTheme.textMuted }]}>
              选择内置背景，或上传一张自己的图片作为个人页顶部背景。
            </ThemedText>
            <View style={styles.backgroundOptionGrid}>
              {BACKGROUND_OPTIONS.filter((option): option is ChoiceOption<BuiltInPersonalBackground> => option.value !== 'custom').map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  style={[
                    styles.backgroundOptionButton,
                    {
                      borderColor: personalTheme.cardBorder,
                      backgroundColor: personalTheme.chipBackground,
                    },
                    settings.personalBackground === option.value
                      ? {
                          borderColor: personalTheme.chipActiveBorder,
                          backgroundColor: personalTheme.chipActiveBackground,
                        }
                      : null,
                  ]}
                  onPress={() => handleSelectBuiltInBackground(option.value)}>
                  <ThemedText
                    style={[
                      styles.backgroundOptionText,
                      { color: personalTheme.textMuted },
                      settings.personalBackground === option.value
                        ? { color: personalTheme.chipActiveText }
                        : null,
                    ]}>
                    {option.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <View style={styles.backgroundUploadActions}>
              <Pressable
                style={[styles.modalCancelButton, { backgroundColor: personalTheme.softButtonBackground }]}
                onPress={closeBackgroundModal}>
                <ThemedText style={[styles.modalCancelText, { color: personalTheme.textMuted }]}>取消</ThemedText>
              </Pressable>
              <View style={styles.backgroundUploadRightActions}>
                <Pressable
                  disabled={isSavingBackgroundImage}
                  style={[styles.modalConfirmButton, isSavingBackgroundImage && styles.modalButtonDisabled]}
                  onPress={() => void handleOpenBackgroundGallery()}>
                  <ThemedText style={styles.modalConfirmText}>打开图库</ThemedText>
                </Pressable>
                <Pressable
                  disabled={isSavingBackgroundImage}
                  style={[styles.modalConfirmButton, isSavingBackgroundImage && styles.modalButtonDisabled]}
                  onPress={() => void handleOpenBackgroundFile()}>
                  <ThemedText style={styles.modalConfirmText}>打开文件</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </PersonalSurfaceThemeContext.Provider>
  );
}

function SettingSection({ title, children }: { title: string; children: ReactNode }) {
  const personalTheme = usePersonalSurfaceTheme();

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={[styles.sectionTitle, { color: personalTheme.text }]}>
        {title}
      </ThemedText>
      <View
        style={[
          styles.sectionCard,
          {
            borderColor: personalTheme.cardBorder,
            backgroundColor: personalTheme.cardBackground,
            shadowColor: personalTheme.shadowColor,
            shadowOpacity: personalTheme.cardShadowOpacity,
          },
        ]}>
        {children}
      </View>
    </View>
  );
}

function SettingButton({
  icon,
  title,
  description,
  danger,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  description: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const personalTheme = usePersonalSurfaceTheme();

  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.settingRow, { borderBottomColor: personalTheme.divider }]}
      onPress={onPress}>
      <View
        style={[
          styles.iconBadge,
          {
            backgroundColor: danger
              ? personalTheme.dangerIconBadgeBackground
              : personalTheme.iconBadgeBackground,
          },
        ]}>
        <MaterialIcons
          name={icon}
          size={22}
          color={danger ? personalTheme.dangerText : personalTheme.iconBadgeColor}
        />
      </View>
      <View style={styles.settingCopy}>
        <ThemedText
          style={[
            styles.settingTitle,
            { color: danger ? personalTheme.dangerText : personalTheme.text },
          ]}>
          {title}
        </ThemedText>
        <ThemedText style={[styles.settingDescription, { color: personalTheme.textMuted }]}>
          {description}
        </ThemedText>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={personalTheme.icon} />
    </Pressable>
  );
}

/**
 * 收集允许用户迁移的本地业务数据快照。
 *
 * @returns 不包含登录凭证和账号资料的导出对象
 * @example
 *   await collectStorageSnapshot()
 */
async function collectStorageSnapshot() {
  // 格式化: 统一存储层 key 列表 → 业务白名单过滤 → 可安全导出的键值快照
  // 说明: 导出与本地备份只迁移业务数据，不迁移任何认证会话
  const keys = (await storage.getAllKeys()).filter(isExportableStorageKey);
  const pairs = await storage.multiGet(keys);

  return {
    app: 'Astesia',
    exportedAt: new Date().toISOString(),
    storage: Object.fromEntries(pairs),
  };
}

/**
 * 从导入对象中提取允许写入的业务存储项。
 *
 * @param importedStorage - 导出文件中的原始 storage 对象
 * @returns 已过滤认证 key 和未知 key 的字符串键值项
 * @example
 *   getImportEntries({ userToken: 'secret', 'astesia-notes': '[]' })
 */
function getImportEntries(importedStorage: Record<string, unknown>) {
  // 格式化: 未知导入键值 → 校验业务 key 白名单并清洗高风险 HTML 数据 → storage.multiSet 入参
  // 说明: 即使导入文件被篡改，也不能覆盖登录凭证或写入可执行笔记 HTML
  return Object.entries(importedStorage)
    .map(normalizeImportEntry)
    .filter((entry): entry is [string, string] => entry !== null);
}

function normalizeImportEntry([key, value]: [string, unknown]) {
  if (!isExportableStorageKey(key) || typeof value !== 'string') {
    return null;
  }

  if (key === NOTES_STORAGE_KEY) {
    const sanitizedNotesValue = sanitizeNotesStorageValue(value);
    return sanitizedNotesValue ? [key, sanitizedNotesValue] : null;
  }

  return [key, value] satisfies [string, string];
}

function getImportStorage(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  if (isRecord(value.storage)) {
    return value.storage;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getOptionLabel<T extends string>(options: ChoiceOption<T>[], value: T) {
  return options.find((option) => option.value === value)?.label ?? value;
}

const styles = StyleSheet.create({
  // [变更] 修改前: 个人页设置区使用浅灰背景、白色卡片和蓝色按钮
  // [变更] 修改后: 改为蓝黑背景、玻璃卡片与靛青紫交互态
  // [原因] 让设置页延续推广页的品牌视觉而不改变任何设置行为
  headerImage: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 15, 26, 0.46)',
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 34,
    paddingBottom: 34,
    gap: 18,
  },
  logoWrapper: {
    width: 112,
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextGroup: {
    flex: 1,
    paddingBottom: 14,
  },
  titleText: {
    color: '#ffffff',
    fontFamily: Fonts.serifItalic,
    fontSize: 46,
    lineHeight: 50,
  },
  subtitleText: {
    color: '#E2E8F0',
    fontSize: 15,
    lineHeight: 22,
  },
  weatherBackgroundImage: {
    height: '101%',
    width: '100%',
  },
  summaryCard: {
    borderRadius: 28,
    padding: 22,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  pageTitle: {
    color: AppPalette.text,
  },
  pageDescription: {
    color: AppPalette.textMuted,
    lineHeight: 22,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: AppPalette.text,
    // [变更] 为分组标题补充垂直留白，避免标题与相邻内容视觉拥挤。
    lineHeight: 28,
    paddingTop: 20,
    paddingBottom: 6,
  },
  sectionCard: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surfaceSoft,
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  settingRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppPalette.border,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
  },
  dangerIconBadge: {
    backgroundColor: '#FEE2E2',
  },
  settingCopy: {
    flex: 1,
    gap: 2,
  },
  settingTitle: {
    color: AppPalette.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  settingDescription: {
    color: AppPalette.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  dangerText: {
    color: '#DC2626',
  },
  switchRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppPalette.border,
  },
  switchCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  switchTextGroup: {
    flex: 1,
    gap: 2,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 2, 8, 0.74)',
  },
  modalCard: {
    maxHeight: '82%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 14,
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
  modalScroll: {
    maxHeight: 420,
  },
  modalCopy: {
    color: AppPalette.textMuted,
    marginBottom: 12,
  },
  exportOutput: {
    minHeight: 220,
    borderRadius: 18,
    padding: 14,
    color: AppPalette.textMuted,
    backgroundColor: AppPalette.surfaceSoft,
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  importInput: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: AppPalette.borderStrong,
    borderRadius: 18,
    padding: 14,
    color: AppPalette.text,
    backgroundColor: AppPalette.surface,
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  primaryButton: {
    height: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.brand,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  backgroundModalDescription: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  backgroundOptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  backgroundOptionButton: {
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: AppPalette.surfaceSoft,
  },
  backgroundOptionButtonActive: {
    borderColor: AppPalette.brandLight,
    backgroundColor: 'rgba(99, 102, 241, 0.20)',
  },
  backgroundOptionText: {
    color: AppPalette.textMuted,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  backgroundOptionTextActive: {
    color: AppPalette.brandLight,
  },
  backgroundUploadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  backgroundUploadRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelButton: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: AppPalette.surfaceSoft,
  },
  modalCancelText: {
    color: AppPalette.textMuted,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  modalConfirmButton: {
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: AppPalette.brand,
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
});
