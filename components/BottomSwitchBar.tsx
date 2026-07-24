import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { type ComponentProps, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { getProductivityPalette, type ProductivityPalette } from '@/constants/productivity-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

type SwitchBarTab = {
  icon: MaterialIconName;
  label: string;
  active: boolean;
  onPress: () => void;
};

type BottomSwitchBarProps = {
  leftTab: SwitchBarTab;
  rightTab: SwitchBarTab;
  onPressAdd: () => void;
  addIcon?: MaterialIconName;
};

export function BottomSwitchBar({
  leftTab,
  rightTab,
  onPressAdd,
  addIcon = 'add',
}: BottomSwitchBarProps) {
  const colorScheme = useColorScheme();
  const palette = getProductivityPalette(colorScheme);
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <View style={styles.bottomBar}>
      {/*
       * 渲染位置: 页面底部悬浮切换栏
       * 展示内容: 左右两个功能页签与中间新增按钮
       * 数据来源: leftTab、rightTab、onPressAdd props
       */}
      <BottomSwitchTab {...leftTab} />
      <Pressable style={styles.addButton} onPress={onPressAdd}>
        <MaterialIcons name={addIcon} size={34} color="#FFFFFF" />
      </Pressable>
      <BottomSwitchTab {...rightTab} />
    </View>
  );
}

function BottomSwitchTab({ icon, label, active, onPress }: SwitchBarTab) {
  const colorScheme = useColorScheme();
  const palette = getProductivityPalette(colorScheme);
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <Pressable style={styles.bottomTab} onPress={onPress}>
      <MaterialIcons
        name={icon}
        size={24}
        color={active ? palette.brandLight : palette.textSubtle}
      />
      <ThemedText style={[styles.bottomTabLabel, active && styles.bottomTabLabelActive]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function createStyles(palette: ProductivityPalette) {
  return StyleSheet.create({
  // [变更] 修改前: 功能切换栏固定使用深色玻璃容器
  // [变更] 修改后: 容器、文字和图标跟随生产力页面主题色板
  // [原因] 记账页浅色模式下底部导航不能继续保留深色底
  bottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingVertical: 10,
    backgroundColor: palette.toolbarBackground,
    shadowColor: palette.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  bottomTab: {
    width: 56,
    alignItems: 'center',
    gap: 4,
  },
  bottomTabLabel: {
    color: palette.textSubtle,
    fontSize: 12,
    lineHeight: 16,
  },
  bottomTabLabelActive: {
    color: palette.brandLight,
  },
  addButton: {
    width: 56,
    height: 56,
    marginTop: -24,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brand,
    shadowColor: palette.brandLight,
    shadowOpacity: 0.48,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
}
