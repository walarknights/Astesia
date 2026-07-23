export const DEFAULT_ASTESIA_API_HOST = 'https://astesia.cc';

const ALLOWED_ASTESIA_API_ORIGINS = new Set([
  DEFAULT_ASTESIA_API_HOST,
]);

/**
 * 解析客户端可使用的 Astesia API 域名。
 *
 * @param value - Expo 构建环境注入的 API Host
 * @returns 仅包含协议和域名的可信 HTTPS Origin
 * @example
 *   resolveAstesiaApiHost('https://astesia.cc/') // => 'https://astesia.cc'
 */
export function resolveAstesiaApiHost(value?: string) {
  const normalizedValue = typeof value === 'string'
    ? value.trim().replace(/[`'"]/g, '')
    : '';

  if (!normalizedValue) {
    return DEFAULT_ASTESIA_API_HOST;
  }

  try {
    const url = new URL(normalizedValue);
    const hasUnexpectedUrlParts = (
      url.username
      || url.password
      || (url.pathname !== '/' && url.pathname !== '')
      || url.search
      || url.hash
    );

    // [变更] 修改前: Auth 与 AI 请求接受任意环境变量 Host
    // [变更] 修改后: 仅接受正式 HTTPS Origin，其他配置安全回退
    // [原因] 防止构建误配把密码、token 和用户数据发送到非预期服务
    if (
      url.protocol !== 'https:'
      || hasUnexpectedUrlParts
      || !ALLOWED_ASTESIA_API_ORIGINS.has(url.origin)
    ) {
      return DEFAULT_ASTESIA_API_HOST;
    }

    return url.origin;
  } catch {
    return DEFAULT_ASTESIA_API_HOST;
  }
}
