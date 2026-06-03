'use dom';

import TiptapImage from '@tiptap/extension-image';
import TiptapPlaceholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import TiptapStarterKit from '@tiptap/starter-kit';
import { type Editor } from '@tiptap/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

type TiptapRichTextEditorProps = {
  initialHtml: string;
  insertedImageUri?: string;
  insertedImageToken?: string;
  placeholder?: string;
  onChangeHtml?: (html: string) => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};

const EMPTY_HTML = '<p></p>';
type HeadingLevel = 1 | 2 | 3;
type ToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  headingLevel: HeadingLevel | null;
  paragraph: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

const DEFAULT_TOOLBAR_STATE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  headingLevel: null,
  paragraph: true,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  canUndo: false,
  canRedo: false,
};

export default function TiptapRichTextEditor({
  initialHtml,
  insertedImageUri,
  insertedImageToken,
  placeholder = '开始写下今天的想法...',
  onChangeHtml,
}: TiptapRichTextEditorProps) {
  const [lastInsertedImageToken, setLastInsertedImageToken] = useState('');
  const [toolbarState, setToolbarState] = useState<ToolbarState>(DEFAULT_TOOLBAR_STATE);
  const editorExtensions = useMemo(
    () => [
      TiptapStarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      TiptapImage.configure({
        inline: false,
        allowBase64: true,
      }),
      TiptapPlaceholder.configure({
        placeholder,
      }),
    ],
    [placeholder]
  );
  const syncToolbarState = useCallback((currentEditor: Editor) => {
    setToolbarState(getToolbarState(currentEditor));
  }, []);

  const editor = useEditor({
    extensions: editorExtensions,
    content: initialHtml || EMPTY_HTML,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'note-editor-content',
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      syncToolbarState(currentEditor);
      void onChangeHtml?.(currentEditor.getHTML());
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      syncToolbarState(currentEditor);
    },
    onTransaction: ({ editor: currentEditor }) => {
      syncToolbarState(currentEditor);
    },
  });

  useEffect(() => {
    if (editor) {
      syncToolbarState(editor);
    }
  }, [editor, syncToolbarState]);

  useEffect(() => {
    if (!editor || !initialHtml) {
      return;
    }

    if (editor.getHTML() !== initialHtml) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
  }, [editor, initialHtml]);

  useEffect(() => {
    if (!editor || !insertedImageUri || !insertedImageToken || insertedImageToken === lastInsertedImageToken) {
      return;
    }

    editor
      .chain()
      .focus()
      .setImage({ src: insertedImageUri, alt: '笔记图片' })
      .createParagraphNear()
      .run();
    setLastInsertedImageToken(insertedImageToken);
    void onChangeHtml?.(editor.getHTML());
  }, [editor, insertedImageUri, insertedImageToken, lastInsertedImageToken, onChangeHtml]);

  const isReady = Boolean(editor);
  const runEditorCommand = (command: (currentEditor: Editor) => void) => {
    if (!editor) {
      return;
    }

    command(editor);
    syncToolbarState(editor);
  };

  return (
    <div className="editor-shell">
      <style>{editorStyles}</style>
      {/*
       * 渲染位置: 富文本编辑器顶部工具栏
       * 展示内容: 加粗、下划线、标题、列表、引用、撤销重做等格式化按钮
       * 数据来源: Tiptap editor 当前选区和命令状态
       */}
      <div className="toolbar" aria-label="富文本编辑工具栏">
        <ToolbarButton label="B" title="加粗" active={toolbarState.bold} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleBold().run())} />
        <ToolbarButton label="I" title="斜体" active={toolbarState.italic} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleItalic().run())} />
        <ToolbarButton label="U" title="下划线" active={toolbarState.underline} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleUnderline().run())} />
        <ToolbarButton label="S" title="删除线" active={toolbarState.strike} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleStrike().run())} />
        <span className="toolbar-divider" />
        <ToolbarButton label="H1" title="一级标题" active={toolbarState.headingLevel === 1} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => setHeadingLevel(currentEditor, 1))} />
        <ToolbarButton label="H2" title="二级标题" active={toolbarState.headingLevel === 2} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => setHeadingLevel(currentEditor, 2))} />
        <ToolbarButton label="H3" title="三级标题" active={toolbarState.headingLevel === 3} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => setHeadingLevel(currentEditor, 3))} />
        <ToolbarButton label="正文" title="正文段落" active={toolbarState.paragraph} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().setParagraph().run())} />
        <span className="toolbar-divider" />
        <ToolbarButton label="• 列表" title="无序列表" active={toolbarState.bulletList} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleBulletList().run())} />
        <ToolbarButton label="1. 列表" title="有序列表" active={toolbarState.orderedList} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleOrderedList().run())} />
        <ToolbarButton label="引用" title="引用块" active={toolbarState.blockquote} disabled={!isReady} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().toggleBlockquote().run())} />
        <span className="toolbar-divider" />
        <ToolbarButton label="撤销" title="撤销" disabled={!isReady || !toolbarState.canUndo} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().undo().run())} />
        <ToolbarButton label="重做" title="重做" disabled={!isReady || !toolbarState.canRedo} onPress={() => runEditorCommand((currentEditor) => currentEditor.chain().focus().redo().run())} />
      </div>

      {/*
       * 渲染位置: 富文本编辑器正文区域
       * 展示内容: 可编辑的 HTML 富文本内容，包含文字格式和图片
       * 数据来源: Tiptap editor content 与 initialHtml
       */}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  label,
  title,
  active,
  disabled,
  onPress,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`toolbar-button${active ? ' toolbar-button-active' : ''}`}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onTouchStart={(event) => {
        event.preventDefault();
      }}
      onClick={onPress}>
      {label}
    </button>
  );
}

function getToolbarState(editor: Editor): ToolbarState {
  const { $from } = editor.state.selection;
  const currentNode = $from.parent;
  const headingLevel = currentNode.type.name === 'heading'
    ? Number(currentNode.attrs.level) as HeadingLevel
    : null;
  const bulletList = editor.isActive('bulletList');
  const orderedList = editor.isActive('orderedList');
  const blockquote = editor.isActive('blockquote');

  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    headingLevel,
    paragraph: currentNode.type.name === 'paragraph' && !bulletList && !orderedList && !blockquote,
    bulletList,
    orderedList,
    blockquote,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

function setHeadingLevel(editor: Editor, level: HeadingLevel) {
  if (editor.isActive('heading', { level })) {
    editor.chain().focus().setParagraph().run();
    return;
  }

  editor.chain().focus().setHeading({ level }).run();
}

const editorStyles = `
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: transparent;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .editor-shell {
    min-height: 100vh;
    padding: 0;
    color: #0f172a;
    background: #ffffff;
  }

  .toolbar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid #e2e8f0;
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(14px);
  }

  .toolbar-button {
    min-height: 34px;
    border: 1px solid #e9d5ff;
    border-radius: 999px;
    padding: 7px 12px;
    color: #6d28d9;
    background: #f3e8ff;
    font-size: 13px;
    font-weight: 700;
  }

  .toolbar-button:disabled {
    opacity: 0.45;
  }

  .toolbar-button-active {
    border-color: #7c3aed;
    color: #ffffff;
    background: #7c3aed;
  }

  .toolbar-divider {
    width: 1px;
    min-height: 30px;
    background: #e2e8f0;
  }

  .note-editor-content {
    min-height: 420px;
    padding: 18px;
    outline: none;
    color: #0f172a;
    font-size: 18px;
    line-height: 1.72;
  }

  .note-editor-content p {
    margin: 0 0 14px;
  }

  .note-editor-content h1,
  .note-editor-content h2,
  .note-editor-content h3 {
    margin: 20px 0 12px;
    color: #111827;
    line-height: 1.25;
  }

  .note-editor-content h1 {
    font-size: 30px;
  }

  .note-editor-content h2 {
    font-size: 25px;
  }

  .note-editor-content h3 {
    font-size: 22px;
  }

  .note-editor-content ul,
  .note-editor-content ol {
    margin: 0 0 16px;
    padding-left: 24px;
  }

  .note-editor-content blockquote {
    margin: 16px 0;
    border-left: 4px solid #c4b5fd;
    padding: 8px 14px;
    border-radius: 10px;
    color: #475569;
    background: #f8fafc;
  }

  .note-editor-content img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 16px auto;
    border-radius: 18px;
  }

  .note-editor-content .is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: #94a3b8;
    pointer-events: none;
  }
`;
