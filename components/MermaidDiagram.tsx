import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { AppPalette } from '@/constants/theme';

const MERMAID_CDN_BASE_URL = 'https://cdn.jsdelivr.net/';
const MERMAID_SCRIPT_URL = `${MERMAID_CDN_BASE_URL}npm/mermaid@11.16.0/dist/mermaid.min.js`;
const DEFAULT_DIAGRAM_HEIGHT = 180;
const MAX_DIAGRAM_HEIGHT = 640;

type MermaidDiagramProps = {
  chart: string;
};

type MermaidWebViewMessage =
  | { type: 'height'; value: number }
  | { type: 'error'; message: string };

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const [height, setHeight] = useState(DEFAULT_DIAGRAM_HEIGHT);
  const [errorMessage, setErrorMessage] = useState('');
  const html = useMemo(() => createMermaidHtml(chart), [chart]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as MermaidWebViewMessage;

      if (message.type === 'height' && Number.isFinite(message.value)) {
        setHeight(Math.min(Math.max(message.value, 80), MAX_DIAGRAM_HEIGHT));
        return;
      }

      if (message.type === 'error') {
        setErrorMessage(message.message || 'Mermaid 图表渲染失败。');
      }
    } catch {
      setErrorMessage('Mermaid 图表返回了无法识别的渲染结果。');
    }
  }, []);

  const allowNavigation = useCallback((request: WebViewNavigation) => (
    request.url === 'about:blank' || request.url.startsWith(MERMAID_CDN_BASE_URL)
  ), []);

  if (errorMessage) {
    /*
     * 渲染位置: AI 回复中的 Mermaid 代码块
     * 展示内容: 图表错误提示和可供排查的原始 Mermaid 文本
     * 数据来源: WebView 渲染结果与 chart 属性
     */
    return (
      <View style={styles.fallback}>
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        <ThemedText style={styles.sourceText}>{chart.trim()}</ThemedText>
      </View>
    );
  }

  /*
   * 渲染位置: AI 回复中的 Mermaid 代码块
   * 展示内容: 由 Mermaid 源码生成的流程图、时序图等 SVG 图表
   * 数据来源: Markdown fence 解析得到的 chart 属性
   */
  return (
    <View style={[styles.container, { height }]}>
      <WebView
        javaScriptEnabled
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={allowNavigation}
        originWhitelist={['about:blank', `${MERMAID_CDN_BASE_URL}*`]}
        scrollEnabled={false}
        source={{ html, baseUrl: MERMAID_CDN_BASE_URL }}
        style={styles.webView}
      />
    </View>
  );
}

/**
 * 构建受限的 Mermaid WebView 文档，并安全传入图表源码。
 *
 * @param chart - Mermaid 图表源码
 * @returns 带 CSP、渲染脚本和高度回传逻辑的 HTML
 * @example
 *   createMermaidHtml('flowchart LR\nA --> B')
 */
function createMermaidHtml(chart: string) {
  const serializedChart = JSON.stringify(chart).replace(/</g, '\\u003c');

  return `
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${MERMAID_CDN_BASE_URL} 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
      #diagram { box-sizing: border-box; width: 100%; padding: 12px; }
      #diagram svg { display: block; width: 100%; max-width: 100%; height: auto; margin: 0 auto; }
    </style>
    <div id="diagram"></div>
    <script>
      const send = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));

      window.addEventListener('error', (event) => {
        send({
          type: 'error',
          message: event && event.message ? event.message : 'Mermaid 脚本加载失败。',
        });
      });
    </script>
    <script src="${MERMAID_SCRIPT_URL}"></script>
    <script>
      const source = ${serializedChart};

      if (typeof mermaid === 'undefined') {
        send({ type: 'error', message: 'Mermaid 脚本加载失败，请检查网络后重试。' });
      } else {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
        });

        mermaid.render('astesia-mermaid-diagram', source)
          .then(({ svg }) => {
            const container = document.getElementById('diagram');
            container.innerHTML = svg;
            requestAnimationFrame(() => {
              send({ type: 'height', value: Math.ceil(container.scrollHeight + 4) });
            });
          })
          .catch((error) => {
            send({
              type: 'error',
              message: error && error.message ? error.message : 'Mermaid 图表渲染失败。',
            });
          });
      }
    </script>
  `;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minWidth: 240,
    marginVertical: 8,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppPalette.border,
    backgroundColor: '#0F172A',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  fallback: {
    width: '100%',
    minWidth: 240,
    marginVertical: 8,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#1F1014',
    padding: 12,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 18,
  },
  sourceText: {
    color: '#E2E8F0',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});
