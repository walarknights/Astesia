import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY } from '@/services/storage-keys';
import { storage } from '@/services/storage';

const BACKGROUND_IMAGE_DIRECTORY_NAME = 'personal-background-images';
const BACKGROUND_IMAGE_FILE_PREFIX = 'personal-background';
const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const SUPPORTED_IMAGE_EXTENSIONS = new Set([...Object.values(IMAGE_EXTENSION_BY_MIME_TYPE), 'jpeg']);

type PersistPersonalBackgroundImageInput = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
};

function getBackgroundImageDirectory() {
  return new Directory(Paths.document, BACKGROUND_IMAGE_DIRECTORY_NAME);
}

function getFileExtension(value?: string | null) {
  if (!value) {
    return null;
  }

  const sanitizedValue = value.split('?')[0].split('#')[0];
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(sanitizedValue);

  return extensionMatch?.[1]?.toLowerCase() ?? null;
}

function getSupportedImageExtension(input: PersistPersonalBackgroundImageInput) {
  const mimeType = input.mimeType?.toLowerCase();

  if (mimeType && IMAGE_EXTENSION_BY_MIME_TYPE[mimeType]) {
    return IMAGE_EXTENSION_BY_MIME_TYPE[mimeType];
  }

  const extension = getFileExtension(input.name) ?? getFileExtension(input.uri);

  return extension && SUPPORTED_IMAGE_EXTENSIONS.has(extension) ? extension : null;
}

function deleteFileIfExists(uri?: string | null) {
  if (!uri || Platform.OS === 'web') {
    return;
  }

  try {
    const file = new File(uri);

    if (file.exists) {
      file.delete();
    }
  } catch {
    // 删除失败不影响当前新背景图保存，后续保存会继续清理历史文件。
  }
}

function cleanupStaleBackgroundImages(keepUri: string) {
  if (Platform.OS === 'web') {
    return;
  }

  try {
    const directory = getBackgroundImageDirectory();

    if (!directory.exists) {
      return;
    }

    directory.list().forEach((entry) => {
      if (entry instanceof File && entry.uri !== keepUri && entry.name.startsWith(BACKGROUND_IMAGE_FILE_PREFIX)) {
        deleteFileIfExists(entry.uri);
      }
    });
  } catch {
    // 清理历史图片只是兜底逻辑，失败时不阻塞用户继续使用新背景图。
  }
}

/**
 * 校验并持久化个人页自定义背景图片，成功后返回可直接渲染的本地图片 URI。
 *
 * @param input - 用户从图库或文件系统选择的图片信息
 * @returns 保存到应用文档目录后的图片 URI
 * @example
 *   persistPersonalBackgroundImage({ uri, name, mimeType }) // => 'file:///.../personal-background-1.jpg'
 */
export async function persistPersonalBackgroundImage(input: PersistPersonalBackgroundImageInput) {
  const extension = getSupportedImageExtension(input);

  if (!extension) {
    throw new Error('UNSUPPORTED_IMAGE_FORMAT');
  }

  // [变更] 修改前: 个人页背景只能从内置图片中选择
  // [变更] 修改后: 用户图片会复制到应用文档目录并记录 URI
  // [原因] 保证重启应用后仍能展示用户上传的个人页背景
  if (Platform.OS === 'web') {
    await storage.setItem(PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY, input.uri);
    return input.uri;
  }

  const directory = getBackgroundImageDirectory();
  directory.create({ idempotent: true, intermediates: true });

  const nextImageFile = new File(
    directory,
    `${BACKGROUND_IMAGE_FILE_PREFIX}-${Date.now()}.${extension}`
  );
  const previousImageUri = await storage.getItem(PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY);

  try {
    new File(input.uri).copy(nextImageFile);
    await storage.setItem(PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY, nextImageFile.uri);
    deleteFileIfExists(previousImageUri);
    cleanupStaleBackgroundImages(nextImageFile.uri);

    return nextImageFile.uri;
  } catch (error) {
    deleteFileIfExists(nextImageFile.uri);
    throw error;
  }
}

export async function loadPersonalBackgroundImageUri() {
  const storedUri = await storage.getItem(PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY);

  if (!storedUri || Platform.OS === 'web') {
    return storedUri;
  }

  try {
    const storedImage = new File(storedUri);

    if (storedImage.exists) {
      return storedUri;
    }
  } catch {
    // 读取失败时清理失效记录，界面回退到内置默认背景图。
  }

  await storage.removeItem(PERSONAL_BACKGROUND_IMAGE_STORAGE_KEY);
  return null;
}

