'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { uploadImage, deleteImage, getPathFromUrl } from '@/lib/image-upload';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

interface ImageUploadProps {
  bucket: string;
  recordId: string;
  images: string[];
  onChange: (images: string[]) => void;
  maxFiles?: number;
}

export function ImageUpload({ bucket, recordId, images, onChange, maxFiles = 5 }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = maxFiles - images.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${maxFiles} images allowed`);
      return;
    }

    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);

    const newUrls: string[] = [];
    for (const file of toUpload) {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image`);
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 5MB)`);
        continue;
      }
      try {
        const result = await uploadImage(file, bucket, recordId);
        newUrls.push(result.url);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed');
      }
    }

    if (newUrls.length > 0) {
      onChange([...images, ...newUrls]);
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRemove = async (url: string) => {
    const path = getPathFromUrl(url, bucket);
    if (path) {
      try {
        await deleteImage(bucket, path);
      } catch (err) {
        console.error('Failed to delete image:', err);
      }
    }
    onChange(images.filter((u) => u !== url));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((url) => (
          <div key={url} className="relative group w-20 h-20 rounded-lg border overflow-hidden bg-slate-100">
            <img src={url} alt="Uploaded" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => handleRemove(url)}
              className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {images.length < maxFiles && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-20 h-20 rounded-lg border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            <span className="text-[10px] mt-1">{uploading ? 'Uploading' : 'Add image'}</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <p className="text-xs text-slate-400">Max {maxFiles} images, 5MB each</p>
    </div>
  );
}
