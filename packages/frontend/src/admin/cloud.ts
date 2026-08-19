'use strict';

// Ciri khusus AWAN untuk pentadbir MasjidTV — diimport oleh admin-cloud.ts
// SEBELUM bootAdmin() dipanggil. Mendaftar cangkuk yang dipanggil teras
// (renderTv, refreshTenants, blok lesen) dan memasang pendengar acara untuk
// konsol superuser + TV pairing. Kesan sampingan di aras modul selaras dengan
// kod aras atas admin-cloud.ts asal (pendengar dipasang sebaik sahaja skrip
// dimuat), jadi susunan import pada wrapper adalah signifikan.

import { $, state, registerAdminFeatures } from './types';
import type { DshowOption, LicenseInfo, MediaItem, TenantInfo, TvDevice } from './types';
import { t, i18nEntry, currentAdminLang } from './i18n';
import { escapeHtml, dshowDeviceName } from './util';
import { api, toast } from './api';

// ------------------------------------------------------------------ license

// Blok lesen pada hujung renderOverview (kad overview varian awan).
function renderOverviewExtra() {
  const lic: LicenseInfo = state.license || ({} as LicenseInfo);
  if (lic.status === 'trial') {
    const days = Math.max(0, Math.ceil((lic.trialUntil - Date.now()) / 86400000));
    $('ovLicense').textContent = t('licenseTrial', { d: days });
    $('ovLicenseSub').textContent = t('trialEnds', { d: new Date(lic.trialUntil).toLocaleDateString() });
  } else if (lic.status === 'licensed') {
    $('ovLicense').textContent = t('licenseActive');
    $('ovLicenseSub').textContent = '';
  } else if (lic.status === 'suspended') {
    $('ovLicense').textContent = t('licenseSuspended');
    $('ovLicenseSub').textContent = '';
  } else {
    $('ovLicense').textContent = t('licenseLocked');
    $('ovLicenseSub').textContent = '';
  }
  $('ovApiKey').textContent = `${t('apiKeyLabel')}: ${lic.apiKey || ''}`;
  $('licenseReg').hidden = lic.status === 'licensed';
}

$('licRegisterBtn').addEventListener('click', async () => {
  const code = String($('licCodeInput').value).trim();
  if (!code) return toast(t('licenseCodeLabel'), 'err');
  try {
    const res = await api<LicenseInfo>('/api/admin/license', { method: 'POST', body: { code } });
    state.license = res;
    $('licCodeInput').value = '';
    renderOverviewExtra();
    toast(t('licenseActive'));
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

// ------------------------------------------------------------- superuser

async function refreshTenants() {
  state.superTenants = await api<TenantInfo[]>('/api/super/tenants');
  renderTenants();
}

function renderTenants() {
  const list = $('tenantList');
  if (!state.superTenants?.length) {
    const noTenants = i18nEntry(currentAdminLang(), 'noTenants') || i18nEntry('en', 'noTenants') || i18nEntry('en', 'emptyEvents');
    list.innerHTML = `<div class="empty-state">${escapeHtml(noTenants)}</div>`;
    return;
  }
  // Nota pariti: baseline rujukan menulis data-users="${t.id}" (t = fungsi
  // i18n, jadi atribut menjadi "undefined") — toggle Users superuser sentiasa
  // ralat di rujukan. Dibetulkan kepada tn.id (deviasi disengajakan).
  list.innerHTML = state.superTenants.map((tn) => {
    const statusCls = tn.status === 'suspended' ? 'err' : tn.status === 'licensed' ? 'ok' : 'warn';
    const trialText = tn.license?.status === 'trial'
      ? ` • ${t('trialEnds', { d: new Date(tn.license.trialUntil).toLocaleDateString() })}`
      : '';
    return `
      <div class="announcement-item" data-id="${tn.id}">
        <div>
          <div class="ann-title">${escapeHtml(tn.name)} <span class="status-chip ${statusCls}">${escapeHtml(tn.status)}</span></div>
          <div class="ann-meta">
            <span>${escapeHtml(t('tenantStatus', { s: tn.status }))}${trialText}</span>
            <span>${t('apiKeyLabel')}: <code>${escapeHtml(tn.apiKey)}</code></span>
            <span>${t('tenantId')}: <code>${escapeHtml(tn.id)}</code></span>
          </div>
          <div class="form-grid" style="margin-top:10px">
            <label class="span-2"><span data-i18n="licenseCodeLabel">License code</span>
              <input type="text" class="lic-code" placeholder="TVM-…">
            </label>
            <button class="btn primary sm" data-act="lic" data-id="${tn.id}">${t('registerLicense')}</button>
            <button class="btn ghost sm" data-act="${tn.status === 'suspended' ? 'activate' : 'suspend'}" data-id="${tn.id}">${tn.status === 'suspended' ? t('activate') : t('suspend')}</button>
            <button class="btn ghost sm" data-act="key" data-id="${tn.id}">${t('resetKey')}</button>
            <button class="btn ghost sm" data-act="users" data-id="${tn.id}">${t('users')}</button>
            <button class="btn danger sm" data-act="delete" data-id="${tn.id}" data-name="${escapeHtml(tn.name)}">${t('delete')}</button>
          </div>
          <div class="users" data-users="${tn.id}" hidden></div>
        </div>
      </div>`;
  }).join('');
}

// Jenis pengguna tenant yang dipulangkan GET /api/super/tenants/:id/users.
type TenantUser = { id: string; username: string; active?: number; created_at?: string; createdAt?: number | string };

// Lukis kotak "Users" tenant: senarai pengguna + tindakan setiap baris
// (reset kata laluan, aktif/nyahaktif, padam) dan borang mini tambah
// pengguna — dipanggil semula selepas setiap tindakan supaya status terkini.
async function renderTenantUsers(box: HTMLElement, tenantId: string) {
  const users: TenantUser[] = await api(`/api/super/tenants/${tenantId}/users`);
  box.innerHTML = users.map((u) => `
    <div class="roster-row">
      <span class="day-label">${escapeHtml(u.username)} <span class="chip ${Number(u.active ?? 1) ? 'ok' : 'err'}">${Number(u.active ?? 1) ? t('adminBadge') : t('userInactiveBadge')}</span></span>
      <span class="sub">${t('createdOn', { d: new Date(Number(u.createdAt || u.created_at) || String(u.createdAt || u.created_at || '')).toLocaleDateString() })}</span>
      <button class="btn ghost sm" data-act="resetpw" data-id="${u.id}">${t('resetPassword')}</button>
      <button class="btn ghost sm" data-act="toggleuser" data-id="${u.id}" data-active="${Number(u.active ?? 1)}">${Number(u.active ?? 1) ? t('suspend') : t('activate')}</button>
      <button class="btn danger sm" data-act="deluser" data-id="${u.id}">${t('removeUser')}</button>
    </div>`).join('') + `
    <div class="form-grid" style="margin-top:10px">
      <label><span>${t('usernameLabel')}</span><input type="text" class="su-new-user" maxlength="60"></label>
      <label><span>${t('passwordLabel')}</span><input type="password" class="su-new-pass" autocomplete="new-password"></label>
      <button class="btn primary sm" data-act="adduser" data-id="${tenantId}">${t('addUser')}</button>
    </div>`;
}

$('tenantList').addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'lic') {
      const code = ((btn.closest('.announcement-item') as HTMLElement).querySelector('.lic-code') as HTMLInputElement).value.trim();
      if (!code) return toast(t('licenseCodeLabel') + '?', 'err');
      await api(`/api/super/tenants/${id}/license`, { method: 'POST', body: { code } });
      toast(t('licenseActive'));
    } else if (act === 'suspend' || act === 'activate') {
      await api(`/api/super/tenants/${id}`, { method: 'PATCH', body: { status: act === 'suspend' ? 'suspended' : 'licensed' } });
      toast(t('settingsSaved'));
    } else if (act === 'key') {
      const r = await api<{ apiKey: string }>(`/api/super/tenants/${id}/api-key`, { method: 'POST', body: {} });
      toast(`${t('apiKeyLabel')}: ${r.apiKey}`);
    } else if (act === 'users') {
      const box = document.querySelector(`[data-users="${id}"]`) as HTMLElement;
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      await renderTenantUsers(box, String(id));
      return; // kekalkan kotak terbuka — jangan tutup semula tenant list
    } else if (act === 'adduser') {
      const item = btn.closest('.announcement-item') as HTMLElement;
      const username = (item.querySelector('.su-new-user') as HTMLInputElement).value.trim();
      const password = (item.querySelector('.su-new-pass') as HTMLInputElement).value;
      // Pengesahan sisi pelanggan sama seperti borang lain (server menyemak semula).
      if (!username || password.length < 6) return toast(t('userAddFailed'), 'err');
      await api(`/api/super/tenants/${id}/users`, { method: 'POST', body: { username, password } });
      toast(t('userAdded'));
      const box = item.querySelector('.users') as HTMLElement;
      await renderTenantUsers(box, String(id));
      return;
    } else if (act === 'resetpw') {
      const row = btn.closest('.roster-row') as HTMLElement | null;
      const uname = row?.querySelector('.day-label')?.firstChild?.textContent || '';
      const pw = prompt(t('resetPasswordPrompt', { name: uname.trim() }));
      if (pw === null) return; // batal
      if (pw.length < 6) return toast(t('pwTooShort'), 'err');
      await api(`/api/super/users/${id}`, { method: 'PATCH', body: { password: pw } });
      toast(t('resetPasswordDone', { name: uname.trim() }));
      return;
    } else if (act === 'toggleuser') {
      const nextActive = btn.dataset.active !== '1';
      await api(`/api/super/users/${id}`, { method: 'PATCH', body: { active: nextActive } });
      toast(nextActive ? t('userActivated') : t('userDeactivated'));
      const box = btn.closest('.users') as HTMLElement;
      const tenantId = (box.dataset.users || '') as string;
      await renderTenantUsers(box, tenantId);
      return;
    } else if (act === 'deluser') {
      const uname = (btn.closest('.roster-row') as HTMLElement | null)?.querySelector('.day-label')?.firstChild?.textContent || '';
      if (!confirm(t('userDeleteConfirm', { name: uname.trim() }))) return;
      await api(`/api/super/users/${id}`, { method: 'DELETE' });
      toast(t('annDeleted'));
      const box = btn.closest('.users') as HTMLElement;
      if (box) { await renderTenantUsers(box, box.dataset.users || ''); return; }
    } else if (act === 'delete') {
      const name = btn.dataset.name || '';
      if (!confirm(t('deleteTenantConfirm', { name }))) return;
      await api(`/api/super/tenants/${id}`, { method: 'DELETE' });
      toast(t('annDeleted'));
    }
    await refreshTenants();
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

$('suCreateTenant').addEventListener('click', async () => {
  const name = String($('suTenantName').value).trim();
  const username = String($('suTenantUsername').value).trim();
  const password = String($('suTenantPassword').value);
  try {
    const res = await api<{ name: string; apiKey: string }>('/api/super/tenants', { method: 'POST', body: { name, username, password } });
    toast(`${res.name} — ${t('apiKeyLabel')}: ${res.apiKey}`);
    $('suTenantName').value = '';
    $('suTenantUsername').value = '';
    $('suTenantPassword').value = '';
    await refreshTenants();
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

// ------------------------------------------------------------------ TV & Paparan (pairing)

// Cache payload peranti dikongsi oleh renderTv() dan dshowOptions() — kedua-
// duanya membaca /api/admin/devices; tanpa cache, kitaran sync 10sa menjana
// DUA fetch endpoint yang sama. TTL 5 minit untuk pembaca datalist; renderTv
// (tindakan pairing/unpair/rename) sentiasa fetch segar dan mengisi cache.
let devicesCache: TvDevice[] | null = null;
let devicesCacheAt = 0;
const DEVICES_CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchDevices(force = false): Promise<TvDevice[]> {
  if (!force && devicesCache && Date.now() - devicesCacheAt < DEVICES_CACHE_TTL_MS) {
    return devicesCache;
  }
  const res = await api<{ devices?: TvDevice[] }>('/api/admin/devices');
  devicesCache = res.devices || [];
  devicesCacheAt = Date.now();
  return devicesCache;
}

// Batalkan cache peranti selepas tindakan pairing/unpair/rename — supaya
// status kiosk (pairedDeviceCount) + datalist DSHOW segar serta-merta, bukan
// menunggu TTL 5 minit (W3-f: admin menyangka pairing gagal).
function invalidateDevicesCache(): void {
  devicesCache = null;
  devicesCacheAt = 0;
}

async function renderTv() {
  const list = $('tvDeviceList');
  if (!list) return;
  try {
    const devices = await fetchDevices(true);
    if (!devices.length) {
      list.innerHTML = `<p class="sub">${escapeHtml(t('tvEmpty'))}</p>`;
      return;
    }
    list.innerHTML = devices.map((d) => {
      const cams = d.hw?.cameras || [];
      const dshow = d.hw?.dshow || [];
      const camLine = cams.length
        ? `📹 ${cams.map((c) => `${escapeHtml(c.name || 'Kamera')}${c.status === 'OK' ? '' : ' ⚠'}`).join(', ')}`
        : '';
      // Nama peranti DSHOW sebenar — boleh copy terus ke medan URL stream
      // (video=<nama>). Dipapar bila kiosk melaporkan peranti.
      const dshowLine = dshow.length
        ? `🎥 DSHOW: ${dshow.map((c) => `video=${escapeHtml(dshowDeviceName(c))}`).join(' • ')}`
        : '';
      // Laporan crash kiosk (B9, opt-in MASJIDTV_CRASH_UPLOAD=1) — chip merah
      // + baris <details> boleh kembang dengan 5 ralat terkini; hanya dipapar
      // bila laporan wujud (tiada laporan = tiada perubahan UI).
      const errs = Array.isArray(d.hw?.errors) ? d.hw.errors.filter((x) => x && x.message) : [];
      const errLine = errs.length
        ? `<span class="status-chip err">${t('crashCount', { n: errs.length })}</span>
           <details style="margin-top:2px"><summary class="sub" style="font-size:11px;cursor:pointer">${t('crashLast', { msg: escapeHtml(errs[0].message || '') })}</summary>${
             errs.slice(0, 5).map((x) => `<p class="sub" style="font-size:11px;margin-top:2px">⚠️ ${x.at ? new Date(Number(x.at)).toLocaleString() : ''} — ${escapeHtml(x.message)}</p>`).join('')
           }</details>`
        : '';
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(196,220,248,0.12)">
        <div style="min-width:0">
          <strong>${escapeHtml(d.name || d.device_id)}</strong>
          <p class="sub" style="font-size:11px;word-break:break-all">${escapeHtml(d.device_id)} • ${
            d.last_seen ? new Date(Number(d.last_seen) || (d.last_seen as unknown as string)).toLocaleString() : '—'
          }</p>
          ${camLine ? `<p class="sub" style="font-size:11px;margin-top:2px">${camLine}</p>` : ''}
          ${dshowLine ? `<p class="sub" style="font-size:11px;margin-top:2px">${dshowLine}</p>` : ''}
          ${errLine}
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn ghost sm" data-rename="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name || '')}">✏️ ${escapeHtml(t('tvRename'))}</button>
          <button class="btn ghost sm" data-unpair="${escapeHtml(d.id)}">${escapeHtml(t('tvUnpair'))}</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<p class="sub">${escapeHtml((err as Error).message)}</p>`;
  }
}

$('tvPairBtn').addEventListener('click', async () => {
  const code = String($('tvPairCode').value).trim().toUpperCase();
  if (!code) return toast(t('tvPairCode'), 'err');
  try {
    await api('/api/admin/pair', { method: 'POST', body: { code } });
    toast(t('tvPairBtn') + ' ✓');
    $('tvPairCode').value = '';
    invalidateDevicesCache();
    renderTv();
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

$('tvDeviceList').addEventListener('click', async (e) => {
  const renameBtn = (e.target as HTMLElement).closest('[data-rename]') as HTMLElement | null;
  if (renameBtn) {
    const current = renameBtn.dataset.name || '';
    const name = prompt(t('tvRenamePrompt'), current);
    if (name === null) return; // batal
    const clean = name.trim().slice(0, 60);
    if (!clean) return toast(t('tvRenameEmpty'), 'err');
    try {
      await api(`/api/admin/devices/${renameBtn.dataset.rename}`, { method: 'PATCH', body: { name: clean } });
      toast(t('tvRename') + ' ✓');
      invalidateDevicesCache();
      renderTv();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
    return;
  }
  const btn = (e.target as HTMLElement).closest('[data-unpair]') as HTMLElement | null;
  if (!btn) return;
  try {
    await api(`/api/admin/devices/${btn.dataset.unpair}`, { method: 'DELETE' });
    toast(t('tvUnpair') + ' ✓');
    invalidateDevicesCache();
    renderTv();
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

// ------------------------------------------------------------- pemilih DSHOW

// Pilihan datalist untuk medan URL stream DSHOW: kesatuan dshow[] yang
// dilaporkan oleh semua peranti terpaut tenant (endpoint admin sedia ada
// /api/admin/devices). Nilai = "video=<nama>" (skim tepat yang server
// jangkakan — lihat packages/server/src/streams.ts); label = nama peranti
// TV + nama peranti DSHOW. [] jika tiada laporan — medan kekal teks-bebas.
async function dshowOptions(): Promise<DshowOption[]> {
  const devices = await fetchDevices(); // cache TTL 5 minit — bukan fetch setiap panggilan
  const seen = new Set<string>();
  const opts: DshowOption[] = [];
  for (const d of devices) {
    for (const raw of d.hw?.dshow || []) {
      const name = dshowDeviceName(raw);
      if (!name) continue;
      const value = `video=${name}`;
      if (seen.has(value)) continue; // nama sama daripada dua peranti — sekali sahaja
      seen.add(value);
      opts.push({ value, label: `${d.name || d.device_id} — ${name}` });
    }
  }
  return opts;
}

// ------------------------------------------------------------- status kiosk & upload

// Bilangan peranti kiosk berpasangan — dipapar pada label status kad stream
// (hos awan tiada ffmpeg; relay kamera/cermin berlaku pada kiosk). Guna cache
// yang sama seperti dshowOptions supaya tidak menambah panggilan API.
// Kegagalan rangkaian → null (teras kembali kepada unjuran pelayan).
async function pairedDeviceCount(): Promise<number | null> {
  try {
    return (await fetchDevices()).length;
  } catch {
    return null;
  }
}

// Ralat muat naik: unjur "Blob tidak dikonfigurasi" kepada arahan boleh
// tindak; mesej lain dipapar verbatim (null = tiada pemetaan).
function uploadErrorMessage(raw: string): string | null {
  return /blob tidak dikonfigurasi/i.test(raw) ? t('uploadBlobMissing') : null;
}

// Jumlah peranti berpasangan MASA KINI daripada cache devices (sync) — untuk
// kad panduan first-run. Cache diisi renderTv/loadApp; kosong → fetch latar
// belakang (tidak menyekat render) — checklist dikemas kini pada sync seterusnya.
function deviceCount(): number {
  if (!devicesCache) fetchDevices().catch(() => {});
  return devicesCache ? devicesCache.length : 0;
}

registerAdminFeatures({ renderTv, refreshTenants, renderOverviewExtra, dshowOptions, pairedDeviceCount, deviceCount, uploadErrorMessage });

// ------------------------------------------------------------- pustaka media (A4)

// Kad "Media library" dalam view Kandungan — memuatkan senarai media Blob
// tenant ATAS PERMINTAAN (butang "Load media"), bukan pada setiap sync, supaya
// kitaran 10sa tidak mem-fetch endpoint baharu berulang kali. Imej dipapar
// sebagai thumbnail; video/audio/teks dipapar sebagai baris dengan pautan.
function renderMediaList(items: MediaItem[]) {
  const list = $('mediaList');
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(t('mediaEmpty'))}</div>`;
    return;
  }
  list.innerHTML = items.map((m) => `
    <div class="announcement-item" data-id="${escapeHtml(m.id)}">
      <div>
        <div class="ann-title">${escapeHtml(m.filename.split('/').pop() || m.filename)} <span class="chip neutral">${escapeHtml(m.kind)}</span></div>
        <div class="ann-meta">
          <span>${t('createdOn', { d: new Date(Number(m.createdAt)).toLocaleDateString() })}</span>
          <a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${escapeHtml(m.url)}</a>
        </div>
        ${m.kind === 'image' ? `<img class="img-preview" src="${escapeHtml(m.url)}" alt="" loading="lazy">` : ''}
      </div>
      <div class="ann-actions">
        <button class="btn danger sm" data-media-del="${escapeHtml(m.id)}">${t('delete')}</button>
      </div>
    </div>`).join('');
}

$('mediaRefreshBtn').addEventListener('click', async () => {
  const list = $('mediaList');
  try {
    const items = await api<MediaItem[]>('/api/admin/media');
    list.hidden = false;
    renderMediaList(items);
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

$('mediaList').addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest('[data-media-del]') as HTMLElement | null;
  if (!btn) return;
  if (!confirm(t('mediaDeleteConfirm'))) return;
  try {
    await api(`/api/admin/media/${btn.dataset.mediaDel}`, { method: 'DELETE' });
    toast(t('mediaDeleted'));
    const items = await api<MediaItem[]>('/api/admin/media');
    renderMediaList(items);
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});
