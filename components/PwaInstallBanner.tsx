import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { storage } from '@/services/storage';

const PWA_INSTALL_BANNER_DISMISSED_KEY = 'astesia-pwa-install-banner-dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandaloneDisplayMode() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

export function PwaInstallBanner() {
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(true);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    setIsInstalled(isStandaloneDisplayMode());

    const syncDismissedState = async () => {
      const dismissedValue = await storage.getItem(PWA_INSTALL_BANNER_DISMISSED_KEY);
      setIsDismissed(dismissedValue === '1');
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      void storage.removeItem(PWA_INSTALL_BANNER_DISMISSED_KEY);
      setIsDismissed(false);
    };

    const handleInstalled = () => {
      setInstallPromptEvent(null);
      setIsInstalled(true);
      setIsDismissed(true);
      void storage.setItem(PWA_INSTALL_BANNER_DISMISSED_KEY, '1');
    };

    void syncDismissedState();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const canRegisterServiceWorker = window.location.protocol === 'https:' || window.location.hostname === 'localhost';

    if (!canRegisterServiceWorker) {
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(
        registrations.map((registration) => registration.unregister())
      )).catch(() => {});
      return;
    }

    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installPromptEvent) {
      return;
    }

    await installPromptEvent.prompt();
    const choiceResult = await installPromptEvent.userChoice;
    setInstallPromptEvent(null);

    if (choiceResult.outcome === 'accepted') {
      setIsDismissed(true);
      await storage.setItem(PWA_INSTALL_BANNER_DISMISSED_KEY, '1');
      return;
    }

    setIsDismissed(true);
    await storage.setItem(PWA_INSTALL_BANNER_DISMISSED_KEY, '1');
  }, [installPromptEvent]);

  const handleDismiss = useCallback(async () => {
    setIsDismissed(true);
    await storage.setItem(PWA_INSTALL_BANNER_DISMISSED_KEY, '1');
  }, []);

  const shouldShowBanner = useMemo(
    () => Platform.OS === 'web' && !isInstalled && !isDismissed && Boolean(installPromptEvent),
    [installPromptEvent, isDismissed, isInstalled]
  );

  if (!shouldShowBanner) {
    return null;
  }

  return (
    /*
     * 渲染位置: 应用根布局底部悬浮区域
     * 展示内容: PWA 安装提示条，支持一键安装和关闭
     * 数据来源: beforeinstallprompt 浏览器事件与本地存储中的关闭状态
     */
    <View pointerEvents="box-none" style={styles.wrapper}>
      <View style={styles.banner}>
        <View style={styles.content}>
          <View style={styles.iconWrapper}>
            <MaterialIcons name="install-mobile" size={18} color="#7C3AED" />
          </View>
          <View style={styles.textGroup}>
            <ThemedText style={styles.title}>安装 Astesia</ThemedText>
            <ThemedText style={styles.description}>添加到主屏幕后可获得更接近原生应用的启动体验。</ThemedText>
          </View>
        </View>
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" onPress={() => void handleDismiss()} style={styles.ghostButton}>
            <ThemedText style={styles.ghostButtonText}>稍后</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void handleInstall()} style={styles.primaryButton}>
            <ThemedText style={styles.primaryButtonText}>安装</ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    paddingHorizontal: 16,
    zIndex: 30,
  },
  banner: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#7C3AED',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    gap: 12,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E8FF',
  },
  textGroup: {
    flex: 1,
  },
  title: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  description: {
    marginTop: 3,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  ghostButton: {
    minWidth: 64,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
  },
  ghostButtonText: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  primaryButton: {
    minWidth: 72,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: '#7C3AED',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
});
