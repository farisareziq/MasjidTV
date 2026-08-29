// Storage abstraction: Vercel Blob (cloud) or local filesystem (VPS).
// The admin upload routes use this instead of importing @vercel/blob directly,
// so the same code runs on both Vercel (Blob) and VPS (local fs) without
// conditional imports.
//
// Selection (first match):
//   1. VERCEL_BLOB_READ_WRITE_TOKEN / BLOB_READ_WRITE_TOKEN → Vercel Blob
//   2. MASJIDTV_UPLOADS_DIR → local filesystem
//   3. neither → not configured (uploads return 400)

import fs from 'node:fs';
import path from 'node:path';

export interface UploadResult {
  url: string;
  filename: string;
}

export interface HeadResult {
  url: string;
}

export interface PresignResult {
  presignedUrl: string;
  pathname: string;
}

export interface StorageAdapter {
  readonly kind: 'blob' | 'local' | 'none';
  isConfigured(): boolean;
  put(filename: string, buffer: Buffer): Promise<UploadResult>;
  head(pathname: string): Promise<HeadResult | null>;
  del(pathname: string): Promise<void>;
  publicUrl(pathname: string): string;
  presignUpload?(pathname: string, contentType: string): Promise<PresignResult | null>;
}

// --- Vercel Blob adapter (lazy import — only loaded when Blob is used) ----

class VercelBlobStorage implements StorageAdapter {
  readonly kind = 'blob' as const;
  private token: string;
  constructor(token: string) { this.token = token; }
  isConfigured() { return true; }

  async put(filename: string, buffer: Buffer): Promise<UploadResult> {
    const { put } = await import('@vercel/blob');
    const { url } = await put(filename, buffer, { access: 'public', token: this.token });
    return { url, filename };
  }

  async head(pathname: string): Promise<HeadResult | null> {
    const { head } = await import('@vercel/blob');
    try {
      const blob = await head(pathname, { token: this.token });
      return { url: blob.url };
    } catch { return null; }
  }

  async del(pathname: string): Promise<void> {
    const { del } = await import('@vercel/blob');
    await del(pathname, { token: this.token });
  }

  publicUrl(pathname: string): string {
    if (/^https?:\/\//i.test(pathname)) return pathname;
    const origin = (process.env.MASJIDTV_BLOB_PUBLIC_URL || 'https://blob.vercel-storage.com').replace(/\/+$/, '');
    return `${origin}/${pathname.replace(/^\/+/, '')}`;
  }

  async presignUpload(pathname: string, contentType: string): Promise<PresignResult | null> {
    const { issueSignedToken, presignUrl } = await import('@vercel/blob');
    const signedToken = await issueSignedToken({
      token: this.token, pathname, operations: ['put'],
      allowedContentTypes: [contentType], maximumSizeInBytes: 50 * 1024 * 1024
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      operation: 'put', pathname, access: 'public', allowedContentTypes: [contentType], addRandomSuffix: false
    });
    return { presignedUrl, pathname };
  }
}

// --- Local filesystem adapter (VPS) ---------------------------------------

class LocalStorage implements StorageAdapter {
  readonly kind = 'local' as const;
  private dir: string;
  private route: string;

  constructor(dir: string, route = '/uploads') {
    this.dir = path.resolve(dir);
    this.route = route;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  isConfigured() { return true; }

  private resolve(name: string): string {
    const clean = name.replace(/\.\./g, '').replace(/^\/+/, '');
    const full = path.join(this.dir, clean);
    const rel = path.relative(this.dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Invalid path');
    return full;
  }

  async put(filename: string, buffer: Buffer): Promise<UploadResult> {
    const safe = filename.replace(/\.\./g, '').replace(/^\/+/, '');
    const dest = this.resolve(safe);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    return { url: `${this.route}/${safe}`, filename: safe };
  }

  async head(pathname: string): Promise<HeadResult | null> {
    try {
      const dest = this.resolve(pathname);
      if (fs.existsSync(dest) && !fs.statSync(dest).isDirectory()) {
        const safe = pathname.replace(/\.\./g, '').replace(/^\/+/, '');
        return { url: `${this.route}/${safe}` };
      }
    } catch { /* not found */ }
    return null;
  }

  async del(pathname: string): Promise<void> {
    try { fs.unlinkSync(this.resolve(pathname)); } catch { /* best-effort */ }
  }

  publicUrl(pathname: string): string {
    if (/^https?:\/\//i.test(pathname)) return pathname;
    const safe = pathname.replace(/^\/+/, '');
    return `${this.route}/${safe}`;
  }

  // presignUpload not available — admin upload-url route returns an error;
  // the frontend falls back to direct upload via /api/admin/upload.
}

// --- Not-configured adapter (returns errors) ------------------------------

class NoStorage implements StorageAdapter {
  readonly kind = 'none' as const;
  isConfigured() { return false; }
  async put(): Promise<UploadResult> { throw new Error('Storage not configured'); }
  async head(): Promise<HeadResult | null> { return null; }
  async del(): Promise<void> {}
  publicUrl(pathname: string): string { return pathname; }
}

// --- Singleton factory ----------------------------------------------------

let _storage: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (_storage) return _storage;
  const blobToken = process.env.VERCEL_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (blobToken) {
    _storage = new VercelBlobStorage(blobToken);
    return _storage;
  }
  const uploadsDir = process.env.MASJIDTV_UPLOADS_DIR;
  if (uploadsDir) {
    _storage = new LocalStorage(uploadsDir, process.env.MASJIDTV_UPLOADS_PATH || '/uploads');
    return _storage;
  }
  _storage = new NoStorage();
  return _storage;
}
