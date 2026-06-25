import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { ImageInfo } from 'expo-image-picker';

export interface ImageResult {
  uri: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export const IMAGE_STORAGE_DIR = `${FileSystem.documentDirectory}everfind-images/`;
export const IMAGE_STORAGE_RELATIVE_DIR = 'everfind-images/';

export const toRelativeImagePath = (path: string): string => {
  if (!path) return path;
  if (!FileSystem.documentDirectory) return path;
  if (path.startsWith(IMAGE_STORAGE_RELATIVE_DIR)) return path;
  if (path.startsWith(IMAGE_STORAGE_DIR)) {
    return path.replace(IMAGE_STORAGE_DIR, IMAGE_STORAGE_RELATIVE_DIR);
  }
  const markerIndex = path.indexOf(IMAGE_STORAGE_RELATIVE_DIR);
  if (markerIndex >= 0) {
    return path.slice(markerIndex);
  }
  return path;
};

export const toAbsoluteImagePath = (path: string): string => {
  if (!path) return path;
  if (!FileSystem.documentDirectory) return path;
  if (path.startsWith(IMAGE_STORAGE_DIR)) return path;
  if (path.startsWith('file://')) return path;
  if (path.startsWith(IMAGE_STORAGE_RELATIVE_DIR)) {
    return `${FileSystem.documentDirectory}${path}`;
  }
  return `${IMAGE_STORAGE_DIR}${path}`;
};

export const isImagePathInPermanentDir = (path: string): boolean => {
  if (!path) return false;
  if (path.startsWith(IMAGE_STORAGE_RELATIVE_DIR)) return true;
  if (path.startsWith(IMAGE_STORAGE_DIR)) return true;
  return path.includes(IMAGE_STORAGE_RELATIVE_DIR);
};

const ensureImageStorageDir = async () => {
  if (!FileSystem.documentDirectory) return;
  const dirInfo = await FileSystem.getInfoAsync(IMAGE_STORAGE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(IMAGE_STORAGE_DIR, { intermediates: true });
  }
};

const getFileExtension = (uri: string) => {
  const sanitized = uri.split('?')[0];
  const parts = sanitized.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : 'jpg';
};

export const storeImagePermanently = async (uri: string): Promise<string> => {
  if (!uri) return uri;
  if (Platform.OS === 'web') return uri;
  if (uri.startsWith(IMAGE_STORAGE_RELATIVE_DIR)) return uri;
  if (uri.startsWith(IMAGE_STORAGE_DIR)) return toRelativeImagePath(uri);

  await ensureImageStorageDir();
  const fileExtension = getFileExtension(uri);
  const fileName = `image_${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExtension}`;
  const destination = `${IMAGE_STORAGE_DIR}${fileName}`;

  try {
    await FileSystem.copyAsync({ from: uri, to: destination });
    return `${IMAGE_STORAGE_RELATIVE_DIR}${fileName}`;
  } catch (error) {
    console.error('Failed to persist image', error);
    return uri;
  }
};

export const ensureImageExists = async (uri: string | null | undefined): Promise<boolean> => {
  if (!uri) return false;
  try {
    const info = await FileSystem.getInfoAsync(toAbsoluteImagePath(uri));
    return Boolean(info.exists);
  } catch {
    return false;
  }
};

export const pickImage = async (): Promise<ImageResult | null> => {
  try {
    // Request permission for image library access
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      console.log('Permission to access media library was denied');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const persisted = await storeImagePermanently(asset.uri);
      return processImageAsset({ ...asset, uri: persisted });
    }

    return null;
  } catch (error) {
    console.error('Error picking image:', error);
    return null;
  }
};

export const takePhoto = async (): Promise<ImageResult | null> => {
  try {
    // Request camera permission
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      console.log('Permission to access camera was denied');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const persisted = await storeImagePermanently(asset.uri);
      return processImageAsset({ ...asset, uri: persisted });
    }

    return null;
  } catch (error) {
    console.error('Error taking photo:', error);
    return null;
  }
};

const processImageAsset = async (asset: ImageInfo): Promise<ImageResult> => {
  // Get file info
  const fileInfo = await FileSystem.getInfoAsync(toAbsoluteImagePath(asset.uri));

  // Extract file extension
  const fileExtension = getFileExtension(asset.uri);
  const fileType = `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;

  // Handle file size - FileInfo might not have size property on all platforms
  let fileSize = 0;
  if ('size' in fileInfo && typeof fileInfo.size === 'number') {
    fileSize = fileInfo.size;
  }

  return {
    uri: toRelativeImagePath(asset.uri),
    fileName: `image_${Date.now()}.${fileExtension}`,
    fileType: fileType,
    fileSize: fileSize,
  };
};

export const deleteImage = async (imagePath: string): Promise<boolean> => {
  try {
    if (!imagePath) return true;

    // Check if file exists
    const fileInfo = await FileSystem.getInfoAsync(toAbsoluteImagePath(imagePath));
    if (!fileInfo.exists) return true;

    // Delete the file
    await FileSystem.deleteAsync(toAbsoluteImagePath(imagePath), { idempotent: true });
    return true;
  } catch (error) {
    console.error('Error deleting image:', error);
    return false;
  }
};

export const isPlatformSupported = (): boolean => {
  // Return true for Android and iOS, false for web and other platforms
  return Platform.OS === 'android' || Platform.OS === 'ios';
};

export const getImageSource = (imagePath: string | null | undefined): { uri: string } => {
  if (!imagePath) {
    return { uri: '' }; // Return empty object for fallback
  }
  return { uri: toAbsoluteImagePath(imagePath) };
};
