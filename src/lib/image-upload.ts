import { supabase } from './supabase-client';

export const RETURN_IMAGE_BUCKET = 'return-images';
export const REPLACEMENT_IMAGE_BUCKET = 'replacement-images';
export const MESSAGE_IMAGE_BUCKET = 'message-images';

export interface UploadResult {
  url: string;
  path: string;
}

/**
 * Upload a file to Supabase Storage and return its public URL.
 * Creates a unique path under the given record ID.
 */
export async function uploadImage(
  file: File,
  bucket: string,
  recordId: string
): Promise<UploadResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${recordId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Remove an image from Supabase Storage by its path.
 */
export async function deleteImage(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
}

/**
 * Extract the storage path from a public Supabase URL for the given bucket.
 */
export function getPathFromUrl(url: string, bucket: string): string | null {
  try {
    const urlObj = new URL(url);
    const prefix = `/storage/v1/object/public/${bucket}/`;
    if (urlObj.pathname.startsWith(prefix)) {
      return decodeURIComponent(urlObj.pathname.slice(prefix.length));
    }
    return null;
  } catch {
    return null;
  }
}
