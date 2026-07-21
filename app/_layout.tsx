import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AiFloatingAssistant } from '@/components/AiFloatingAssistant';
import { PwaInstallBanner } from '@/components/PwaInstallBanner';
import { AppPalette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DESKTOP_WEB_MAX_WIDTH, useWebLayout } from '@/hooks/use-web-layout';
import { AppSettingsProvider } from '@/services/app-settings';
import { ScreenCaptureProvider, ScreenCaptureRoot } from '@/services/screen-capture';

void SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const [loaded] = useFonts({
    'IBMPlexSerif-Bold': require('@/assets/fonts/IBMPlexSerif-Bold.ttf'),
    'IBMPlexSerif-BoldItalic': require('@/assets/fonts/IBMPlexSerif-BoldItalic.ttf'),
    'IBMPlexSerif-ExtraLight': require('@/assets/fonts/IBMPlexSerif-ExtraLight.ttf'),
    'IBMPlexSerif-ExtraLightItalic': require('@/assets/fonts/IBMPlexSerif-ExtraLightItalic.ttf'),
    'IBMPlexSerif-Italic': require('@/assets/fonts/IBMPlexSerif-Italic.ttf'),
    'IBMPlexSerif-Light': require('@/assets/fonts/IBMPlexSerif-Light.ttf'),
    'IBMPlexSerif-LightItalic': require('@/assets/fonts/IBMPlexSerif-LightItalic.ttf'),
    'IBMPlexSerif-Medium': require('@/assets/fonts/IBMPlexSerif-Medium.ttf'),
    'IBMPlexSerif-MediumItalic': require('@/assets/fonts/IBMPlexSerif-MediumItalic.ttf'),
    'IBMPlexSerif-Regular': require('@/assets/fonts/IBMPlexSerif-Regular.ttf'),
    'IBMPlexSerif-SemiBold': require('@/assets/fonts/IBMPlexSerif-SemiBold.ttf'),
    'IBMPlexSerif-SemiBoldItalic': require('@/assets/fonts/IBMPlexSerif-SemiBoldItalic.ttf'),
    'IBMPlexSerif-Thin': require('@/assets/fonts/IBMPlexSerif-Thin.ttf'),
    'IBMPlexSerif-ThinItalic': require('@/assets/fonts/IBMPlexSerif-ThinItalic.ttf'),
  });

  useEffect(() => {
    if (loaded) {
      void SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <AppSettingsProvider>
      <RootNavigator />
    </AppSettingsProvider>
  );
}

function RootNavigator() {
  const colorScheme = useColorScheme();
  const { isDesktopWeb } = useWebLayout();
  const isDarkMode = colorScheme === 'dark';
  const navigationTheme = isDarkMode
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: AppPalette.brandLight,
          background: AppPalette.background,
          card: AppPalette.surface,
          text: AppPalette.text,
          border: AppPalette.border,
          notification: AppPalette.accent,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          primary: '#0A7EA4',
          background: '#FFFFFF',
          card: '#FFFFFF',
          text: '#11181C',
          border: '#E5E7EB',
          notification: AppPalette.accent,
        },
      };

  const stackContent = (
    <ScreenCaptureRoot>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="notes" options={{ title: '笔记' }} />
        <Stack.Screen name="note-editor" options={{ title: '编写笔记' }} />
        <Stack.Screen name="accounting" options={{ title: '记账' }} />
        <Stack.Screen name="accounting-entry" options={{ title: '账单录入' }} />
        <Stack.Screen name="todo" options={{ title: '待办' }} />
        <Stack.Screen name="weather-search" options={{ headerShown: false }} />
        <Stack.Screen name="weather-overview" options={{ title: '今日概览' }} />
        <Stack.Screen name="account-management" options={{ title: '账号管理' }} />
      </Stack>
    </ScreenCaptureRoot>
  );

  return (
    <ThemeProvider value={navigationTheme}>
      <ScreenCaptureProvider>
        {/*
         * 渲染位置: 应用根布局中部的主内容区域
         * 展示内容: 桌面 Web 下带背景与圆角阴影的应用壳子，其余端保持原始全屏页面
         * 数据来源: useWebLayout 的桌面端判定结果与 expo-router Stack 路由页面
         */}
        {isDesktopWeb ? (
          <View style={[styles.desktopCanvas, !isDarkMode ? styles.desktopCanvasLight : null]}>
            <View style={[styles.desktopShell, !isDarkMode ? styles.desktopShellLight : null]}>
              {stackContent}
            </View>
          </View>
        ) : (
          stackContent
        )}
        {/*
         * 渲染位置: 应用根布局导航栈上层
         * 展示内容: 全局 AI 悬浮球与对话抽屉
         * 数据来源: AiFloatingAssistant 内部状态和当前路由信息
         */}
        <AiFloatingAssistant />
        {/*
         * 渲染位置: 应用根布局最上层浮层区域
         * 展示内容: 仅在 Web / PWA 可安装场景出现的安装提示条
         * 数据来源: 浏览器 beforeinstallprompt 事件与本地关闭状态
         */}
        <PwaInstallBanner />
      </ScreenCaptureProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  // [变更] 修改前: 桌面端始终使用深色推广页外壳
  // [变更] 修改后: 根据主题模式在深色外壳与原浅色外壳之间切换
  // [原因] 首页新增主题切换后，Web 外层容器也需要同步视觉模式
  desktopCanvas: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    backgroundColor: AppPalette.background,
  },
  desktopShell: {
    flex: 1,
    width: '100%',
    maxWidth: DESKTOP_WEB_MAX_WIDTH,
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: AppPalette.surface,
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  desktopCanvasLight: {
    backgroundColor: '#E2E8F0',
  },
  desktopShellLight: {
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 28,
  },
});
