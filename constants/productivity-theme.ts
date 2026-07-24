import { AppPalette } from '@/constants/theme';

export type ProductivityThemeKey = 'light' | 'dark';

export type ProductivityPalette = {
  background: string;
  gradientStart: string;
  gradientMiddle: string;
  gradientEnd: string;
  surface: string;
  surfaceElevated: string;
  surfaceSoft: string;
  border: string;
  borderStrong: string;
  divider: string;
  shadow: string;
  shadowOpacity: number;
  text: string;
  textMuted: string;
  textSubtle: string;
  brand: string;
  brandLight: string;
  brandSoft: string;
  brandBorder: string;
  overlay: string;
  toolbarBackground: string;
  blockquoteBackground: string;
};

// [变更] 修改前: 笔记、富文本编辑器和待办页直接复用固定深色 AppPalette
// [变更] 修改后: 三个关联页面共享可按应用设置切换的浅/深色表面令牌
// [原因] 避免浅色模式进入生产力功能后仍显示深色背景和浅色描边
export const PRODUCTIVITY_PALETTE: Record<ProductivityThemeKey, ProductivityPalette> = {
  light: {
    background: '#F8FAFC',
    gradientStart: '#EEF2FF',
    gradientMiddle: '#F8FAFC',
    gradientEnd: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceSoft: '#F1F5F9',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    divider: '#E2E8F0',
    shadow: '#0F172A',
    shadowOpacity: 0.06,
    text: '#0F172A',
    textMuted: '#475569',
    textSubtle: '#64748B',
    brand: AppPalette.brand,
    brandLight: AppPalette.brandDark,
    brandSoft: '#EEF2FF',
    brandBorder: '#C7D2FE',
    overlay: 'rgba(15, 23, 42, 0.38)',
    toolbarBackground: 'rgba(255, 255, 255, 0.96)',
    blockquoteBackground: '#F8FAFC',
  },
  dark: {
    background: AppPalette.background,
    gradientStart: '#1E1E3A',
    gradientMiddle: '#171726',
    gradientEnd: AppPalette.background,
    surface: AppPalette.surface,
    surfaceElevated: AppPalette.surfaceElevated,
    surfaceSoft: AppPalette.surfaceSoft,
    border: AppPalette.border,
    borderStrong: AppPalette.borderStrong,
    divider: 'rgba(255, 255, 255, 0.09)',
    shadow: AppPalette.shadow,
    shadowOpacity: 0.12,
    text: AppPalette.text,
    textMuted: AppPalette.textMuted,
    textSubtle: AppPalette.textSubtle,
    brand: AppPalette.brand,
    brandLight: AppPalette.brandLight,
    brandSoft: 'rgba(99, 102, 241, 0.18)',
    brandBorder: 'rgba(129, 140, 248, 0.34)',
    overlay: 'rgba(2, 2, 8, 0.74)',
    toolbarBackground: 'rgba(30, 30, 46, 0.96)',
    blockquoteBackground: 'rgba(255, 255, 255, 0.05)',
  },
};

/**
 * 返回笔记与待办功能在指定主题下的统一色板。
 *
 * @param colorScheme - 应用当前解析后的浅色或深色模式
 * @returns 对应模式的生产力页面颜色令牌
 * @example
 *   getProductivityPalette('light').background
 */
export function getProductivityPalette(colorScheme: ProductivityThemeKey) {
  return PRODUCTIVITY_PALETTE[colorScheme];
}
