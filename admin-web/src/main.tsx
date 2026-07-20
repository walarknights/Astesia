import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './global.scss';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('管理端根节点不存在。');
}

createRoot(rootElement).render(
  <StrictMode>
    {/*
     * 渲染位置: admin-web 的 HTML 根节点
     * 展示内容: Astesia 独立管理端应用
     * 数据来源: App 内部会话与管理接口状态
     */}
    <App />
  </StrictMode>,
);
