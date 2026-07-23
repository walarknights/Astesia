import { useCallback, useEffect, useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppPalette } from '@/constants/theme';

type MermaidDiagramProps = {
  chart: string;
};

let hasInitializedMermaid = false;

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const reactId = useId();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const renderId = `astesia-mermaid-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`;

  const setContainerRef = useCallback((node: View | null) => {
    setContainer(node as unknown as HTMLElement | null);
  }, []);

  useEffect(() => {
    let active = true;

    if (!container) {
      return () => {
        active = false;
      };
    }

    setErrorMessage('');
    container.replaceChildren();

    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        if (!hasInitializedMermaid) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'dark',
          });
          hasInitializedMermaid = true;
        }

        return mermaid.render(renderId, chart);
      })
      .then(({ svg }) => {
        if (!active) {
          return;
        }

        container.innerHTML = svg;
        const svgElement = container.querySelector('svg');
        const links = container.querySelectorAll('a');

        if (svgElement) {
          svgElement.style.display = 'block';
          svgElement.style.width = '100%';
          svgElement.style.maxWidth = '100%';
          svgElement.style.height = 'auto';
        }

        links.forEach((link) => {
          link.removeAttribute('href');
          link.setAttribute('pointer-events', 'none');
        });
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Mermaid 图表渲染失败。');
        }
      });

    return () => {
      active = false;
      container.replaceChildren();
    };
  }, [chart, container, renderId]);

  if (errorMessage) {
    /*
     * 渲染位置: Web 端 AI 回复中的 Mermaid 代码块
     * 展示内容: 图表错误提示和可供排查的原始 Mermaid 文本
     * 数据来源: Mermaid 渲染结果与 chart 属性
     */
    return (
      <View style={styles.fallback}>
        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
        <ThemedText style={styles.sourceText}>{chart.trim()}</ThemedText>
      </View>
    );
  }

  /*
   * 渲染位置: Web 端 AI 回复中的 Mermaid 代码块
   * 展示内容: 本地 Mermaid 包生成的 SVG 图表
   * 数据来源: Markdown fence 解析得到的 chart 属性
   */
  return (
    <View style={styles.container}>
      <View ref={setContainerRef} style={styles.diagram} />
    </View>
  );
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
  diagram: {
    width: '100%',
    minHeight: 120,
    padding: 12,
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
