// End-to-end dry-run for the local MasjidTV server.
// Exercises the full parity surface: health, methods/zones, displayKey, prayer
// times (JAKIM + fallback), admin login/security, announcement CRUD, reorder,
// uploads (magic-byte validation), slides, and the azan/iqamah state payload.
//
// Usage: node scripts/dry-run.mjs [--port 3000] [--data-dir <path>]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const args = process.argv.slice(2);
function argVal(flag, def) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = Number(argVal('--port', 3999));
const DATA_DIR = argVal('--data-dir', fs.mkdtempSync(path.join(os.tmpdir(), 'masjidtv-dry-')));
const PUBLIC_DIR = path.join(root, 'packages', 'frontend', 'public');

let failures = 0;
function ok(name, cond) {
  if (cond) console.log(`  \u2713 ${name}`);
  else { console.error(`  \u2717 ${name}`); failures++; }
}

async function req(pathname, { method = 'GET', headers = {}, body } = {}) {
  const hasBody = body !== undefined;
  const res = await fetch(`http://localhost:${PORT}${pathname}`, {
    method,
    headers: hasBody ? { 'content-type': 'application/json', ...headers } : headers,
    body: hasBody ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

console.log(`\nMasjidTV dry-run — data dir ${DATA_DIR}\n`);

// Start server.
const server = spawn('node', [path.join(root, 'packages/server/dist/index.js')], {
  env: { ...process.env, MASJIDTV_DATA_DIR: DATA_DIR, MASJIDTV_PUBLIC_DIR: PUBLIC_DIR, PORT: String(PORT) },
  stdio: 'ignore'
});

const waitFor = async (url, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

try {
  const serverUp = await waitFor(`http://localhost:${PORT}/api/health`);
  ok('server starts', serverUp);

  // Public endpoints.
  const health = await req('/api/health');
  ok('health ok', health.json?.ok === true && health.json?.service === 'masjidtv');

  const methods = await req('/api/methods');
  ok('13 prayer methods', Object.keys(methods.json || {}).length === 13);

  const zones = await req('/api/zones');
  ok('zones grouped', Object.keys(zones.json?.zones || {}).length > 0);

  // displayKey protection.
  const noKey = await req('/api/settings');
  ok('settings requires display key (401)', noKey.status === 401);

  // Resolve display key from DB.
  const { createLocalClient } = await import(pathToFileURL(path.join(root, 'packages/db/dist/index.js')).href);
  const dbClient = await createLocalClient(path.join(DATA_DIR, 'masjidtv.db'));
  const settingsRow = dbClient.raw.prepare('SELECT data FROM settings WHERE id = 1').get();
  dbClient.close();
  const settingsDoc = JSON.parse(settingsRow.data);
  const displayKey = settingsDoc.security.displayKey;
  ok('display key generated', !!displayKey);

  const settings = await req(`/api/settings?key=${displayKey}`);
  ok('settings with key (200)', settings.status === 200);
  ok('settings has mosque', !!settings.json?.mosque?.name);

  // Prayer times (JAKIM live or local fallback).
  const today = await req(`/api/today?key=${displayKey}`);
  ok('today (200)', today.status === 200);
  ok('today has prayers', !!today.json?.prayers?.fajr && !!today.json?.prayers?.isha);
  ok('today has hijri', !!today.json?.hijri?.text);
  ok('today has iqamah', !!today.json?.iqamah?.fajr);
  ok('today has next', today.json?.next === null || !!today.json?.next?.key);

  // Slides (builtin content when no announcements).
  const slides = await req(`/api/slides?key=${displayKey}`);
  ok('slides (200)', slides.status === 200);
  ok('slides has builtin content', Array.isArray(slides.json?.builtin));

  // Admin login.
  const pwFile = fs.readFileSync(path.join(DATA_DIR, 'ADMIN_PASSWORD.txt'), 'utf8');
  const pwLines = pwFile.split('\n').map((l) => l.trim()).filter(Boolean);
  const password = pwLines.find((l) => l.startsWith('tvm-'));
  const login = await req('/api/admin/login', { method: 'POST', body: { password } });
  ok('admin login (200)', login.status === 200 && !!login.json?.token);
  const auth = { authorization: `Bearer ${login.json.token}` };

  const badLogin = await req('/api/admin/login', { method: 'POST', body: { password: 'wrong' } });
  ok('wrong password rejected (401)', badLogin.status === 401);

  // Announcement CRUD.
  const created = await req('/api/admin/announcements', {
    method: 'POST', headers: auth, body: { title: 'Dry-run', message: 'Hello', category: 'general' }
  });
  ok('create announcement (201)', created.status === 201);
  const annId = created.json?.id;

  const list = await req('/api/admin/announcements', { headers: auth });
  ok('list announcements', list.json?.length >= 1);

  const updated = await req(`/api/admin/announcements/${annId}`, {
    method: 'PUT', headers: auth, body: { message: 'Updated' }
  });
  ok('update announcement', updated.json?.message === 'Updated');

  const reorder = await req('/api/admin/announcements/reorder', {
    method: 'POST', headers: auth, body: { ids: [annId] }
  });
  ok('reorder announcement', reorder.status === 200);

  // Slides now reflect the announcement.
  const slidesAfter = await req(`/api/slides?key=${displayKey}`);
  ok('slides reflect announcement', slidesAfter.json?.announcements?.length >= 1);

  // Upload magic-byte validation.
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const up = await req('/api/admin/upload', { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: validPng });
  ok('upload valid PNG (200)', up.status === 200 && up.json?.kind === 'image');

  const invalidPng = Buffer.from([0, 1, 2, 3]);
  const upBad = await req('/api/admin/upload', { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: invalidPng });
  ok('reject invalid magic bytes (400)', upBad.status === 400);

  // Settings update (zone change triggers events sync).
  const settingsUpdate = await req('/api/admin/settings', {
    method: 'PUT', headers: auth, body: { prayer: { zone: 'WLY01' }, mosque: { name: 'Masjid Dry-run' } }
  });
  ok('settings update (200)', settingsUpdate.status === 200 && settingsUpdate.json?.mosque?.name === 'Masjid Dry-run');

  // Password change.
  const pwChange = await req('/api/admin/password', {
    method: 'POST', headers: auth, body: { currentPassword: password, newPassword: 'newpass123' }
  });
  ok('password change (200)', pwChange.status === 200);

  // Password change must revoke the old session (stolen tokens die).
  const oldAuthDel = await req(`/api/admin/announcements/${annId}`, { method: 'DELETE', headers: auth });
  ok('old token revoked after password change (401)', oldAuthDel.status === 401);

  // Re-login with the new password and delete the announcement.
  const relogin = await req('/api/admin/login', { method: 'POST', body: { password: 'newpass123' } });
  ok('re-login with new password (200)', relogin.status === 200 && !!relogin.json?.token);
  const auth2 = { authorization: `Bearer ${relogin.json.token}` };
  const del = await req(`/api/admin/announcements/${annId}`, { method: 'DELETE', headers: auth2 });
  ok('delete announcement (200)', del.status === 200);

  // Unknown route.
  const notFound = await req('/api/nope');
  ok('unknown route (404)', notFound.status === 404);
} catch (err) {
  console.error('dry-run error:', err.message);
  failures++;
} finally {
  server.kill();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* locked on win */ }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
