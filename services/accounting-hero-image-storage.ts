import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { storage } from '@/services/storage';
import { ACCOUNTING_HERO_IMAGE_STORAGE_KEY } from '@/services/storage-keys';

const BACKGROUND_IMAGE_DIRECTORY_NAME = 'accounting-background-images';
const BACKGROUND_IMAGE_FILE_PREFIX = 'hero-background';
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

type PersistAccountingHeroImageInput = {
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

function getSupportedImageExtension(input: PersistAccountingHeroImageInput) {
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
    // 删除失败不阻塞新背景图展示，下次保存会继续清理目录残留。
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
    // 清理历史图片是兜底逻辑，失败时不影响当前已保存图片继续使用。
  }
}

/**
 * 校验并持久化账单页背景图片，成功后返回可直接渲染的本地图片 URI。
 *
 * @param input - 用户从图库或文件系统选择的图片信息
 * @returns 保存到应用文档目录后的图片 URI
 * @example
 *   persistAccountingHeroImage({ uri, name, mimeType }) // => 'file:///.../hero-background-1.jpg'
 */
export async function persistAccountingHeroImage(input: PersistAccountingHeroImageInput) {
  const extension = getSupportedImageExtension(input);

  if (!extension) {
    throw new Error('UNSUPPORTED_IMAGE_FORMAT');
  }

  // [变更] 修改前: 背景图固定使用应用内置图片
  // [变更] 修改后: 将用户图片复制到应用文档目录并记录 URI
  // [原因] 用户再次打开页面时仍能看到最后一次上传的背景图
  if (Platform.OS === 'web') {
    await storage.setItem(ACCOUNTING_HERO_IMAGE_STORAGE_KEY, input.uri);
    return input.uri;
  }

  const directory = getBackgroundImageDirectory();
  directory.create({ idempotent: true, intermediates: true });

  const nextImageFile = new File(
    directory,
    `${BACKGROUND_IMAGE_FILE_PREFIX}-${Date.now()}.${extension}`
  );
  const previousImageUri = await storage.getItem(ACCOUNTING_HERO_IMAGE_STORAGE_KEY);

  try {
    new File(input.uri).copy(nextImageFile);
    await storage.setItem(ACCOUNTING_HERO_IMAGE_STORAGE_KEY, nextImageFile.uri);
    deleteFileIfExists(previousImageUri);
    cleanupStaleBackgroundImages(nextImageFile.uri);

    return nextImageFile.uri;
  } catch (error) {
    deleteFileIfExists(nextImageFile.uri);
    throw error;
  }
}

export async function loadAccountingHeroImageUri() {
  const storedUri = await storage.getItem(ACCOUNTING_HERO_IMAGE_STORAGE_KEY);

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

  await storage.removeItem(ACCOUNTING_HERO_IMAGE_STORAGE_KEY);
  return null;
}
