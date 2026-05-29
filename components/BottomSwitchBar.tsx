import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

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
      <MaterialIcons name={icon} size={24} color={active ? '#3B82F6' : '#9CA3AF'} />
      <ThemedText style={[styles.bottomTabLabel, active && styles.bottomTabLabelActive]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  bottomTab: {
    width: 56,
    alignItems: 'center',
    gap: 4,
  },
  bottomTabLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16,
  },
  bottomTabLabelActive: {
    color: '#3B82F6',
  },
  addButton: {
    width: 56,
    height: 56,
    marginTop: -24,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
