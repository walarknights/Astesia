import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { sanitizeNoteContentHtml } from '@/services/note-html';

type NoteRichTextEditorProps = {
  initialHtml: string;
  insertedImageUri?: string;
  insertedImageToken?: string;
  placeholder?: string;
  onChangeHtml?: (html: string) => Promise<void>;
};

type EditorMessage =
  | { type: 'ready' }
  | { type: 'height'; height?: unknown }
  | { type: 'change'; html?: unknown };

const EMPTY_HTML = '<p></p>';
const MIN_EDITOR_HEIGHT = 560;

export default function NoteRichTextEditor({
  initialHtml,
  insertedImageUri,
  insertedImageToken,
  placeholder = '开始写下今天的想法...',
  onChangeHtml,
}: NoteRichTextEditorProps) {
  const [webView, setWebView] = useState<WebView | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const [lastInsertedImageToken, setLastInsertedImageToken] = useState('');
  // [变更] 修改前: 每次输入回写 note.contentHtml 后都会重建 WebView source，导致焦点和拼音组合态被打断
  // [变更] 修改后: WebView HTML 只在组件挂载时生成一次，后续输入仅通过 postMessage 同步给 React Native
  // [原因] Android 输入法需要稳定的 WebView 页面才能连续输入中文拼音
  const [editorSource] = useState(() => ({
    // [变更] 修改前: initialHtml 原样进入 WebView 后由 innerHTML 渲染
    // [变更] 修改后: WebView 文档生成前先执行笔记 HTML 白名单清洗
    // [原因] 历史缓存或导入文件可能包含脚本、事件属性和远程资源
    html: buildEditorDocument(sanitizeNoteContentHtml(initialHtml || EMPTY_HTML), placeholder),
  }));

  const handleEditorRef = useCallback((nextWebView: WebView | null) => {
    setWebView(nextWebView);
  }, []);
  const allowEditorNavigation = useCallback((request: WebViewNavigation) => (
    request.url === 'about:blank'
  ), []);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseEditorMessage(event.nativeEvent.data);

    if (!message) {
      return;
    }

    if (message.type === 'ready') {
      setIsEditorReady(true);
      return;
    }

    if (message.type === 'height') {
      const nextHeight = Number(message.height);

      if (Number.isFinite(nextHeight)) {
        setEditorHeight(Math.max(MIN_EDITOR_HEIGHT, Math.ceil(nextHeight)));
      }

      return;
    }

    if (message.type === 'change' && typeof message.html === 'string') {
      void onChangeHtml?.(message.html);
    }
  }, [onChangeHtml]);

  useEffect(() => {
    if (!webView || !isEditorReady || !insertedImageUri || !insertedImageToken) {
      return;
    }

    if (insertedImageToken === lastInsertedImageToken) {
      return;
    }

    // [变更] 修改前: 原生端依赖 Expo DOM Component effect 把图片插入 Tiptap
    // [变更] 修改后: 直接向稳定的 WebView 编辑器注入插图命令
    // [原因] 避免 DOM Component 初始化失败时，插图与正文编辑整体不可用
    webView.injectJavaScript(
      `window.__ASTESIA_EDITOR__?.insertImage(${serializeForInlineScript(insertedImageUri)});true;`
    );
    setLastInsertedImageToken(insertedImageToken);
  }, [insertedImageToken, insertedImageUri, isEditorReady, lastInsertedImageToken, webView]);

  return (
    <View style={[styles.container, { height: editorHeight }]}>
      {/*
       * 渲染位置: 原生笔记编辑页富文本卡片内
       * 展示内容: WebView 承载的富文本工具栏、正文编辑区和插入图片结果
       * 数据来源: initialHtml、insertedImageUri、insertedImageToken 与编辑器 postMessage
       */}
      <WebView
        ref={handleEditorRef}
        originWhitelist={['about:blank']}
        javaScriptEnabled
        domStorageEnabled
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        onShouldStartLoadWithRequest={allowEditorNavigation}
        scrollEnabled={false}
        source={editorSource}
        style={styles.webView}
        onMessage={handleMessage}
      />
    </View>
  );
}

function parseEditorMessage(value: string): EditorMessage | null {
  try {
    const parsedValue = JSON.parse(value) as Partial<EditorMessage>;

    if (parsedValue.type === 'ready' || parsedValue.type === 'height' || parsedValue.type === 'change') {
      return parsedValue as EditorMessage;
    }
  } catch {
    return null;
  }

  return null;
}

function serializeForInlineScript(value: string) {
  return JSON.stringify(value).replace(/</g, '\\u003C');
}

function buildEditorDocument(initialHtml: string, placeholder: string) {
  const serializedInitialHtml = serializeForInlineScript(initialHtml);
  const serializedPlaceholder = serializeForInlineScript(placeholder);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none';"
  />
  <style>
    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    html,
    body {
      margin: 0;
      min-height: 100%;
      overflow: hidden;
      color: #f8fafc;
      background: #171726;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    .editor-shell {
      min-height: ${MIN_EDITOR_HEIGHT}px;
      background: #171726;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.09);
      background: rgba(30, 30, 46, 0.96);
      backdrop-filter: blur(14px);
    }

    .toolbar-button {
      min-height: 34px;
      border: 1px solid rgba(129, 140, 248, 0.34);
      border-radius: 999px;
      padding: 7px 12px;
      color: #818cf8;
      background: rgba(99, 102, 241, 0.18);
      font-size: 13px;
      font-weight: 700;
    }

    .toolbar-divider {
      width: 1px;
      min-height: 30px;
      background: rgba(255, 255, 255, 0.09);
    }

    #editor {
      min-height: 420px;
      padding: 18px;
      outline: none;
      color: #f8fafc;
      font-size: 18px;
      line-height: 1.72;
      word-break: break-word;
      -webkit-user-select: text;
      user-select: text;
    }

    #editor:empty::before {
      content: attr(data-placeholder);
      color: #64748b;
      pointer-events: none;
    }

    #editor p {
      margin: 0 0 14px;
    }

    #editor h1,
    #editor h2,
    #editor h3 {
      margin: 20px 0 12px;
      color: #f8fafc;
      line-height: 1.25;
    }

    #editor h1 {
      font-size: 30px;
    }

    #editor h2 {
      font-size: 25px;
    }

    #editor h3 {
      font-size: 22px;
    }

    #editor ul,
    #editor ol {
      margin: 0 0 16px;
      padding-left: 24px;
    }

    #editor blockquote {
      margin: 16px 0;
      border-left: 4px solid #c4b5fd;
      padding: 8px 14px;
      border-radius: 10px;
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.05);
    }

    #editor img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 16px auto;
      border-radius: 18px;
    }
  </style>
</head>
<body>
  <div class="editor-shell">
    <div class="toolbar" aria-label="富文本编辑工具栏">
      <button class="toolbar-button" type="button" data-command="bold">B</button>
      <button class="toolbar-button" type="button" data-command="italic">I</button>
      <button class="toolbar-button" type="button" data-command="underline">U</button>
      <button class="toolbar-button" type="button" data-command="strikeThrough">S</button>
      <span class="toolbar-divider"></span>
      <button class="toolbar-button" type="button" data-block="H1">H1</button>
      <button class="toolbar-button" type="button" data-block="H2">H2</button>
      <button class="toolbar-button" type="button" data-block="H3">H3</button>
      <button class="toolbar-button" type="button" data-block="P">正文</button>
      <span class="toolbar-divider"></span>
      <button class="toolbar-button" type="button" data-command="insertUnorderedList">• 列表</button>
      <button class="toolbar-button" type="button" data-command="insertOrderedList">1. 列表</button>
      <button class="toolbar-button" type="button" data-block="BLOCKQUOTE">引用</button>
      <span class="toolbar-divider"></span>
      <button class="toolbar-button" type="button" data-command="undo">撤销</button>
      <button class="toolbar-button" type="button" data-command="redo">重做</button>
    </div>
    <div
      id="editor"
      contenteditable="true"
      inputmode="text"
      lang="zh-CN"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      spellcheck="false"
      data-placeholder=""></div>
  </div>
  <script>
    const initialHtml = ${serializedInitialHtml};
    const placeholder = ${serializedPlaceholder};
    const editor = document.getElementById('editor');
    let lastHtml = '';
    let isComposing = false;

    function postMessage(payload) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }

    function normalizeHtml() {
      const html = editor.innerHTML.trim();
      return html || '${EMPTY_HTML}';
    }

    function isEmptyEditorHtml(html) {
      return !html || html.trim() === '${EMPTY_HTML}';
    }

    function emitHeight() {
      const height = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        ${MIN_EDITOR_HEIGHT}
      );
      postMessage({ type: 'height', height });
    }

    function emitChange() {
      if (isComposing) {
        return;
      }

      const html = normalizeHtml();

      if (html !== lastHtml) {
        lastHtml = html;
        postMessage({ type: 'change', html });
      }

      requestAnimationFrame(emitHeight);
    }

    function focusEditor() {
      editor.focus({ preventScroll: true });
    }

    function runCommand(command) {
      focusEditor();
      document.execCommand(command, false);
      emitChange();
    }

    function setBlock(blockName) {
      focusEditor();
      document.execCommand('formatBlock', false, blockName);
      emitChange();
    }

    function handleCompositionStart() {
      isComposing = true;
    }

    function handleCompositionEnd() {
      isComposing = false;
      emitChange();
    }

    function appendImage(src) {
      const wrapper = document.createElement('p');
      const image = document.createElement('img');
      image.src = src;
      image.alt = '笔记图片';
      wrapper.appendChild(image);
      editor.appendChild(wrapper);
      editor.appendChild(document.createElement('p'));
    }

    function insertImage(src) {
      if (!src) {
        return;
      }

      focusEditor();
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
        appendImage(src);
        emitChange();
        return;
      }

      const range = selection.getRangeAt(0);
      const wrapper = document.createElement('p');
      const image = document.createElement('img');
      const trailingParagraph = document.createElement('p');
      image.src = src;
      image.alt = '笔记图片';
      wrapper.appendChild(image);
      trailingParagraph.appendChild(document.createElement('br'));
      range.deleteContents();
      range.insertNode(trailingParagraph);
      range.insertNode(wrapper);
      range.setStart(trailingParagraph, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      emitChange();
    }

    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => runCommand(button.dataset.command));
    });

    document.querySelectorAll('[data-block]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => setBlock(button.dataset.block));
    });

    editor.dataset.placeholder = placeholder;
    editor.innerHTML = isEmptyEditorHtml(initialHtml) ? '' : initialHtml;
    lastHtml = normalizeHtml();
    // [变更] 修改前: 每次 input 都立即回传 HTML，Android 拼音组合期间可能被 WebView 打断
    // [变更] 修改后: compositionstart/end 期间暂停同步，等候选词上屏后再回传
    // [原因] 让中文输入法保留拼音候选态，避免编辑器把组合输入当成普通英文字母
    editor.addEventListener('compositionstart', handleCompositionStart);
    editor.addEventListener('compositionend', handleCompositionEnd);
    editor.addEventListener('input', emitChange);
    editor.addEventListener('keyup', emitChange);
    editor.addEventListener('mouseup', emitHeight);
    window.addEventListener('resize', emitHeight);
    document.querySelectorAll('img').forEach((image) => {
      image.addEventListener('load', emitHeight);
    });

    if (window.ResizeObserver) {
      new ResizeObserver(emitHeight).observe(document.body);
    }

    window.__ASTESIA_EDITOR__ = { insertImage };
    requestAnimationFrame(() => {
      emitHeight();
      postMessage({ type: 'ready' });
    });
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  // [变更] 修改前: 原生富文本 WebView 使用白色底
  // [变更] 修改后: 使用与编辑器卡片一致的深色表面
  // [原因] 避免正文区域在深色主题中产生突兀的白色块
  container: {
    overflow: 'hidden',
    backgroundColor: '#171726',
  },
  webView: {
    flex: 1,
    backgroundColor: '#171726',
  },
});
