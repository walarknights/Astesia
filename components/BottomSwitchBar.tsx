import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppPalette } from '@/constants/theme';

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
  return (
    <Pressable style={styles.bottomTab} onPress={onPress}>
      <MaterialIcons
        name={icon}
        size={24}
        color={active ? AppPalette.brandLight : AppPalette.textSubtle}
      />
      <ThemedText style={[styles.bottomTabLabel, active && styles.bottomTabLabelActive]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // [变更] 修改前: 功能切换栏使用不透明白底和蓝色按钮
  // [变更] 修改后: 改为深色玻璃容器、暗色投影与靛青紫品牌按钮
  // [原因] 保持笔记、待办和记账入口与推广页视觉一致
  bottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: AppPalette.border,
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingVertical: 10,
    backgroundColor: 'rgba(23, 23, 38, 0.97)',
    shadowColor: AppPalette.shadow,
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
    color: AppPalette.textSubtle,
    fontSize: 12,
    lineHeight: 16,
  },
  bottomTabLabelActive: {
    color: AppPalette.brandLight,
  },
  addButton: {
    width: 56,
    height: 56,
    marginTop: -24,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppPalette.brand,
    shadowColor: AppPalette.brandLight,
    shadowOpacity: 0.48,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
