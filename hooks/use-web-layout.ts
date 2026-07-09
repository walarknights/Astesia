import { Platform, useWindowDimensions } from 'react-native';

export const DESKTOP_WEB_BREAKPOINT = 1024;
export const DESKTOP_WEB_MAX_WIDTH = 1280;
export const DESKTOP_WEB_CONTENT_MAX_WIDTH = 1100;

/**
 * 统一返回 Web 端的布局断点信息，避免各页面重复散落响应式判断。
 *
 * @example
 *   const { isDesktopWeb } = useWebLayout();
 */
export function useWebLayout() {
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= DESKTOP_WEB_BREAKPOINT;

  return {
    width,
    isDesktopWeb,
  };
}
