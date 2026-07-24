import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, View, type AlertButton } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppPalette } from '@/constants/theme';
import { useAppColorScheme } from '@/services/app-settings';

type AlertOptions = Parameters<typeof Alert.alert>[3];
type AppAlertController = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
) => void;
type QueuedAlert = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};
type AlertTheme = {
  overlay: string;
  surface: string;
  border: string;
  shadow: string;
  shadowOpacity: number;
  title: string;
  message: string;
  muted: string;
  brand: string;
  danger: string;
  pressed: string;
};
type AppAlertGlobal = typeof globalThis & {
  __ASTESIA_NATIVE_ALERT__?: typeof Alert.alert;
  __ASTESIA_ALERT_HANDLER__?: AppAlertController | null;
  __ASTESIA_ALERT_PROXY__?: typeof Alert.alert;
};

let nextAlertId = 1;
const DEFAULT_ALERT_BUTTONS: AlertButton[] = [{ text: 'OK' }];
const appAlertGlobal = globalThis as AppAlertGlobal;
const nativeAlert = appAlertGlobal.__ASTESIA_NATIVE_ALERT__ ?? Alert.alert.bind(Alert);

appAlertGlobal.__ASTESIA_NATIVE_ALERT__ = nativeAlert;

if (!appAlertGlobal.__ASTESIA_ALERT_PROXY__) {
  appAlertGlobal.__ASTESIA_ALERT_PROXY__ = (title, message, buttons, options) => {
    const activeHandler = appAlertGlobal.__ASTESIA_ALERT_HANDLER__;

    if (activeHandler) {
      activeHandler(title, message, buttons, options);
      return;
    }

    nativeAlert(title, message, buttons, options);
  };
}

// [变更] 修改前: 业务代码直接触发系统原生 Alert，Android 弹框无法统一圆角和阴影
// [变更] 修改后: 根组件挂载后由应用内 Modal 承接 Alert.alert，保留原有调用方式
// [原因] 全项目提示框需要统一使用圆角卡片和柔和投影
(Alert as unknown as { alert: typeof Alert.alert }).alert = appAlertGlobal.__ASTESIA_ALERT_PROXY__;

export function AppAlertProvider({ children }: PropsWithChildren) {
  const colorScheme = useAppColorScheme();
  const alertTheme = useMemo(() => getAlertTheme(colorScheme), [colorScheme]);
  const [alerts, setAlerts] = useState<QueuedAlert[]>([]);
  const activeAlert = alerts[0] ?? null;
  const isActiveAlertCancelable = activeAlert?.options?.cancelable === true;

  const showAlert = useCallback<AppAlertController>((title, message, buttons, options) => {
    const alertId = nextAlertId;
    nextAlertId += 1;

    setAlerts((currentAlerts) => [
      ...currentAlerts,
      {
        id: alertId,
        title,
        message,
        buttons: normalizeAlertButtons(buttons),
        options,
      },
    ]);
  }, []);

  const closeActiveAlert = useCallback(() => {
    setAlerts((currentAlerts) => currentAlerts.slice(1));
  }, []);

  const dismissActiveAlert = useCallback(() => {
    if (!activeAlert || !isActiveAlertCancelable) {
      return;
    }

    closeActiveAlert();
    activeAlert.options?.onDismiss?.();
  }, [activeAlert, closeActiveAlert, isActiveAlertCancelable]);

  const pressButton = useCallback(
    (button: AlertButton) => {
      closeActiveAlert();
      button.onPress?.();
    },
    [closeActiveAlert]
  );

  useEffect(() => {
    appAlertGlobal.__ASTESIA_ALERT_HANDLER__ = showAlert;

    return () => {
      if (appAlertGlobal.__ASTESIA_ALERT_HANDLER__ === showAlert) {
        appAlertGlobal.__ASTESIA_ALERT_HANDLER__ = null;
      }
    };
  }, [showAlert]);

  return (
    <>
      {children}
      {/*
       * 渲染位置: 应用根布局最顶层的全局提示弹窗
       * 展示内容: Alert.alert 触发的标题、说明文案和操作按钮
       * 数据来源: 全局 Alert 代理写入的 alerts 队列
       */}
      <Modal
        animationType="fade"
        statusBarTranslucent
        transparent
        visible={activeAlert !== null}
        onRequestClose={dismissActiveAlert}>
        <View style={[styles.overlay, { backgroundColor: alertTheme.overlay }]}>
          <Pressable
            accessibilityRole="button"
            disabled={!isActiveAlertCancelable}
            style={StyleSheet.absoluteFill}
            onPress={dismissActiveAlert}
          />
          {activeAlert ? (
            <View
              accessibilityRole="alert"
              accessibilityViewIsModal
              style={[
                styles.card,
                {
                  borderColor: alertTheme.border,
                  backgroundColor: alertTheme.surface,
                  shadowColor: alertTheme.shadow,
                  shadowOpacity: alertTheme.shadowOpacity,
                },
              ]}>
              <ThemedText style={[styles.title, { color: alertTheme.title }]}>{activeAlert.title}</ThemedText>
              {activeAlert.message ? (
                <ThemedText style={[styles.message, { color: alertTheme.message }]}>
                  {activeAlert.message}
                </ThemedText>
              ) : null}
              <View style={styles.buttonRow}>
                {activeAlert.buttons.map((button, index) => {
                  const buttonLabel = button.text || 'OK';
                  const buttonColor = getButtonColor(button, alertTheme);

                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={`${activeAlert.id}-${buttonLabel}-${index}`}
                      style={({ pressed }) => [
                        styles.button,
                        pressed ? { backgroundColor: alertTheme.pressed } : null,
                      ]}
                      onPress={() => pressButton(button)}>
                      <ThemedText style={[styles.buttonText, { color: buttonColor }]}>
                        {buttonLabel}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

function normalizeAlertButtons(buttons?: AlertButton[]) {
  if (!buttons || buttons.length === 0) {
    return DEFAULT_ALERT_BUTTONS;
  }

  return buttons;
}

function getButtonColor(button: AlertButton, alertTheme: AlertTheme) {
  if (button.style === 'destructive') {
    return alertTheme.danger;
  }

  if (button.style === 'cancel') {
    return alertTheme.muted;
  }

  return alertTheme.brand;
}

function getAlertTheme(colorScheme: 'light' | 'dark'): AlertTheme {
  if (colorScheme === 'light') {
    return {
      overlay: 'rgba(15, 23, 42, 0.38)',
      surface: '#FFFFFF',
      border: 'rgba(226, 232, 240, 0.92)',
      shadow: '#0F172A',
      shadowOpacity: 0.18,
      title: '#0F172A',
      message: '#334155',
      muted: '#64748B',
      brand: AppPalette.brandDark,
      danger: '#DC2626',
      pressed: 'rgba(15, 23, 42, 0.06)',
    };
  }

  return {
    overlay: 'rgba(2, 2, 8, 0.72)',
    surface: AppPalette.surfaceElevated,
    border: AppPalette.border,
    shadow: AppPalette.shadow,
    shadowOpacity: 0.28,
    title: AppPalette.text,
    message: AppPalette.textMuted,
    muted: AppPalette.textSubtle,
    brand: AppPalette.brandLight,
    danger: AppPalette.danger,
    pressed: 'rgba(255, 255, 255, 0.08)',
  };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    minHeight: 172,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 30,
  },
  message: {
    marginTop: 14,
    fontSize: 16,
    lineHeight: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 'auto',
    paddingTop: 26,
  },
  button: {
    minWidth: 64,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 16,
    ...Platform.select({
      web: {
        cursor: 'pointer',
      },
      default: null,
    }),
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
});
