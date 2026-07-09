import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWebLayout } from '@/hooks/use-web-layout';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { isDesktopWeb } = useWebLayout();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: [styles.tabBar, isDesktopWeb ? styles.desktopTabBar : null],
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
  tabBar: {
    height: 62,
    paddingTop: 6,
    paddingBottom: 6,
  },
  desktopTabBar: {
    height: 72,
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 24,
    position: 'absolute',
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  desktopTabBarItem: {
    paddingVertical: 8,
  },
  desktopTabBarLabel: {
    fontSize: 13,
  },
});
