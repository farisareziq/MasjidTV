'use strict';

// Lapisan rangkaian + pandangan asas (toast/login/app/pin/tukar view).
// Semua fungsi membaca `state` & `cfg` pada MASA PANGGILAN — tiada kod
// kesan-sampingan di aras modul; pendengar acara dipasang oleh core.ts.

import { $, state, featureHooks, F } from './types';
import type { UploadResult } from './types';
import { t } from './i18n';
import { fileMime } from './util';

export interface ApiOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, { ...options, headers, body: options.body as BodyInit | undefined });
  if (res.status === 401 && path !== '/api/admin/login') {
    showLogin();
    throw new Error(t('sessionExpired'));
  }
  if (!res.ok) {
    let message = t('requestFailed', { s: res.status });
    try {
      const j = await res.json();
      if (j.error) message = j.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const mime = fileMime(file);
  // (awan sahaja) Mampatkan imej besar & hantar video/audio/fail besar terus
  // ke Blob berpresign — kod kekal dikompil untuk kedua-dua varian tetapi
  // hanya berjalan bila ciri blobUpload dihidupkan.
  if (F.blobUpload()) {
    let body: Blob = file;
    let type = mime;
    if (mime.startsWith('image/') && !mime.includes('gif') && file.size > 1.5 * 1024 * 1024) {
      const compressed = await compressImage(file);
      if (compressed) {
        body = compressed;
        type = 'image/jpeg';
      }
    }
    // Video / fail besar -> muat naik terus ke Blob (elak had 4.5MB serverless)
    if (mime.startsWith('video/') || mime.startsWith('audio/') || body.size > 3.5 * 1024 * 1024) {
      try {
        return await uploadToBlob(file, mime);
      } catch (blobErr) {
        // Jika Blob tiada (dev tempatan), teruskan dengan muat naik biasa.
        console.warn('[upload] blob gagal, cuba biasa:', (blobErr as Error).message);
      }
    }
    const res = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': type },
      body
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || t('uploadFailed'));
    }
    return res.json();
  }
  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': mime },
    body: file
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || t('uploadFailed'));
  }
  return res.json();
}

async function uploadToBlob(file: Blob, mime: string): Promise<UploadResult> {
  const { presignedUrl, pathname, kind } = await api<{ presignedUrl: string; pathname: string; kind: string }>('/api/admin/upload-url', {
    method: 'POST',
    body: { contentType: mime }
  });
  const putRes = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: file
  });
  if (!putRes.ok) throw new Error(`Muat naik ke Blob gagal (${putRes.status})`);
  const { url, kind: kind2 } = await api<{ url: string; kind?: string }>('/api/admin/upload-confirm', {
    method: 'POST',
    body: { pathname, kind }
  });
  return { url, kind: kind2 || kind };
}

// Mampat imej besar di pelayar supaya muat had serverless (4.5MB).
function compressImage(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob && blob.size < file.size ? blob : null);
        }, 'image/jpeg', 0.85);
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function toast(message: string, kind: string = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

export function showLogin() {
  $('appView').hidden = true;
  if (F.login()) $('pinChangeView').hidden = true;
  $('loginView').hidden = false;
  $(F.login() ? 'loginUsername' : 'loginPassword').focus();
}

export function showApp() {
  if (F.login()) $('pinChangeView').hidden = true;
  $('loginView').hidden = true;
  $('appView').hidden = false;
  // (awan sahaja) Pautan pantas ?pair=CODE — buka view TV & praisi kod.
  if (F.login()) {
    const pairParam = new URLSearchParams(location.search).get('pair');
    if (pairParam) {
      switchView('tv');
      const input = $('tvPairCode');
      if (input) input.value = String(pairParam).toUpperCase();
    }
  }
}

export function showPinChange() {
  $('loginView').hidden = true;
  $('appView').hidden = true;
  $('pinChangeView').hidden = false;
  $('pinNew').focus();
}

export function switchView(name: string) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'tv' && featureHooks.renderTv) featureHooks.renderTv();
}
