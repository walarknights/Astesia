import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AppPalette, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWebLayout } from '@/hooks/use-web-layout';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { isDesktopWeb } = useWebLayout();
  const isDarkMode = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        tabBarInactiveTintColor: isDarkMode ? AppPalette.textSubtle : '#687076',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: [
          styles.tabBar,
          !isDarkMode ? styles.tabBarLight : null,
          isDesktopWeb ? styles.desktopTabBar : null,
          isDesktopWeb && !isDarkMode ? styles.desktopTabBarLight : null,
        ],
        tabBarItemStyle: isDesktopWeb ? styles.desktopTabBarItem : undefined,
        tabBarLabelStyle: isDesktopWeb ? styles.desktopTabBarLabel : undefined,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="atom" color={color} />,
        }}
      />
      <Tabs.Screen
        name="personal"
        options={{
          title: 'Personal',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // [变更] 修改前: 底部导航始终使用深色玻璃栏
  // [变更] 修改后: 深色模式保留玻璃栏，浅色模式恢复原白色导航栏
  // [原因] 与首页主题切换保持一致，避免浅色模式仍出现深色底栏
  tabBar: {
    height: 62,
    paddingTop: 6,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: AppPalette.border,
    backgroundColor: 'rgba(23, 23, 38, 0.96)',
  },
  tabBarLight: {
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  desktopTabBar: {
    height: 72,
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 24,
    position: 'absolute',
    borderWidth: 1,
    borderColor: AppPalette.border,
    shadowColor: AppPalette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  desktopTabBarLight: {
    borderColor: '#E5E7EB',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  desktopTabBarItem: {
    paddingVertical: 8,
  },
  desktopTabBarLabel: {
    fontSize: 13,
  },
});
