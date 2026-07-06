import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import {
  loadPersonalBackgroundImageUri,
  persistPersonalBackgroundImage,
} from '@/services/personal-background-image-storage';
import { storage } from '@/services/storage';
import { LOCAL_BACKUP_STORAGE_KEY } from '@/services/storage-keys';
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

const UPDATE_ANNOUNCEMENT = [
  'Astesia 1.0.0',
  '1. 新增个人设置中心。',
  '2. 支持主题、字体、首页布局和个人页背景偏好。',
  '3. 新增本地数据导出、导入、备份、恢复和清理入口。',
  '4. 当前版本为纯本地存储方案，不包含登录和云同步。',
].join('\n');

const HELP_CONTENT = [
  '使用帮助',
  '1. 笔记入口用于记录灵感、备忘和长文本内容，并可在页面底部切换到待办。',
  '2. 记账用于记录收入、支出和消费备注。',
  '3. 待办用于拆解计划和跟踪完成状态。',
  '4. 设置页的数据导出和本地备份可用于换机前的手动备份。',
].join('\n');

const PRIVACY_CONTENT = [
  '隐私说明',
  'Astesia 默认不提供登录功能，也不会主动上传笔记、账单或待办数据。',
  '你的正式数据和偏好设置会保存在当前手机本地。',
  '卸载 App、清空应用数据或手机损坏可能导致本地数据丢失，请定期导出或备份。',
].join('\n\n');

export default function PersonalScreen() {
  const { settings, updateSettings, resetSettings } = useAppSettings();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [importText, setImportText] = useState('');
  const [customBackgroundImageUri, setCustomBackgroundImageUri] = useState<string | null>(null);
  const [isBackgroundModalVisible, setIsBackgroundModalVisible] = useState(false);
  const [isSavingBackgroundImage, setIsSavingBackgroundImage] = useState(false);
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const selectedBuiltInBackground = settings.personalBackground === 'custom' ? 'person' : settings.personalBackground;
  const backgroundImage = settings.personalBackground === 'custom' && customBackgroundImageUri
    ? { uri: customBackgroundImageUri }
    : BACKGROUND_IMAGES[selectedBuiltInBackground];
  const fontScale = useMemo(() => getFontScale(settings.fontSize), [settings.fontSize]);

  useEffect(() => {
    let active = true;

    const syncPersonalBackgroundImage = async () => {
      const storedUri = await loadPersonalBackgroundImageUri();

      if (active) {
        setCustomBackgroundImageUri(storedUri);
      }
    };

    void syncPersonalBackgroundImage();

    return () => {
      active = false;
    };
  }, []);

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
      const entries = Object.entries(importedStorage).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      );

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
      const exportedData = await collectStorageSnapshot([LOCAL_BACKUP_STORAGE_KEY]);
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
            const entries = Object.entries(importedStorage).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            );

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
          const dataKeys = keys.filter(
            (key) => key !== APP_SETTINGS_STORAGE_KEY && key !== LOCAL_BACKUP_STORAGE_KEY
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

  const handleFeedback = async () => {
    const mailUrl = 'mailto:13062323959@163.com?subject=Astesia%20Feedback';
    const canOpen = await Linking.canOpenURL(mailUrl);

    if (canOpen) {
      await Linking.openURL(mailUrl);
      return;
    }

    Alert.alert('意见反馈', '请发送邮件到 13062323959@163.com。');
  };

  return (
    <>
      <ParallaxScrollView
        headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
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
            <View style={styles.headerOverlay} />
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
        <View style={styles.summaryCard}>
          <ThemedText type="title" style={[styles.pageTitle, { fontSize: 28 * fontScale }]}>
            个人设置
          </ThemedText>
          <ThemedText style={[styles.pageDescription, { fontSize: 14 * fontScale }]}>
            你的笔记、记账和待办数据默认保存在手机本地。请定期导出或备份，避免卸载或换机造成数据丢失。
          </ThemedText>
        </View>

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
          <SettingButton
            icon="campaign"
            title="更新公告"
            description="查看当前版本更新内容"
            onPress={() => setDialog({ title: '更新公告', content: UPDATE_ANNOUNCEMENT })}
          />
          <SettingButton
            icon="help-outline"
            title="使用帮助"
            description="了解三个核心功能的使用方式"
            onPress={() => setDialog({ title: '使用帮助', content: HELP_CONTENT })}
          />
          <SettingButton
            icon="privacy-tip"
            title="隐私说明"
            description="说明本地存储与数据风险"
            onPress={() => setDialog({ title: '隐私说明', content: PRIVACY_CONTENT })}
          />
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
            onPress={() =>
              setDialog({
                title: '关于应用',
                content: `Astesia ${version}\n\n一个无登录、纯本地存储的笔记、记账和待办管理 App。`,
              })
            }
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
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                {dialog?.title}
              </ThemedText>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setDialog(null)}>
                <MaterialIcons name="close" size={24} color="#334155" />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              {dialog?.editable ? (
                <>
                  <ThemedText style={styles.modalCopy}>{dialog.content}</ThemedText>
                  <TextInput
                    multiline
                    value={importText}
                    onChangeText={setImportText}
                    placeholder="粘贴 JSON 数据"
                    placeholderTextColor="#94A3B8"
                    style={styles.importInput}
                    textAlignVertical="top"
                  />
                </>
              ) : (
                <TextInput multiline editable={false} value={dialog?.content ?? ''} style={styles.exportOutput} />
              )}
            </ScrollView>
            {dialog?.editable ? (
              <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => void handleApplyImport()}>
                <ThemedText style={styles.primaryButtonText}>确认导入</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={isBackgroundModalVisible}
        animationType="fade"
        onRequestClose={closeBackgroundModal}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeBackgroundModal} />
          {/*
           * 渲染位置: 个人页背景设置弹层
           * 展示内容: 内置背景选择，以及打开图库/打开文件上传自定义背景
           * 数据来源: settings.personalBackground、customBackgroundImageUri、isSavingBackgroundImage
           */}
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={styles.modalTitle}>背景设置</ThemedText>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={closeBackgroundModal}>
                <MaterialIcons name="close" size={24} color="#334155" />
              </Pressable>
            </View>
            <ThemedText style={styles.backgroundModalDescription}>
              选择内置背景，或上传一张自己的图片作为个人页顶部背景。
            </ThemedText>
            <View style={styles.backgroundOptionGrid}>
              {BACKGROUND_OPTIONS.filter((option): option is ChoiceOption<BuiltInPersonalBackground> => option.value !== 'custom').map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  style={[
                    styles.backgroundOptionButton,
                    settings.personalBackground === option.value ? styles.backgroundOptionButtonActive : null,
                  ]}
                  onPress={() => handleSelectBuiltInBackground(option.value)}>
                  <ThemedText
                    style={[
                      styles.backgroundOptionText,
                      settings.personalBackground === option.value ? styles.backgroundOptionTextActive : null,
                    ]}>
                    {option.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <View style={styles.backgroundUploadActions}>
              <Pressable style={styles.modalCancelButton} onPress={closeBackgroundModal}>
                <ThemedText style={styles.modalCancelText}>取消</ThemedText>
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
    </>
  );
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      <View style={styles.sectionCard}>{children}</View>
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
  return (
    <Pressable accessibilityRole="button" style={styles.settingRow} onPress={onPress}>
      <View style={[styles.iconBadge, danger ? styles.dangerIconBadge : undefined]}>
        <MaterialIcons name={icon} size={22} color={danger ? '#DC2626' : '#ffffffff'} />
      </View>
      <View style={styles.settingCopy}>
        <ThemedText style={[styles.settingTitle, danger ? styles.dangerText : undefined]}>{title}</ThemedText>
        <ThemedText style={styles.settingDescription}>{description}</ThemedText>
      </View>
      <MaterialIcons name="chevron-right" size={22} color="#94A3B8" />
    </Pressable>
  );
}

async function collectStorageSnapshot(excludedKeys: string[] = []) {
  const keys = (await storage.getAllKeys()).filter((key) => !excludedKeys.includes(key));
  const pairs = await storage.multiGet(keys);

  return {
    app: 'Astesia',
    exportedAt: new Date().toISOString(),
    storage: Object.fromEntries(pairs),
  };
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

function getFontScale(fontSize: FontSizeMode) {
  if (fontSize === 'small') {
    return 0.92;
  }

  if (fontSize === 'large') {
    return 1.12;
  }

  return 1;
}

const styles = StyleSheet.create({
  headerImage: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.26)',
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
    backgroundColor: '#F8FAFC',
    gap: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  pageTitle: {
    color: '#0F172A',
  },
  pageDescription: {
    color: '#475569',
    lineHeight: 22,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: '#0F172A',
  },
  sectionCard: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 12,
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
    borderBottomColor: '#E2E8F0',
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#268bf0ff',
  },
  dangerIconBadge: {
    backgroundColor: '#FEE2E2',
  },
  settingCopy: {
    flex: 1,
    gap: 2,
  },
  settingTitle: {
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  settingDescription: {
    color: '#64748B',
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
    borderBottomColor: '#E2E8F0',
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
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  modalCard: {
    maxHeight: '82%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 14,
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
  modalScroll: {
    maxHeight: 420,
  },
  modalCopy: {
    color: '#475569',
    marginBottom: 12,
  },
  exportOutput: {
    minHeight: 220,
    borderRadius: 18,
    padding: 14,
    color: '#334155',
    backgroundColor: '#F8FAFC',
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  importInput: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 18,
    padding: 14,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  primaryButton: {
    height: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F766E',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  backgroundModalDescription: {
    color: '#475569',
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
    borderColor: '#E2E8F0',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#F8FAFC',
  },
  backgroundOptionButtonActive: {
    borderColor: '#2563EB',
    backgroundColor: '#DBEAFE',
  },
  backgroundOptionText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  backgroundOptionTextActive: {
    color: '#1D4ED8',
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
    backgroundColor: '#F5F5F5',
  },
  modalCancelText: {
    color: '#525252',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  modalConfirmButton: {
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#3B82F6',
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
