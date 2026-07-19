import { useEffect, useState } from 'react';

import { useAppColorScheme } from '@/services/app-settings';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // [变更] 修改前: Web 端直接读取系统主题，忽略 App 内保存的主题偏好
  // [变更] 修改后: 水合后统一使用 AppSettingsProvider 解析出的主题
  // [原因] 首页深浅切换需要同步影响 Web 外壳、底部 Tab 与页面内容
  const colorScheme = useAppColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
