import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AiFloatingAssistant } from '@/components/AiFloatingAssistant';
import { useColorScheme } from '@/hooks/use-color-scheme';
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

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ScreenCaptureProvider>
        {/*
         * 渲染位置: 应用根布局导航栈
         * 展示内容: 可被 AI 一键截图捕获的业务页面，不包含 AI 抽屉本身
         * 数据来源: expo-router Stack 路由页面
         */}
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
          </Stack>
        </ScreenCaptureRoot>
        {/*
         * 渲染位置: 应用根布局导航栈上层
         * 展示内容: 全局 AI 悬浮球与对话抽屉
         * 数据来源: AiFloatingAssistant 内部状态和当前路由信息
         */}
        <AiFloatingAssistant />
      </ScreenCaptureProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
