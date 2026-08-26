import { Platform } from 'react-native';

type ExpoFileSystem = typeof import('expo-file-system');

async function nativeFileSystem(): Promise<ExpoFileSystem | null> {
  if (Platform.OS === 'web') return null;
  return import('expo-file-system');
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export async function persistEvidenceFile(sourceUri: string, id: string, mimeType = 'image/jpeg') {
  const FileSystem = await nativeFileSystem();
  // Web export is a compile/static-render validation target. Native durable evidence
  // is intentionally provided only by Android/iOS document storage.
  if (!FileSystem) return sourceUri;

  const evidenceDirectory = new FileSystem.Directory(FileSystem.Paths.document, 'diamond-shine-evidence');
  if (!evidenceDirectory.exists) evidenceDirectory.create({ idempotent: true, intermediates: true });

  const source = new FileSystem.File(sourceUri);
  if (!source.exists) throw new Error('Captured photo is no longer available on this device.');
  const target = new FileSystem.File(evidenceDirectory, `${id}.${extensionForMime(mimeType)}`);
  if (target.exists) target.delete();
  source.copy(target);
  return target.uri;
}

export async function removeEvidenceFile(uri: string) {
  const FileSystem = await nativeFileSystem();
  if (!FileSystem) return;
  try {
    const file = new FileSystem.File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cleanup is best-effort after the server has already accepted the evidence.
  }
}
