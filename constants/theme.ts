/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0A7EA4';
const brandColor = '#818CF8';

// [变更] 修改前: 浅色与深色模式都被强制为深色推广页令牌
// [变更] 修改后: 浅色模式恢复原有明亮基调，深色模式保留推广页靛青视觉
// [原因] 支持用户在当前深色模式与原来的浅色模式之间手动切换
export const Colors = {
  light: {
    text: '#11181C',
    background: '#FFFFFF',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#F8FAFC',
    background: '#0F0F1A',
    tint: brandColor,
    icon: '#94A3B8',
    tabIconDefault: '#64748B',
    tabIconSelected: brandColor,
  },
};

export const AppPalette = {
  background: '#0F0F1A',
  surface: '#171726',
  surfaceElevated: '#1E1E2E',
  surfaceSoft: 'rgba(255, 255, 255, 0.045)',
  // [变更] 修改前: 玻璃卡片使用偏亮描边并叠加品牌紫色外发光
  // [变更] 修改后: 描边降为低透明灰蓝线，投影统一走暗色阴影令牌
  // [原因] 避免深色界面出现像粗紫边一样的视觉噪点
  border: 'rgba(148, 163, 184, 0.08)',
  borderStrong: 'rgba(129, 140, 248, 0.2)',
  shadow: '#020617',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  brand: '#6366F1',
  brandDark: '#4F46E5',
  brandLight: '#818CF8',
  purple: '#8B5CF6',
  accent: '#EC4899',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** Custom IBM Plex Serif family loaded at app startup. */
    serif: 'IBMPlexSerif-Regular',
    serifBold: 'IBMPlexSerif-Bold',
    serifItalic: 'IBMPlexSerif-Italic',
    serifSemiBold: 'IBMPlexSerif-SemiBold',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'IBMPlexSerif-Regular',
    serifBold: 'IBMPlexSerif-Bold',
    serifItalic: 'IBMPlexSerif-Italic',
    serifSemiBold: 'IBMPlexSerif-SemiBold',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: 'IBMPlexSerif-Regular',
    serifBold: 'IBMPlexSerif-Bold',
    serifItalic: 'IBMPlexSerif-Italic',
    serifSemiBold: 'IBMPlexSerif-SemiBold',
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
