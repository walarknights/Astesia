import { ScrollViewStyleReset } from 'expo-router/html';

type RootHtmlProps = {
  children: React.ReactNode;
};

export default function RootHtml({ children }: RootHtmlProps) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="application-name" content="Astesia" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Astesia" />
        <meta name="description" content="Astesia 是一个集天气、笔记、记账、待办与 AI 助手于一体的轻量生活应用。" />
        <meta name="theme-color" content="#0F0F1A" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
