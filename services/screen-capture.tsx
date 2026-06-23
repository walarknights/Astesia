import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

type ScreenCaptureContextValue = {
  captureAppScreen: () => Promise<string>;
  captureRootRef: RefObject<View | null>;
};

const ScreenCaptureContext = createContext<ScreenCaptureContextValue | null>(null);

export function ScreenCaptureProvider({ children }: { children: ReactNode }) {
  const captureRootRef = useRef<View>(null);

  const captureAppScreen = useCallback(async () => {
    if (Platform.OS === 'web') {
      throw new Error('当前 Web 环境暂不支持一键截图，请在 iOS 或 Android App 中使用。');
    }

    if (!captureRootRef.current) {
      throw new Error('当前页面还没有准备好截图，请稍后重试。');
    }

    return captureRef(captureRootRef, {
      format: 'jpg',
      quality: 0.78,
      result: 'tmpfile',
    });
  }, []);

  const contextValue = useMemo(
    () => ({ captureAppScreen, captureRootRef }),
    [captureAppScreen, captureRootRef]
  );

  return (
    <ScreenCaptureContext.Provider value={contextValue}>
      {children}
    </ScreenCaptureContext.Provider>
  );
}

export function ScreenCaptureRoot({ children }: { children: ReactNode }) {
  const { captureRootRef } = useScreenCaptureContext();

  return (
    /*
     * 渲染位置: App 导航页面根容器
     * 展示内容: 被一键截图能力捕获的真实业务页面
     * 数据来源: RootNavigator 传入的 Stack 页面节点
     */
    <View ref={captureRootRef} collapsable={false} style={styles.captureRoot}>
      {children}
    </View>
  );
}

export function useScreenCapture() {
  const { captureAppScreen } = useScreenCaptureContext();

  return { captureAppScreen };
}

function useScreenCaptureContext() {
  const contextValue = useContext(ScreenCaptureContext);

  if (!contextValue) {
    throw new Error('useScreenCapture 必须在 ScreenCaptureProvider 内使用。');
  }

  return contextValue;
}

const styles = StyleSheet.create({
  captureRoot: {
    flex: 1,
  },
});
