'use strict';

// Ciri khusus AWAN untuk pentadbir MasjidTV — diimport oleh admin-cloud.ts
// SEBELUM bootAdmin() dipanggil. Mendaftar cangkuk yang dipanggil teras
// (renderTv, refreshTenants, blok lesen) dan memasang pendengar acara untuk
// konsol superuser + TV pairing. Kesan sampingan di aras modul selaras dengan
// kod aras atas admin-cloud.ts asal (pendengar dipasang sebaik sahaja skrip
// dimuat), jadi susunan import pada wrapper adalah signifikan.

import { $, state, registerAdminFeatures } from './types';
import type { LicenseInfo, TvDevice } from './types';
import { t, i18nEntry, currentAdminLang } from './i18n';
import { escapeHtml } from './util';
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
  const code = $('licCodeInput').value.trim();
  if (!code) return toast(t('licenseCodeLabel'), 'err');
  try {
    const res = await api('/api/admin/license', { method: 'POST', body: { code } });
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
  state.superTenants = await api('/api/super/tenants');
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
      const r = await api(`/api/super/tenants/${id}/api-key`, { method: 'POST', body: {} });
      toast(`${t('apiKeyLabel')}: ${r.apiKey}`);
    } else if (act === 'users') {
      const box = document.querySelector(`[data-users="${id}"]`) as HTMLElement;
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      const users: Array<{ id: string; username: string; created_at: string }> = await api(`/api/super/tenants/${id}/users`);
      box.innerHTML = users.map((u) => `
        <div class="roster-row">
          <span class="day-label">${escapeHtml(u.username)} <span class="chip ok">${t('adminBadge')}</span></span>
          <span class="sub">${t('createdOn', { d: new Date(u.created_at).toLocaleDateString() })}</span>
          <button class="btn danger sm" data-act="deluser" data-id="${u.id}">${t('removeUser')}</button>
        </div>`).join('');
    } else if (act === 'deluser') {
      const uname = (btn.closest('.roster-row') as HTMLElement | null)?.querySelector('.day-label')?.textContent || '';
      if (!confirm(t('userDeleteConfirm', { name: uname.trim() }))) return;
      await api(`/api/super/users/${id}`, { method: 'DELETE' });
      toast(t('annDeleted'));
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
  const name = $('suTenantName').value.trim();
  const username = $('suTenantUsername').value.trim();
  const password = $('suTenantPassword').value;
  try {
    const res = await api('/api/super/tenants', { method: 'POST', body: { name, username, password } });
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

async function renderTv() {
  const list = $('tvDeviceList');
  if (!list) return;
  try {
    const res = await api('/api/admin/devices');
    const devices: TvDevice[] = res.devices || [];
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
        ? `🎥 DSHOW: ${dshow.map((c) => `video=${escapeHtml(c.name || '')}`).join(' • ')}`
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
  const code = $('tvPairCode').value.trim().toUpperCase();
  if (!code) return toast(t('tvPairCode'), 'err');
  try {
    await api('/api/admin/pair', { method: 'POST', body: { code } });
    toast(t('tvPairBtn') + ' ✓');
    $('tvPairCode').value = '';
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
    renderTv();
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

registerAdminFeatures({ renderTv, refreshTenants, renderOverviewExtra });
