import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="notes" options={{ title: '笔记' }} />
        <Stack.Screen name="accounting" options={{ title: '记账' }} />
        <Stack.Screen name="todo" options={{ title: '待办' }} />
        <Stack.Screen name="weather-search" options={{ headerShown: false }} />
        <Stack.Screen name="weather-overview" options={{ title: '今日概览' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
