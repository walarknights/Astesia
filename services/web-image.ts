const IMAGE_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type WebImageInput = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  file?: globalThis.File | null;
  base64?: string | null;
};

function getFileExtension(value?: string | null) {
  if (!value) {
    return null;
  }

  const sanitizedValue = value.split('?')[0].split('#')[0];
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(sanitizedValue);

  return extensionMatch?.[1]?.toLowerCase() ?? null;
}

function getImageMimeType(input: WebImageInput) {
  if (input.mimeType?.startsWith('image/')) {
    return input.mimeType;
  }

  const extension = getFileExtension(input.name) ?? getFileExtension(input.uri);
  return extension ? IMAGE_MIME_TYPE_BY_EXTENSION[extension] ?? 'image/jpeg' : 'image/jpeg';
}

function readFileAsDataUrl(file: globalThis.File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('WEB_FILE_READ_FAILED'));
    };
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
        resolve(reader.result);
        return;
      }

      reject(new Error('WEB_FILE_READ_FAILED'));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * 在 Web / PWA 环境中将 picker 返回的图片资源转换为可持久化的 data URL。
 *
 * @param input - 兼容 Expo ImagePicker / DocumentPicker 的图片资源
 * @returns 可直接渲染且适合写入本地存储的图片地址
 * @example
 *   await getPersistentWebImageUri({ uri, file, mimeType }) // => 'data:image/png;base64,...'
 */
export async function getPersistentWebImageUri(input: WebImageInput) {
  if (input.uri.startsWith('data:') || input.uri.startsWith('http://') || input.uri.startsWith('https://')) {
    return input.uri;
  }

  const mimeType = getImageMimeType(input);

  if (typeof input.base64 === 'string' && input.base64) {
    return `data:${mimeType};base64,${input.base64}`;
  }

  if (typeof File !== 'undefined' && input.file instanceof File) {
    return readFileAsDataUrl(input.file);
  }

  return input.uri;
}
