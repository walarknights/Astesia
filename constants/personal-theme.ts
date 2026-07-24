import { AppPalette } from '@/constants/theme';

export type PersonalThemeKey = 'light' | 'dark';

export type PersonalSurfacePalette = {
  headerBackground: string;
  headerOverlay: string;
  cardBackground: string;
  cardBorder: string;
  divider: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  icon: string;
  iconBadgeBackground: string;
  iconBadgeColor: string;
  dangerIconBadgeBackground: string;
  dangerText: string;
  modalBackdrop: string;
  modalBackground: string;
  inputBackground: string;
  inputBorder: string;
  placeholder: string;
  chipBackground: string;
  chipActiveBackground: string;
  chipActiveBorder: string;
  chipActiveText: string;
  softButtonBackground: string;
  brand: string;
  brandLight: string;
  purple: string;
  avatarBackground: string;
  shadowColor: string;
  cardShadowOpacity: number;
};

// [变更] 新增: 个人页独立浅/深表面色板
// [原因] 个人页历史样式大量复用深色 AppPalette，浅色模式下需要深色文字和明确灰色描边
export const PERSONAL_SURFACE_PALETTE: Record<PersonalThemeKey, PersonalSurfacePalette> = {
  light: {
    headerBackground: '#F8FAFC',
    headerOverlay: 'rgba(15, 23, 42, 0.34)',
    cardBackground: '#FFFFFF',
    cardBorder: '#CBD5E1',
    divider: '#E2E8F0',
    text: '#0F172A',
    textMuted: '#475569',
    textSubtle: '#64748B',
    icon: '#64748B',
    iconBadgeBackground: '#E0E7FF',
    iconBadgeColor: AppPalette.brand,
    dangerIconBadgeBackground: '#FEE2E2',
    dangerText: '#DC2626',
    modalBackdrop: 'rgba(15, 23, 42, 0.38)',
    modalBackground: '#FFFFFF',
    inputBackground: '#F8FAFC',
    inputBorder: '#CBD5E1',
    placeholder: '#94A3B8',
    chipBackground: '#F8FAFC',
    chipActiveBackground: '#EEF2FF',
    chipActiveBorder: AppPalette.brandLight,
    chipActiveText: AppPalette.brandDark,
    softButtonBackground: '#F1F5F9',
    brand: AppPalette.brand,
    brandLight: AppPalette.brandLight,
    purple: AppPalette.purple,
    avatarBackground: '#EEF2FF',
    shadowColor: '#0F172A',
    cardShadowOpacity: 0.06,
  },
  dark: {
    headerBackground: AppPalette.background,
    headerOverlay: 'rgba(15, 15, 26, 0.46)',
    cardBackground: AppPalette.surfaceSoft,
    cardBorder: AppPalette.border,
    divider: AppPalette.border,
    text: AppPalette.text,
    textMuted: AppPalette.textMuted,
    textSubtle: AppPalette.textSubtle,
    icon: AppPalette.textMuted,
    iconBadgeBackground: 'rgba(99, 102, 241, 0.18)',
    iconBadgeColor: '#FFFFFF',
    dangerIconBadgeBackground: '#FEE2E2',
    dangerText: '#DC2626',
    modalBackdrop: 'rgba(2, 2, 8, 0.74)',
    modalBackground: AppPalette.surfaceElevated,
    inputBackground: AppPalette.surface,
    inputBorder: AppPalette.borderStrong,
    placeholder: '#94A3B8',
    chipBackground: AppPalette.surfaceSoft,
    chipActiveBackground: 'rgba(99, 102, 241, 0.20)',
    chipActiveBorder: AppPalette.brandLight,
    chipActiveText: AppPalette.brandLight,
    softButtonBackground: AppPalette.surfaceSoft,
    brand: AppPalette.brand,
    brandLight: AppPalette.brandLight,
    purple: AppPalette.purple,
    avatarBackground: AppPalette.surfaceElevated,
    shadowColor: AppPalette.shadow,
    cardShadowOpacity: 0.1,
  },
};

export function getPersonalSurfacePalette(colorScheme: PersonalThemeKey) {
  return PERSONAL_SURFACE_PALETTE[colorScheme];
}
