const EMPTY_NOTE_HTML = '<p></p>';
const NOTE_HTML_MAX_LENGTH = 300_000;
const ALLOWED_NOTE_HTML_TAGS = new Set([
  'b',
  'blockquote',
  'br',
  'em',
  'h1',
  'h2',
  'h3',
  'i',
  'img',
  'li',
  'ol',
  'p',
  's',
  'strike',
  'strong',
  'u',
  'ul',
]);
const VOID_NOTE_HTML_TAGS = new Set(['br', 'img']);
const BLOCKED_NOTE_HTML_CONTENT_PATTERN = /<\s*(script|style|iframe|object|embed|link|meta|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi;

/**
 * 清洗笔记富文本 HTML，仅保留编辑器支持的基础排版标签和本地图片。
 *
 * @param value - 可能来自编辑器、历史缓存或导入文件的原始 HTML
 * @returns 可安全写入本地存储并交给 WebView / Tiptap 渲染的 HTML
 * @example
 *   sanitizeNoteContentHtml('<p>hello</p><script>alert(1)</script>') // => '<p>hello</p>'
 */
export function sanitizeNoteContentHtml(value: unknown) {
  const rawHtml = typeof value === 'string' ? value : '';
  const boundedHtml = (rawHtml.trim() ? rawHtml : EMPTY_NOTE_HTML).slice(0, NOTE_HTML_MAX_LENGTH);
  const sanitizedHtml = sanitizeNoteHtmlTokens(
    boundedHtml.replace(BLOCKED_NOTE_HTML_CONTENT_PATTERN, '')
  ).trim();

  return sanitizedHtml || EMPTY_NOTE_HTML;
}

function sanitizeNoteHtmlTokens(html: string) {
  let result = '';
  let currentIndex = 0;

  while (currentIndex < html.length) {
    const tagStartIndex = html.indexOf('<', currentIndex);

    if (tagStartIndex < 0) {
      result += html.slice(currentIndex);
      break;
    }

    result += html.slice(currentIndex, tagStartIndex);

    const tagEndIndex = findHtmlTagEnd(html, tagStartIndex + 1);

    if (tagEndIndex < 0) {
      result += '&lt;';
      currentIndex = tagStartIndex + 1;
      continue;
    }

    result += sanitizeNoteHtmlTag(html.slice(tagStartIndex, tagEndIndex + 1));
    currentIndex = tagEndIndex + 1;
  }

  return result;
}

function findHtmlTagEnd(html: string, startIndex: number) {
  let quotedBy = '';

  for (let index = startIndex; index < html.length; index += 1) {
    const character = html[index];

    if (quotedBy) {
      if (character === quotedBy) {
        quotedBy = '';
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quotedBy = character;
      continue;
    }

    if (character === '>') {
      return index;
    }
  }

  return -1;
}

function sanitizeNoteHtmlTag(token: string) {
  if (/^<\s*!/.test(token)) {
    return '';
  }

  const isClosingTag = /^<\s*\//.test(token);
  const tagMatch = /^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)\/?\s*>$/.exec(token);

  if (!tagMatch) {
    return escapeLooseHtmlToken(token);
  }

  const tagName = tagMatch[1].toLowerCase();

  if (!ALLOWED_NOTE_HTML_TAGS.has(tagName)) {
    return '';
  }

  if (isClosingTag) {
    return VOID_NOTE_HTML_TAGS.has(tagName) ? '' : `</${tagName}>`;
  }

  if (tagName === 'img') {
    return sanitizeNoteImageTag(tagMatch[2]);
  }

  return VOID_NOTE_HTML_TAGS.has(tagName) ? `<${tagName} />` : `<${tagName}>`;
}

function sanitizeNoteImageTag(attributeSource: string) {
  const attributes = parseHtmlAttributes(attributeSource);
  const imageSource = normalizeNoteImageSource(attributes.get('src') ?? '');

  if (!imageSource) {
    return '';
  }

  const altText = attributes.get('alt')?.trim() || '笔记图片';

  return `<img src="${escapeHtmlAttribute(imageSource)}" alt="${escapeHtmlAttribute(altText)}" />`;
}

function parseHtmlAttributes(source: string) {
  const attributes = new Map<string, string>();
  const normalizedSource = source.replace(/\/\s*$/, '');
  const attributePattern = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(normalizedSource)) !== null) {
    const attributeName = match[1].toLowerCase();
    const attributeValue = match[2] ?? match[3] ?? match[4] ?? '';

    if (!attributes.has(attributeName)) {
      attributes.set(attributeName, attributeValue);
    }
  }

  return attributes;
}

function normalizeNoteImageSource(value: string) {
  const imageSource = value.trim();
  const compactDataUrl = imageSource.replace(/\s/g, '');

  if (/^data:image\/(?:gif|heic|heif|jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i.test(compactDataUrl)) {
    return compactDataUrl;
  }

  return imageSource.startsWith('blob:') ? imageSource : '';
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeLooseHtmlToken(value: string) {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
