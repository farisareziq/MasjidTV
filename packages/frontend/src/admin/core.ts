'use strict';

// Teras admin dikongsi oleh admin.ts (lokal) & admin-cloud.ts (awan).
// Semua logik dikekalkan verbatim daripada pelaksanaan asal; hanya kod aras
// atas yang BERKESAN-SAMPINGAN (pendengar acara, pemasa, boot) dipindahkan ke
// dalam bootAdmin(cfg) supaya tiada apa-apa berjalan semasa import modul ini.
// Perbezaan varian diparameterkan melalui AdminVariantConfig + cangkuk ciri
// yang didaftarkan oleh modul varian (cloud.ts/local.ts).

// ------------------------------------------------------------- jenis domain
// Nota: jenis diimport daripada teras domain @masjidtv/shared (jenis sahaja,
// dipadam semasa kompil — kelakuan runtime kekal serupa dengan baseline JS).
import type { Settings, Announcement, EventsSyncSettings, PrayerTimePayload } from '@masjidtv/shared';

import {
  $, state, setCfg, featureHooks, F,
  WEEKDAYS, STREAM_TYPES, COLOR_PRESETS
} from './types';
import type { AdminVariantConfig, AdminStatus, StreamRow, LicenseInfo } from './types';
import { t, applyLang, setAdminLang, setRenderAll } from './i18n';
import { escapeHtml, formatDuration, formatUptime, shiftTime } from './util';
import { api, uploadFile, toast, showLogin, showApp, showPinChange, switchView } from './api';

function renderAll() {
  if (!state.status) return;
  renderOverview();
  renderAnnouncements(state.announcements || []);
  populateSettings(state.settings || {});
  if (featureHooks.renderTv) featureHooks.renderTv();
}

// ------------------------------------------------------------------ overview

async function loadApp() {
  showApp();
  // (awan sahaja) Superuser melihat konsol masjid — bukan tetapan masjid.
  const isSuper = F.login() && state.role === 'superuser';
  if (F.login()) {
    $('masjidNavBtn').hidden = !isSuper;
    $('tvNavBtn').hidden = isSuper;
    $('licenseCard').hidden = isSuper;
    $('changePinBtn').hidden = !isSuper;
  }
  try {
    if (isSuper && featureHooks.refreshTenants) {
      await featureHooks.refreshTenants();
      $('sideMosque').textContent = 'Superuser';
      $('sideVersion').textContent = 'v0.2.0';
      switchView('masjid');
      return;
    }
    const [status, settings, methods, zonesRes, announcements, today, streamsRes] = await Promise.all([
      api<AdminStatus>('/api/admin/status'),
      api<Settings>('/api/admin/settings'),
      api<Record<string, { label: string }>>('/api/methods'),
      api<{ zones?: Record<string, Array<{ zone: string; label: string }>> }>('/api/zones'),
      api<Array<Announcement & { status?: string }>>('/api/admin/announcements'),
      api<import('@masjidtv/shared').TodayPayload>('/api/today'),
      api<{ streams?: StreamRow[]; ffmpegOk?: boolean | null }>('/api/admin/streams')
    ]);
    const license = F.licenseCard() ? await api<LicenseInfo>('/api/admin/license') : undefined;
    state.status = status;
    state.methods = methods;
    state.zones = zonesRes.zones || {};
    state.today = today;
    state.streamsStatus = streamsRes.streams || [];
    state.ffmpegOk = streamsRes.ffmpegOk;
    state.announcements = announcements;
    state.settings = settings;
    state.license = license;
    $('sideMosque').textContent = status.mosque;
    $('sideVersion').textContent = `v${status.version}`;
    renderOverview();
    renderAnnouncements(announcements);
    populateSettings(settings);
    switchView('overview');
  } catch (err) {
    toast((err as Error).message, 'err');
  }
}

function renderOverview() {
  const s = state.status;
  $('ovServer').textContent = `${s.mosque} • ${s.language.toUpperCase()}`;
  $('ovUptime').textContent = t('runningFor', { time: formatUptime(s.uptime), version: s.version });
  $('ovAnnouncements').textContent = String(s.counts.announcements);
  $('ovActive').textContent = t('activeNow', { n: s.counts.activeAnnouncements });
  if (s.nextEvent) {
    $('ovEvent').textContent = s.nextEvent.today ? `🎉 ${s.nextEvent.name}` : s.nextEvent.name;
    $('ovEventDays').textContent = s.nextEvent.today ? t('eventToday') : t('eventDays', { n: s.nextEvent.daysLeft, date: s.nextEvent.next });
  }
  $('ovScreenUrl').textContent = s.screenUrl;
  const urlHtml = `<strong>${escapeHtml(s.screenUrl)}</strong>`;
  // (ciri varian) Awan: nota URL awam Vercel + kiosk berpasangan; lokal
  // kekal teks LAN/ffmpeg pada mini PC (kunci asal).
  $('note1').innerHTML = t(F.kioskStreams() ? 'note1Cloud' : 'note1', { url: urlHtml });
  $('passwordNote').hidden = !s.adminPasswordFile;
  if (s.adminPasswordFile) {
    $('passwordNote').innerHTML = t('notePassword', { file: '<code>server/data/ADMIN_PASSWORD.txt</code>' });
  }
  $('audioNote').hidden = !s.audioEnabled;
  $('streamNote').hidden = s.streamCount === 0;
  $('streamNote').innerHTML = t(F.kioskStreams() ? 'noteStreamsCloud' : 'noteStreams', { count: `${s.activeStreamCount}/${s.streamCount}` });
  $('eventsSyncNote').hidden = !(s.eventsSync?.enabled);
  if (featureHooks.renderOverviewExtra) featureHooks.renderOverviewExtra();
  renderFirstRun();
  renderNextPrayer();
}

// ---------------------------------------------------------- first-run guide
// Kad panduan "langkah pertama" — dipapar hanya bila mana-mana langkah asas
// belum selesai (nama masjid lalai / zon belum dipilih / tiada pengumuman /
// tiada peranti TV). Membantu admin baharu yang membuka dashboard kosong.
function renderFirstRun() {
  const card = $('firstRunCard') as HTMLElement | null;
  const list = $('firstRunList') as HTMLElement | null;
  if (!card || !list || !state.status) return;
  const s = state.status;
  const settings = state.settings || ({} as Settings);
  const announcements = state.announcements || [];
  const deviceCount = featureHooks.deviceCount ? featureHooks.deviceCount() : -1; // -1 = tiada hook (lokal)

  // Nama masjid masih lalai? Semak nilai placeholder biasa.
  const mosqueName = (settings.mosque?.name || s.mosque || '').trim();
  const mosqueIsDefault = !mosqueName || /masjid al-?hidayah/i.test(mosqueName);
  // Zon belum dipilih? (kod zon kosong / 'auto' — lihat settings.prayer.zone)
  const zoneCode = (settings.prayer?.zone || s.prayerZone || '').trim();
  const zoneUnset = !zoneCode || zoneCode === 'auto';
  const noAnnouncements = announcements.length === 0;
  const noDevices = deviceCount === 0;

  const steps: Array<{ done: boolean; label: string }> = [
    { done: !mosqueIsDefault, label: t('firstRunStep1') },
    { done: !zoneUnset, label: t('firstRunStep2') },
    { done: !noAnnouncements, label: t('firstRunStep3') }
  ];
  // Hanya tunjukkan langkah pairing untuk varian yang ada hook peranti (awan).
  if (deviceCount >= 0) steps.push({ done: !noDevices, label: t('firstRunStep4') });

  const pending = steps.filter((st) => !st.done);
  if (!pending.length) { card.hidden = true; return; }
  card.hidden = false;
  list.innerHTML = steps.map((st) => {
    const mark = st.done ? '✅' : '⬜';
    const style = st.done ? ' style="opacity:.55;text-decoration:line-through"' : '';
    return `<li${style}>${mark} ${escapeHtml(st.label)}</li>`;
  }).join('');
}

function renderNextPrayer() {
  const next = state.today?.next;
  if (!next) return;
  const nameKey = `prayer${next.key.charAt(0).toUpperCase()}${next.key.slice(1)}`;
  $('ovNextPrayer').textContent = `${t(nameKey).toUpperCase()} ${next.time.time}`;
  updateNextCountdown();
}

function updateNextCountdown() {
  const next = state.today?.next;
  if (!next) return;
  const remain = next.time.ms - Date.now();
  $('ovCountdown').textContent = remain > 0 ? `in ${formatDuration(remain)}` : 'now';
}

// ------------------------------------------------------------- announcements

function renderAnnouncements(items: Array<Announcement & { status?: string }>) {
  const list = $('announcementList');
  if (!items.length) {
    if (F.annReorder()) state.announcements = [];
    list.innerHTML = `<div class="empty-state">${escapeHtml(t('emptyAnnouncements'))}</div>`;
    return;
  }
  if (F.annReorder()) state.announcements = items;
  const catLabel = (cat: string) => t(`cat${cat.charAt(0).toUpperCase()}${cat.slice(1)}`);
  list.innerHTML = items.map((a, i) => `
    <div class="announcement-item${a.active ? '' : ' inactive'}">
      <div>
        <div class="ann-title">${escapeHtml(a.title)}</div>
        <div class="ann-meta">
          <span class="chip ${escapeHtml(a.category)}">${escapeHtml(catLabel(a.category))}</span>
          <span class="chip ${a.status}">${t(a.status === 'active' ? 'statusActive' : 'statusInactive')}</span>
          ${a.video ? `<span class="chip event">${t('video')}</span>` : ''}
          ${a.start ? `<span>${t('from', { d: a.start })}</span>` : ''}
          ${a.end ? `<span>${t('until', { d: a.end })}</span>` : ''}          <span>${t('priorityN', { n: a.priority })}</span>
        </div>
        ${a.message ? `<p class="ann-msg">${escapeHtml(a.message)}</p>` : ''}
      </div>
      <div class="ann-actions">
        ${F.annReorder() ? `<div class="ann-sort">
          <button class="btn ghost sm" data-action="up" data-id="${a.id}" ${i === 0 ? 'disabled' : ''} title="▲">▲</button>
          <button class="btn ghost sm" data-action="down" data-id="${a.id}" ${i === items.length - 1 ? 'disabled' : ''} title="▼">▼</button>
        </div>` : ''}
        <button class="btn ghost sm" data-action="toggle" data-id="${escapeHtml(a.id)}">${a.active ? t('pause') : t('activate')}</button>
        <button class="btn ghost sm" data-action="edit" data-id="${escapeHtml(a.id)}">${t('edit')}</button>
        <button class="btn danger sm" data-action="delete" data-id="${escapeHtml(a.id)}">${t('delete')}</button>
      </div>
    </div>`).join('');
}

async function refreshAnnouncements() {
  const items = await api<Array<Announcement & { status?: string }>>('/api/admin/announcements');
  renderAnnouncements(items);
}

function openAnnouncementForm(item: (Announcement & { status?: string }) | null) {
  state.editingId = item ? item.id : null;
  $('announcementFormTitle').textContent = item ? t('editAnnouncement') : t('newAnnouncement');
  $('anTitle').value = item?.title || '';
  $('anCategory').value = item?.category || 'announcement';
  $('anMessage').value = item?.message || '';
  if (F.annQuran()) {
    $('anQuranDaily').checked = item ? item.quranDaily !== false : true;
    $('anArabic').value = item?.arabic || '';
    $('anTranslationMs').value = item?.translationMs || '';
    $('anTranslationEn').value = item?.translationEn || '';
    $('anRef').value = item?.ref || '';
  }
  if (F.annDoa()) {
    $('anDoaDaily').checked = item ? item.doaDaily !== false : true;
  }
  $('anStart').value = item?.start || '';
  $('anEnd').value = item?.end || '';
  $('anPriority').value = item?.priority ?? 0;
  $('anActive').checked = item ? item.active : true;
  $('anImageUrl').value = item?.image || '';
  $('anVideoUrl').value = item?.video || '';
  setMediaPreview(item?.image || '', item?.video || '');
  if (F.annQuran() || F.annDoa()) toggleDailyBox();
  $('announcementForm').hidden = false;
  $('announcementForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Kotak medan harian (Quran/Doa): papar bila kategori 'quran' atau 'doa';
// checkbox harian yang sepadan sah ditunjukkan.
function toggleDailyBox() {
  const cat = $('anCategory').value;
  const quran = cat === 'quran';
  const doa = cat === 'doa';
  $('anDailyBox').hidden = !quran && !doa;
  const qRow = document.getElementById('anQuranDailyRow');
  if (qRow) qRow.hidden = !quran;
  const dRow = document.getElementById('anDoaDailyRow');
  if (dRow) dRow.hidden = !doa;
  if (!String($('anTitle').value).trim()) {
    if (quran) $('anTitle').value = 'Ayat Quran Harian';
    else if (doa) $('anTitle').value = 'Doa Harian';
  }
}

function setMediaPreview(imageUrl: string, videoUrl: string) {
  const img = $('anImagePreview');
  const imgClear = $('anImageClear');
  const vid = $('anVideoPreview');
  const vidClear = $('anVideoClear');
  img.hidden = true;
  imgClear.hidden = true;
  vid.hidden = true;
  vidClear.hidden = true;
  if (videoUrl) {
    vid.src = videoUrl;
    vid.hidden = false;
    vidClear.hidden = false;
  } else if (imageUrl) {
    img.src = imageUrl;
    img.hidden = false;
    imgClear.hidden = false;
  }
}

async function refreshStatus() {
  state.status = await api<AdminStatus>('/api/admin/status');
  renderOverview();
}

// ------------------------------------------------------------------ settings

// Bendera "kotor": sebarang suntingan borang sejak isian semula terakhir.
// Sync 10sa TIDAK boleh menulis semula borang semasa kotor — itu memadam
// suntingan pengguna (semakan focus sahaja tidak cukup: klik butang warna/
// delete baris menalih fokus ke BODY dan suntingan hilang dalam ≤10sa).
let settingsDirty = false;

function populateSettings(s: Partial<Settings> & Record<string, any>) {
  $('stMosqueName').value = s.mosque.name;
  $('stTagline').value = s.mosque.tagline;
  $('stAddress').value = s.mosque.address;
  $('stLogoUrl').value = s.mosque.logo || '';
  setLogoPreview(s.mosque.logo || '');
  $('stLat').value = s.location.latitude;
  $('stLng').value = s.location.longitude;
  $('stPlace').value = s.location.name;
  $('stSource').value = s.prayer.source;
  $('stEventsAuto').checked = s.eventsSync.enabled !== false;
  $('stTimezone').value = s.prayer.timezone;
  $('stShowImsak').checked = s.prayer.showImsak;
  $('stImsakOffset').value = s.prayer.imsakOffset;
  $('stShowSunrise').checked = s.prayer.showSunrise;
  $('stAzanLead').value = s.prayer.azanLeadMinutes ?? 5;
  $('stIqamahOffset').value = s.prayer.iqamahOffsetMinutes ?? 10;
  $('stJemaahDur').value = s.prayer.jemaahDurationMinutes ?? 15;
  $('stAfterIqamah').value = s.prayer.afterIqamah === 'black' ? 'black' : 'jemaah';
  $('stAdjFajr').value = s.prayer.adjustments.fajr;
  $('stAdjSunrise').value = s.prayer.adjustments.sunrise;
  $('stAdjDhuhr').value = s.prayer.adjustments.dhuhr;
  $('stAdjAsr').value = s.prayer.adjustments.asr;
  $('stAdjMaghrib').value = s.prayer.adjustments.maghrib;
  $('stAdjIsha').value = s.prayer.adjustments.isha;
  $('stIqFajr').value = s.prayer.iqamah.fajr || '';
  $('stIqDhuhr').value = s.prayer.iqamah.dhuhr || '';
  $('stIqAsr').value = s.prayer.iqamah.asr || '';
  $('stIqMaghrib').value = s.prayer.iqamah.maghrib || '';
  $('stIqIsha').value = s.prayer.iqamah.isha || '';
  $('stLanguage').value = s.display.language;
  const colors = s.display.colors || COLOR_PRESETS.navy;
  const presetKey = Object.entries(COLOR_PRESETS).find(([, p]) =>
    p.bgTop === colors.bgTop && p.bgBottom === colors.bgBottom && p.gold === colors.gold && p.teal === colors.teal
  )?.[0] || '';
  $('stColorPreset').value = presetKey;
  if (F.headingFont()) $('stHeadingFont').value = s.display.headingFont || 'sans';
  $('stBgTop').value = colors.bgTop || '#06101f';
  $('stBgBottom').value = colors.bgBottom || '#0a1a2f';
  $('stText').value = colors.text || '#f3f6fb';
  $('stMuted').value = colors.muted || '#8fa4bd';
  $('stGold').value = colors.gold || '#e0bc6a';
  $('stTeal').value = colors.teal || '#62d9c6';
  $('stBgImage').value = s.display.backgroundImage || '';
  $('stBgClear').hidden = !s.display.backgroundImage;
  $('stBgOpacity').value = s.display.backgroundOpacity ?? 0;
  $('stBgOpacityVal').textContent = `${s.display.backgroundOpacity ?? 0}%`;
  const tm = (s.display.testMode || {}) as { enabled?: boolean; date?: string; time?: string };
  $('stTestEnabled').checked = tm.enabled === true;
  $('stTestDate').value = tm.date || '';
  $('stTestTime').value = tm.time || '';
  updateTestRef();
  $('stClockFormat').value = s.display.clockFormat;
  $('stShowSeconds').checked = s.display.showSeconds !== false;
  $('stSlideInterval').value = s.display.slideshowInterval;
  if (F.fridayKhutbah()) $('stFridayUntil').value = s.display.fridayKhutbahUntil || '13:55';
  $('stTickerSpeed').value = s.display.tickerSpeed || 'normal';
  $('stSafeMargin').value = s.display.safeMargin ?? 2;
  $('stMediaFit').value = s.display.mediaFit || 'stretch';
  $('stShowTicker').checked = s.display.showTicker;
  $('stTickerCustom').value = s.display.tickerCustom || '';
  $('stShowWeather').checked = s.display.showWeather;
  const sb = (s.display.staticBanner || {}) as { enabled?: boolean; title?: string; message?: string; image?: string };
  $('stBannerEnabled').checked = sb.enabled === true;
  $('stBannerTitle').value = sb.title || '';
  $('stBannerMessage').value = sb.message || '';
  $('stBannerImage').value = sb.image || '';
  $('stBannerClear').hidden = !sb.image;
  $('stWeatherEnabled').checked = s.weather.enabled;
  $('stWeatherUnit').value = s.weather.unit;
  $('stHijriOffset').value = s.hijriOffset;
  $('stAudioEnabled').checked = s.audio.enabled;
  $('stAdhanUrl').value = s.audio.adhanUrl || '';
  $('stIqamahUrl').value = s.audio.iqamahUrl || '';
  $('stFfmpegPath').value = s.media.ffmpegPath || 'ffmpeg';

  const methodSelect = $('stMethod');
  methodSelect.innerHTML = Object.entries(state.methods)
    .map(([key, m]) => `<option value="${key}" ${key === s.prayer.method ? 'selected' : ''}>${escapeHtml(m.label)}</option>`)
    .join('');

  const zoneSelect = $('stZone');
  zoneSelect.innerHTML = Object.entries(state.zones)
    .map(([negeri, list]) => {
      const opts = list
        .map((z) => `<option value="${z.zone}" ${z.zone === s.prayer.zone ? 'selected' : ''}>${z.zone} — ${escapeHtml(z.label)}</option>`)
        .join('');
      return `<optgroup label="${escapeHtml(negeri)}">${opts}</optgroup>`;
    })
    .join('');

  renderEvents(s.events || []);
  renderEventsSyncStatus(s.eventsSync || {});
  renderRoster(s.roster || {});
  renderStreams();
  // (ciri varian) Ayat bantuan kad stream: awan menerangkan relay kiosk
  // (tiada ffmpeg pada hos awan); lokal kekal ayat "ffmpeg pada mesin ini".
  if (F.kioskStreams()) $('streamsSub').textContent = t('streamsSubCloud');
  renderFfmpegStatus();
  settingsDirty = false; // isian programatik bukan suntingan pengguna
}

function setLogoPreview(url: string) {
  const preview = $('stLogoPreview');
  const clear = $('stLogoClear');
  if (url) {
    preview.src = url;
    preview.hidden = false;
    clear.hidden = false;
  } else {
    preview.hidden = true;
    clear.hidden = true;
  }
}

// ------------------------------------------------------- mod ujian (simulasi)

// Kunci solat untuk rujukan waktu — "jumaah" menggunakan waktu Zohor
// (aliran khutbah Jumaat menggantikan fasa jemaah Zohor pada hari Jumaat).
const testPrayerKey = (): string => {
  const v = String($('stTestPrayer').value);
  return v === 'jumaah' ? 'dhuhr' : v;
};

// Tarikh simulasi untuk ujian — "jumaah" memerlukan hari Jumaat sebenar,
// jadi gunakan Jumaat terdekat (hari ini jika hari ini Jumaat).
const nextFridayKey = (): string => {
  const d = new Date(`${state.today?.today || new Date().toISOString().slice(0, 10)}T00:00:00`);
  const add = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const testSimDate = (): string => ($('stTestPrayer').value === 'jumaah' ? nextFridayKey() : (state.today?.today || new Date().toISOString().slice(0, 10)));

function updateTestRef() {
  const sel = $('stTestPrayer').value;
  const key = testPrayerKey();
  const p = (state.today?.prayers as Record<string, PrayerTimePayload | undefined> | undefined)?.[key];
  if (!p) {
    $('stTestRef').textContent = '';
    return;
  }
  const iq = (state.today?.iqamah as Record<string, { time: string; ms: number } | undefined> | undefined)?.[key]?.time;
  const name = sel === 'jumaah' ? t('prayerJumaah') : t(`prayer${key.charAt(0).toUpperCase()}${key.slice(1)}`);
  const dayNote = sel === 'jumaah' ? ` • ${t('fridayJumaah')} → ${String((state.settings as Record<string, any> | null)?.display?.fridayKhutbahUntil || '13:55')}` : '';
  $('stTestRef').textContent = `${name} • azan ${p.time}${iq ? ` → iqamah ${iq}` : ''}${dayNote}`;
}

function setTestTimeFromPrayer(shiftMins: number | 'iqamah') {
  const key = testPrayerKey();
  const p = (state.today?.prayers as Record<string, PrayerTimePayload | undefined> | undefined)?.[key];
  if (!p) return toast(t('requestFailed', { s: 404 }), 'err');
  let time = p.time;
  if (shiftMins === -5) {
    time = shiftTime(p.time, -5);
  } else if (shiftMins === 'iqamah') {
    time = (state.today?.iqamah as Record<string, { time: string; ms: number } | undefined> | undefined)?.[key]?.time || shiftTime(p.time, Number($('stIqamahOffset').value) || 10);
  }
  $('stTestTime').value = time;
  // Jumaat memerlukan tarikh simulasi hari Jumaat supaya fasa khutbah aktif.
  if ($('stTestPrayer').value === 'jumaah') $('stTestDate').value = nextFridayKey();
}

// ------------------------------------------------------------------- streams

// Pilihan DSHOW semasa (diisi refreshDshowDatalist; kosong = datalist kosong,
// medan URL kekal teks-bebas seperti biasa — pemilih ialah penambahbaikan
// progresif, tiada perubahan pengesahan).
let dshowOpts: Array<{ value: string; label: string }> = [];

// Segarkan <datalist id="dshowDevices"> daripada cangkuk varian (awan:
// kesatuan dshow[] peranti terpaut; lokal: /api/devices-hw). Dipanggil pada
// setiap renderStreams() TETAPI dithrottle 5 minit — laporan perkakasan hampir
// statik; tanpa throttle, poller syncAdminData (10sa) mencetus fetch berterusan
// sepanjang sesi admin. Langkau juga bila tab tersembunyi. Kegagalan senyap.
let dshowLastFetch = 0;
const DSHOW_FETCH_TTL_MS = 5 * 60 * 1000;
async function refreshDshowDatalist(): Promise<void> {
  if (!featureHooks.dshowOptions) return;
  if (Date.now() - dshowLastFetch < DSHOW_FETCH_TTL_MS) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  dshowLastFetch = Date.now();
  try {
    dshowOpts = (await featureHooks.dshowOptions()) || [];
  } catch {
    dshowOpts = [];
  }
  const dl = document.getElementById('dshowDevices');
  if (!dl) return;
  dl.innerHTML = dshowOpts
    .map((o) => `<option value="${escapeHtml(o.value)}" label="${escapeHtml(o.label)}"></option>`)
    .join('');
}

function renderStreams() {
  const statusMap = new Map((state.streamsStatus || []).map((s) => [s.id, s]));
  const current = [...statusMap.values()].map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    url: s.url,
    duration: s.duration,
    enabled: s.enabled
  }));
  const list = $('streamList');
  if (!current.length) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(t('emptyStreams'))}</div>`;
    return;
  }
  // (ciri varian) Segarkan datalist peranti DSHOW pada setiap render —
  // tidak menyekat (fire-and-forget) supaya render kekal segerak.
  refreshDshowDatalist();
  list.innerHTML = current.map((s) => {
    const st = statusMap.get(s.id);
    const chip = streamStatusChip(st?.status);
    // Label bantuan hanya muncul untuk stream DSHOW bila peranti melapor
    // (penambahbaikan progresif — tiada peranti, tiada label, medan biasa).
    const dshowHint = s.type === 'dshow' && dshowOpts.length
      ? `<p class="sub" data-dshow-hint>${escapeHtml(t('dshowPickHint'))}</p>`
      : '';
    return `
      <div class="stream-row" data-id="${s.id}">
        <label><span data-i18n="streamName">Name</span><input type="text" class="st-name" value="${escapeHtml(s.name)}" placeholder="Camera 1"></label>
        <label><span data-i18n="streamType">Type</span><select class="st-type">
          ${STREAM_TYPES.map((ty) => `<option value="${ty}" ${ty === s.type ? 'selected' : ''}>${ty.toUpperCase()}</option>`).join('')}
        </select></label>
        <label><span data-i18n="seconds">Seconds</span><input type="number" class="st-duration" min="10" max="600" value="${s.duration || 30}"></label>
        <label class="st-url-wrap"><span data-i18n="streamUrl">URL</span><input type="text" class="st-url" list="dshowDevices" value="${escapeHtml(s.url)}" placeholder="rtsp://… / video=OBS Virtual Camera / https://…">${dshowHint}</label>
        <label class="checkbox-label"><input type="checkbox" class="st-enabled" ${s.enabled ? 'checked' : ''}> <span data-i18n="enabled">Enabled</span></label>
        <span class="status-chip ${chip.cls}">${chip.text}</span>
        <button class="row-del" data-del>✕</button>
      </div>`;
  }).join('');
}

function streamStatusChip(status: string | undefined): { cls: string; text: string } {
  switch (status) {
    case 'running': return { cls: 'ok', text: t('statusRunning') };
    case 'starting': return { cls: 'warn', text: t('statusStarting') };
    case 'configured': return { cls: 'ok', text: t('statusReady') };
    case 'ffmpeg-missing': return { cls: 'err', text: t('statusNoFfmpeg') };
    case 'disabled': return { cls: 'neutral', text: t('statusDisabled') };
    default: return { cls: 'err', text: status || t('statusStopped') };
  }
}

function collectStreams(): StreamRow[] {
  const rows = document.querySelectorAll('#streamList .stream-row');
  return [...rows].map((rowEl) => {
    const row = rowEl as HTMLElement;
    const q = (sel: string) => row.querySelector(sel) as HTMLInputElement | HTMLSelectElement;
    return {
      id: row.dataset.id,
      name: (q('.st-name') as HTMLInputElement).value,
      type: (q('.st-type') as HTMLSelectElement).value,
      url: (q('.st-url') as HTMLInputElement).value,
      duration: Number((q('.st-duration') as HTMLInputElement).value) || 30,
      enabled: (q('.st-enabled') as HTMLInputElement).checked
    };
  });
}

function renderFfmpegStatus() {
  const el = $('ffmpegStatus');
  // (awan sahaja) Hos awan tiada ffmpeg — status ffmpegOk pelayan membawa
  // maksud "ada kiosk berpasangan". Label jujur mengikut bilangan peranti
  // berpasangan (cache cangkuk varian) dan bukan dakwaan ffmpeg mesin ini.
  if (F.kioskStreams()) {
    if (state.ffmpegOk !== true) {
      el.textContent = t('kioskMissing');
      el.style.color = 'var(--danger)';
      return;
    }
    el.textContent = t('checkingFfmpeg');
    el.style.color = '';
    const hook = featureHooks.pairedDeviceCount;
    if (!hook) {
      // Cangkuk tidak didaftarkan — kekal mesej generik berdasarkan server.
      el.textContent = t('kioskOk', { n: '≥1' });
      el.style.color = 'var(--teal)';
      return;
    }
    hook().then((n) => {
      if (n === null) {
        // Rangkaian gagal — kembali kepada unjuran pelayan (≥ 1 kiosk).
        el.textContent = t('kioskOk', { n: '≥1' });
        el.style.color = 'var(--teal)';
      } else if (n > 0) {
        el.textContent = t('kioskOk', { n });
        el.style.color = 'var(--teal)';
      } else {
        el.textContent = t('kioskMissing');
        el.style.color = 'var(--danger)';
      }
    }).catch(() => {
      el.textContent = t('kioskOk', { n: '≥1' });
      el.style.color = 'var(--teal)';
    });
    return;
  }
  if (state.ffmpegOk === null) {
    el.textContent = t('checkingFfmpeg');
    el.style.color = '';
  } else if (state.ffmpegOk) {
    el.textContent = t('ffmpegOk');
    el.style.color = 'var(--teal)';
  } else {
    el.textContent = t('ffmpegMissing');
    el.style.color = 'var(--danger)';
  }
}

// -------------------------------------------------------------------- events

function renderEvents(events: Array<{ id: string; name: string; nameEn?: string; date: string; recurring: boolean; source?: string }>) {
  const list = $('eventList');
  if (!events.length) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(t('emptyEvents'))}</div>`;
    return;
  }
  list.innerHTML = events.map((e) => {
    const next = eventPreview(e);
    const chip = next
      ? `<span class="status-chip warn">${next.date} • ${t('daysShort', { n: next.days })}</span>`
      : `<span class="status-chip neutral">${t('eventNotUpcoming')}</span>`;
    const sourceChip = e.source === 'jakim'
      ? `<span class="status-chip ok">${t('sourceJakim')}</span>`
      : (e.source === 'anggaran' ? `<span class="status-chip warn">${t('sourceAnggaran')}</span>` : '');
    return `
      <div class="event-row" data-id="${e.id}">
        <label><span data-i18n="nameBm">Name (BM)</span><input type="text" class="ev-name" value="${escapeHtml(e.name)}" placeholder="Awal Ramadan"></label>
        <label><span data-i18n="nameEn">Name (EN)</span><input type="text" class="ev-nameen" value="${escapeHtml(e.nameEn || '')}" placeholder="Start of Ramadan"></label>
        <label><span data-i18n="date">Date</span><input type="date" class="ev-date" value="${e.date}"></label>
        <label class="checkbox-label"><input type="checkbox" class="ev-rec" ${e.recurring ? 'checked' : ''}> <span data-i18n="repeatYearly">Repeat yearly</span></label>
        ${sourceChip}
        ${chip}
        <button class="row-del" data-del>✕</button>
      </div>`;
  }).join('');
}

function eventPreview(e: { date: string; recurring: boolean }): { date: string; days: number } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = e.date.split('-').map(Number);
  let next: Date;
  if (e.recurring === false) {
    next = new Date(y, m - 1, d);
    if (next < today) return null;
  } else {
    next = new Date(now.getFullYear(), m - 1, d);
    if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  }
  const days = Math.round((next.getTime() - today.getTime()) / 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`, days };
}

function collectEvents() {
  return [...document.querySelectorAll('#eventList .event-row')].map((rowEl) => {
    const row = rowEl as HTMLElement;
    const q = (sel: string) => row.querySelector(sel) as HTMLInputElement;
    return {
      id: row.dataset.id,
      name: q('.ev-name').value,
      nameEn: q('.ev-nameen').value,
      date: q('.ev-date').value,
      recurring: q('.ev-rec').checked,
      custom: !String(row.dataset.id).startsWith('jakim-')
    };
  });
}

function renderEventsSyncStatus(sync: Partial<EventsSyncSettings> & Record<string, any>) {
  const el = $('eventsSyncStatus');
  const last = sync.lastSynced ? t('lastSynced', { t: new Date(sync.lastSynced).toLocaleString() }) : t('neverSynced');
  const status = sync.status === 'ok' ? '✅' : sync.status === 'error' ? '⚠️' : '⏳';
  el.textContent = `${status} ${sync.message || '—'} • ${last}`;
}

// -------------------------------------------------------------------- roster

function renderRoster(roster: Record<string, { imam?: string; bilal?: string }>) {
  const todayIdx = new Date().getDay(); // 0 = Sunday
  $('rosterGrid').innerHTML = WEEKDAYS.map(([key], i) => {
    const entry = roster[key] || {};
    const isToday = i === todayIdx;
    return `
      <div class="roster-row${isToday ? ' today' : ''}">
        <span class="day-label">${t(key)}${isToday ? ` • ${t('todayDuty')}` : ''}</span>
        <label><span data-i18n="imam">Imam</span><input type="text" data-day="${key}" data-role="imam" value="${escapeHtml(entry.imam || '')}" placeholder="Ustaz…"></label>
        <label><span data-i18n="bilal">Bilal</span><input type="text" data-day="${key}" data-role="bilal" value="${escapeHtml(entry.bilal || '')}" placeholder="En.…"></label>
      </div>`;
  }).join('');
}

function collectRoster(): Record<string, { imam: string; bilal: string }> {
  const roster: Record<string, { imam: string; bilal: string }> = {};
  document.querySelectorAll('#rosterGrid .roster-row').forEach((rowEl) => {
    const row = rowEl as HTMLElement;
    const imam = row.querySelector('[data-role="imam"]') as HTMLInputElement;
    const bilal = row.querySelector('[data-role="bilal"]') as HTMLInputElement;
    const day = imam.dataset.day!;
    roster[day] = { imam: imam.value, bilal: bilal.value };
  });
  return roster;
}

// ------------------------------------------------------------- save sections

function buildPatch(section: string): Record<string, unknown> {
  switch (section) {
    case 'mosque':
      return {
        mosque: {
          name: $('stMosqueName').value,
          tagline: $('stTagline').value,
          address: $('stAddress').value,
          logo: $('stLogoUrl').value
        }
      };
    case 'location':
      return { location: { latitude: $('stLat').value, longitude: $('stLng').value, name: $('stPlace').value } };
    case 'prayer':
      return {
        prayer: {
          zone: $('stZone').value,
          source: $('stSource').value,
          method: $('stMethod').value,
          timezone: $('stTimezone').value,
          showImsak: $('stShowImsak').checked,
          imsakOffset: Number($('stImsakOffset').value),
          showSunrise: $('stShowSunrise').checked,
          azanLeadMinutes: Number($('stAzanLead').value) || 5,
          iqamahOffsetMinutes: Number($('stIqamahOffset').value) || 10,
          jemaahDurationMinutes: Number($('stJemaahDur').value) || 15,
          afterIqamah: $('stAfterIqamah').value,
          adjustments: {
            fajr: Number($('stAdjFajr').value) || 0,
            sunrise: Number($('stAdjSunrise').value) || 0,
            dhuhr: Number($('stAdjDhuhr').value) || 0,
            asr: Number($('stAdjAsr').value) || 0,
            maghrib: Number($('stAdjMaghrib').value) || 0,
            isha: Number($('stAdjIsha').value) || 0
          },
          iqamah: {
            fajr: $('stIqFajr').value || '',
            dhuhr: $('stIqDhuhr').value || '',
            asr: $('stIqAsr').value || '',
            maghrib: $('stIqMaghrib').value || '',
            isha: $('stIqIsha').value || ''
          }
        }
      };
    case 'audio':
      return {
        audio: {
          enabled: $('stAudioEnabled').checked,
          adhanUrl: $('stAdhanUrl').value,
          iqamahUrl: $('stIqamahUrl').value
        }
      };
    case 'display':
      return {
        display: {
          language: $('stLanguage').value,
          ...(F.headingFont() ? { headingFont: $('stHeadingFont').value } : {}),
          clockFormat: $('stClockFormat').value,
          showSeconds: $('stShowSeconds').checked,
          slideshowInterval: Number($('stSlideInterval').value),
          ...(F.fridayKhutbah() ? { fridayKhutbahUntil: $('stFridayUntil').value } : {}),
          tickerSpeed: $('stTickerSpeed').value,
          safeMargin: Number($('stSafeMargin').value) || 0,
          mediaFit: $('stMediaFit').value,
          colors: {
            bgTop: $('stBgTop').value,
            bgBottom: $('stBgBottom').value,
            text: $('stText').value,
            muted: $('stMuted').value,
            gold: $('stGold').value,
            teal: $('stTeal').value
          },
          backgroundImage: $('stBgImage').value,
          backgroundOpacity: Number($('stBgOpacity').value) || 0,
          showTicker: $('stShowTicker').checked,
          tickerCustom: $('stTickerCustom').value,
          showWeather: $('stShowWeather').checked,
          staticBanner: {
            enabled: $('stBannerEnabled').checked,
            title: $('stBannerTitle').value,
            message: $('stBannerMessage').value,
            image: $('stBannerImage').value
          }
        }
      };
    case 'ffmpeg':
      return { media: { ffmpegPath: $('stFfmpegPath').value } };
    case 'roster':
      return { roster: collectRoster() };
    case 'weather':
      return { weather: { enabled: $('stWeatherEnabled').checked, unit: $('stWeatherUnit').value } };
    case 'hijri':
      return { hijriOffset: Number($('stHijriOffset').value) || 0 };
    default:
      return {};
  }
}

// ------------------------------------------------------- auto-sync 10 saat

async function syncAdminData() {
  if (!state.token) return;
  if (F.login() && state.role === 'superuser') return;
  const editing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  try {
    const [status, today, announcements] = await Promise.all([
      api<AdminStatus>('/api/admin/status'),
      api<import('@masjidtv/shared').TodayPayload>('/api/today'),
      api<Array<Announcement & { status?: string }>>('/api/admin/announcements')
    ]);
    state.status = status;
    state.today = today;
    state.announcements = announcements;
    renderOverview();
    renderAnnouncements(announcements);
    if (featureHooks.renderTv) featureHooks.renderTv();
    if (!editing && !settingsDirty) {
      const settings = await api<Settings>('/api/admin/settings');
      state.settings = settings;
      populateSettings(settings);
    }
  } catch {
    // Senyap semasa sync latar (cth. sesi tamat)
  }
}

// ----------------------------------------------------------------------- boot

export function bootAdmin(config: AdminVariantConfig): void {
  setCfg(config);
  setRenderAll(renderAll);

  // Auto-logout apabila idle melebihi 10 minit (boleh dipendekkan untuk ujian).
  const IDLE_TIMEOUT_MS = Number(window.TVM_IDLE_MS) || 10 * 60 * 1000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMousemove = 0;
  let lastScroll = 0;
  let lastActivity = Date.now();

  function resetIdleTimer() {
    if (!state.token) return;
    lastActivity = Date.now();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(idleLogout, IDLE_TIMEOUT_MS);
  }

  function idleLogout() {
    clearTimeout(idleTimer);
    state.token = '';
    localStorage.removeItem('tvm_token');
    showLogin();
    toast(t('idleLogout'), 'err');
  }

  // PWA/telefon: bila app kembali ke latar depan, timer background mungkin
  // tergantung. Semak masa idle sebenar - logout serta-merta jika terlebih.
  function checkIdleAfterResume() {
    if (!state.token) return;
    const elapsed = Date.now() - lastActivity;
    if (elapsed >= IDLE_TIMEOUT_MS) {
      idleLogout();
      return;
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(idleLogout, IDLE_TIMEOUT_MS - elapsed);
  }

  document.addEventListener('pointerdown', resetIdleTimer, { passive: true });
  document.addEventListener('keydown', resetIdleTimer);
  document.addEventListener('touchstart', resetIdleTimer, { passive: true });
  document.addEventListener('wheel', resetIdleTimer, { passive: true });
  document.addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - lastMousemove > 5000) {
      lastMousemove = now;
      resetIdleTimer();
    }
  }, { passive: true });
  document.addEventListener('scroll', () => {
    const now = Date.now();
    if (now - lastScroll > 5000) {
      lastScroll = now;
      resetIdleTimer();
    }
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkIdleAfterResume(); });
  window.addEventListener('focus', checkIdleAfterResume);
  window.addEventListener('pageshow', checkIdleAfterResume);

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView((btn as HTMLElement).dataset.view!));
  });

  const langSelect = document.getElementById('adminLang') as HTMLSelectElement | null;
  if (langSelect) langSelect.addEventListener('change', (e) => setAdminLang((e.target as HTMLSelectElement).value));

  // -------------------------------------------------------------------- login

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').hidden = true;
    try {
      if (F.login()) {
        const username = String($('loginUsername').value).trim();
        const password = $('loginPassword').value;
        const isSuper = username === 'admin';
        const res = await fetch(isSuper ? '/api/auth/superuser/login' : '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isSuper ? { username, pin: password } : { username, password })
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || t('signInFailed'));
        }
        const data = await res.json();
        state.token = data.token;
        state.role = data.role;
        localStorage.setItem('tvm_token', state.token);
        localStorage.setItem('tvm_role', state.role);
        $('loginPassword').value = '';
        $('loginUsername').value = '';
        if (data.role === 'superuser' && data.mustChangePin) {
          showPinChange();
          return;
        }
      } else {
        const password = $('loginPassword').value;
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error === 'Wrong password' ? t('wrongPassword') : (j.error || t('signInFailed')));
        }
        const data = await res.json();
        state.token = data.token;
        localStorage.setItem('tvm_token', state.token);
        $('loginPassword').value = '';
      }
      await loadApp();
      resetIdleTimer();
    } catch (err) {
      $('loginError').textContent = (err as Error).message;
      $('loginError').hidden = false;
    }
  });

  $('logoutBtn').addEventListener('click', () => {
    clearTimeout(idleTimer);
    state.token = '';
    if (F.login()) {
      state.role = '';
      localStorage.removeItem('tvm_role');
    }
    localStorage.removeItem('tvm_token');
    showLogin();
  });

  // (awan sahaja) Borang tukar PIN superuser.
  if (F.login()) {
    // Tukar PIN secara manual dari sidebar (superuser sahaja).
    $('changePinBtn').addEventListener('click', () => {
      pinChangeFromApp = true;
      showPinChange();
    });

    $('pinChangeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = $('pinNew').value;
      const confirm = $('pinConfirm').value;
      $('pinError').hidden = true;
      if (pin !== confirm) {
        $('pinError').textContent = t('pinMismatch');
        $('pinError').hidden = false;
        return;
      }
      if (String(pin).length < 8) {
        $('pinError').textContent = t('pinTooShort');
        $('pinError').hidden = false;
        return;
      }
      try {
        const res = await fetch('/api/auth/superuser/pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ pin })
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || t('signInFailed'));
        }
        const data = await res.json();
        if (data.token) {
          state.token = data.token;
          localStorage.setItem('tvm_token', state.token);
        }
        $('pinNew').value = '';
        $('pinConfirm').value = '';
        if (pinChangeFromApp) {
          pinChangeFromApp = false;
          toast(t('changePinOk'));
        }
        await loadApp();
        resetIdleTimer();
      } catch (err) {
        $('pinError').textContent = (err as Error).message;
        $('pinError').hidden = false;
      }
    });
  }

  setInterval(updateNextCountdown, 1000);

  $('openDisplayBtn').addEventListener('click', () => {
    if (state.status) window.open(state.status.screenUrl, '_blank');
  });

  $('copyUrlBtn').addEventListener('click', async () => {
    if (!state.status) return;
    try {
      await navigator.clipboard.writeText(state.status.screenUrl);
      toast(t('screenUrlCopied'));
    } catch {
      toast(t('copyFailed'), 'err');
    }
  });

  // ------------------------------------------------------------- announcements

  $('announcementList').addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLButtonElement | null;
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    try {
      if (action === 'toggle') {
        const current = await api<Array<Announcement & { status?: string }>>('/api/admin/announcements').then((list) => list.find((x) => x.id === id));
        if (!current) throw new Error(t('notFound'));
        await api(`/api/admin/announcements/${id}`, { method: 'PUT', body: { active: !current.active } });
        toast(current.active ? t('annPaused') : t('annActivated'));
      } else if (action === 'edit') {
        const current = await api<Array<Announcement & { status?: string }>>('/api/admin/announcements').then((list) => list.find((x) => x.id === id));
        // Item mungkin dipadam di tab/peranti lain — jangan buka borang
        // "baharu" kosong (save akan cipta pendua); tunjuk ralat sepertimana toggle.
        if (!current) throw new Error(t('notFound'));
        openAnnouncementForm(current);
        return;
      } else if ((action === 'up' || action === 'down') && F.annReorder()) {
        const idx = state.announcements.findIndex((x) => x.id === id);
        const swap = action === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || swap < 0 || swap >= state.announcements.length) return;
        const arr = [...state.announcements];
        [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
        renderAnnouncements(arr);
        await api('/api/admin/announcements/reorder', { method: 'POST', body: { ids: arr.map((x) => x.id) } });
        toast(t('annOrderSaved'));
        return;
      } else if (action === 'delete') {
        if (!confirm(t('deleteConfirm', { title: btn.closest('.announcement-item').querySelector('.ann-title').textContent }))) return;
        await api(`/api/admin/announcements/${id}`, { method: 'DELETE' });
        toast(t('annDeleted'));
      }
      await refreshAnnouncements();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  $('newAnnouncementBtn').addEventListener('click', () => openAnnouncementForm(null));
  $('refreshAnnouncementsBtn').addEventListener('click', async () => {
    try {
      await refreshAnnouncements();
      toast(t('annRefreshed'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });
  $('anCancel').addEventListener('click', () => {
    $('announcementForm').hidden = true;
    state.editingId = null;
  });

  if (F.annQuran() || F.annDoa()) $('anCategory').addEventListener('change', toggleDailyBox);

  $('anImage').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files![0];
    if (!file) return;
    try {
      const data = await uploadFile(file);
      if (data.kind === 'video') {
        $('anVideoUrl').value = data.url;
        $('anImageUrl').value = '';
        setMediaPreview('', data.url);
      } else {
        $('anImageUrl').value = data.url;
        $('anVideoUrl').value = '';
        setMediaPreview(data.url, '');
      }
      toast(t('mediaUploaded'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  $('anImageClear').addEventListener('click', () => {
    $('anImageUrl').value = '';
    $('anImage').value = '';
    setMediaPreview('', String($('anVideoUrl').value));
  });

  $('anVideoClear').addEventListener('click', () => {
    $('anVideoUrl').value = '';
    $('anImage').value = '';
    setMediaPreview(String($('anImageUrl').value), '');
  });

  $('anSave').addEventListener('click', async () => {
    const payload: Record<string, unknown> = {
      title: $('anTitle').value,
      message: $('anMessage').value,
      category: $('anCategory').value,
      start: $('anStart').value || null,
      end: $('anEnd').value || null,
      priority: Number($('anPriority').value) || 0,
      active: $('anActive').checked,
      image: $('anImageUrl').value || null,
      video: $('anVideoUrl').value || null
    };
    if (F.annQuran() || F.annDoa()) {
      if (F.annQuran()) payload.quranDaily = $('anQuranDaily').checked;
      if (F.annDoa()) payload.doaDaily = $('anDoaDaily').checked;
      payload.arabic = $('anArabic').value;
      payload.translationMs = $('anTranslationMs').value;
      payload.translationEn = $('anTranslationEn').value;
      payload.ref = $('anRef').value;
    }
    try {
      if (state.editingId) {
        await api(`/api/admin/announcements/${state.editingId}`, { method: 'PUT', body: payload });
        toast(t('annUpdated'));
      } else {
        await api('/api/admin/announcements', { method: 'POST', body: payload });
        toast(t('annCreated'));
      }
      $('announcementForm').hidden = true;
      state.editingId = null;
      await refreshAnnouncements();
      await refreshStatus();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  // ------------------------------------------------------------------ settings

  document.addEventListener('input', () => { settingsDirty = true; }, true);
  document.addEventListener('change', () => { settingsDirty = true; }, true);

  $('stLogoFile').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files![0];
    if (!file) return;
    try {
      const data = await uploadFile(file);
      if (data.kind !== 'image') throw new Error(t('logoMustImage'));
      $('stLogoUrl').value = data.url;
      setLogoPreview(data.url);
      toast(t('logoUploaded'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  $('stLogoClear').addEventListener('click', () => {
    $('stLogoUrl').value = '';
    $('stLogoFile').value = '';
    setLogoPreview('');
  });

  $('stColorPreset').addEventListener('change', (e) => {
    const p = COLOR_PRESETS[(e.target as HTMLSelectElement).value];
    if (!p) return;
    $('stBgTop').value = p.bgTop;
    $('stBgBottom').value = p.bgBottom;
    $('stText').value = p.text;
    $('stMuted').value = p.muted;
    $('stGold').value = p.gold;
    $('stTeal').value = p.teal;
    if (F.headingFont() && p.font) $('stHeadingFont').value = p.font;
  });

  $('stBgFile').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files![0];
    if (!file) return;
    try {
      const data = await uploadFile(file);
      if (data.kind !== 'image') throw new Error(t('bgMustImage'));
      $('stBgImage').value = data.url;
      $('stBgClear').hidden = false;
      toast(t('bgUploaded'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  $('stBgClear').addEventListener('click', () => {
    $('stBgImage').value = '';
    $('stBgFile').value = '';
    $('stBgClear').hidden = true;
  });

  $('stBgOpacity').addEventListener('input', (e) => {
    $('stBgOpacityVal').textContent = `${(e.target as HTMLInputElement).value}%`;
  });

  $('stBannerFile').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files![0];
    if (!file) return;
    try {
      const data = await uploadFile(file);
      if (data.kind !== 'image') throw new Error(t('bannerImage') + ': ' + t('logoMustImage'));
      $('stBannerImage').value = data.url;
      $('stBannerClear').hidden = false;
      toast(t('bannerUploaded'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  $('stBannerClear').addEventListener('click', () => {
    $('stBannerImage').value = '';
    $('stBannerFile').value = '';
    $('stBannerClear').hidden = true;
  });

  // ------------------------------------------------------- mod ujian (simulasi)

  $('stTestPrayer').addEventListener('change', updateTestRef);

  $('stTestMinus5').addEventListener('click', () => setTestTimeFromPrayer(-5));
  $('stTestAzan').addEventListener('click', () => setTestTimeFromPrayer(0));
  $('stTestIqamah').addEventListener('click', () => setTestTimeFromPrayer('iqamah'));

  $('stTestSave').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          display: {
            testMode: {
              enabled: $('stTestEnabled').checked,
              date: $('stTestDate').value,
              time: $('stTestTime').value,
              runFullTest: false
            }
          }
        }
      });
      toast(t('settingsSaved'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  // Ujian penuh: jalankan seluruh aliran azan→iqamah→jemaah secara LANGSUNG
  // dengan setiap fasa 1 minit — termasuk bunyi azan & iqamah. Jam simulasi
  // bermula pada (waktu azan − 1 minit) selepas jeda permulaan.
  $('stTestRunFull').addEventListener('click', async () => {
    const sel = $('stTestPrayer').value || 'maghrib';
    const key = testPrayerKey();
    const p = (state.today?.prayers as Record<string, PrayerTimePayload | undefined> | undefined)?.[key];
    if (!p) return toast(t('requestFailed', { s: 404 }), 'err');
    const phaseMin = 1;
    const azanTime = shiftTime(p.time, -phaseMin); // mula 1 minit sebelum azan
    const simDate = testSimDate(); // jumaah -> tarikh Jumaat terdekat
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          display: {
            testMode: {
              enabled: true,
              date: simDate,
              time: azanTime,
              runFullTest: true,
              startDelaySec: 10,
              prayerKey: sel,
              savedAtMs: Date.now(),
              phaseMs: phaseMin * 60000
            }
          }
        }
      });
      $('stTestEnabled').checked = true;
      $('stTestDate').value = simDate;
      $('stTestTime').value = azanTime;
      toast(t('testFullStarted'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  $('stAdhanFile').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files![0];
    if (!file) return;
    try {
      const data = await uploadFile(file);
      $('stAdhanUrl').value = data.url;
      toast(t('azanUploaded'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  $('stIqamahFile').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files![0];
    if (!file) return;
    try {
      const data = await uploadFile(file);
      $('stIqamahUrl').value = data.url;
      toast(t('iqamahUploaded'));
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  // ------------------------------------------------------------------- streams

  $('streamList').addEventListener('click', (e) => {
    const del = (e.target as HTMLElement).closest('[data-del]') as HTMLElement | null;
    if (!del) return;
    const row = del.closest('.stream-row') as HTMLElement | null;
    state.streamsStatus = collectStreams().filter((s) => s.id !== row!.dataset.id);
    renderStreams();
  });

  // Tunjuk/sembunyi label bantuan DSHOW serta-merta bila jenis stream
  // bertukar (tanpa render semula — nilai medan pengguna dikekalkan).
  $('streamList').addEventListener('change', (e) => {
    const sel = (e.target as HTMLElement).closest('select.st-type') as HTMLSelectElement | null;
    if (!sel) return;
    const hint = sel.closest('.stream-row')?.querySelector('[data-dshow-hint]') as HTMLElement | null;
    if (hint) hint.hidden = sel.value !== 'dshow';
  });

  $('addStreamBtn').addEventListener('click', () => {
    const draft = { id: `draft-${Date.now()}`, name: '', type: 'rtsp', url: '', duration: 30, enabled: true };
    state.streamsStatus = [...collectStreams(), draft];
    renderStreams();
  });

  $('saveStreamsBtn').addEventListener('click', async () => {
    try {
      const res = await api<{ streams?: StreamRow[]; ffmpegOk?: boolean | null }>('/api/admin/streams', { method: 'PUT', body: { streams: collectStreams() } });
      state.streamsStatus = res.streams || [];
      renderStreams();
      renderFfmpegStatus();
      toast(t('streamsSaved'));
      await refreshStatus();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  // -------------------------------------------------------------------- events

  $('eventList').addEventListener('click', (e) => {
    const del = (e.target as HTMLElement).closest('[data-del]') as HTMLElement | null;
    if (!del) return;
    del.closest('.event-row').remove();
  });

  $('addEventBtn').addEventListener('click', () => {
    const today = new Date();
    const row = document.createElement('div');
    row.className = 'event-row';
    row.dataset.id = `evt-${Date.now()}`;
    row.innerHTML = `
    <label>Name (BM)<input type="text" class="ev-name" placeholder="Awal Ramadan"></label>
    <label>Name (EN)<input type="text" class="ev-nameen" placeholder="Start of Ramadan"></label>
    <label>Date<input type="date" class="ev-date" value="${today.toISOString().slice(0, 10)}"></label>
    <label class="checkbox-label"><input type="checkbox" class="ev-rec" checked> Repeat yearly</label>
    <span class="status-chip neutral">new</span>
    <button class="row-del" data-del>✕</button>`;
    $('eventList').appendChild(row);
  });

  $('syncEventsBtn').addEventListener('click', async () => {
    try {
      toast(t('syncInProgress'));
      const result = await api<{ ok?: boolean; message?: string; synced?: number }>('/api/admin/events/sync', { method: 'POST', body: {} });
      if (!result.ok) throw new Error(result.message || 'Sync gagal');
      const settings = await api<Settings>('/api/admin/settings');
      renderEvents(settings.events || []);
      renderEventsSyncStatus(settings.eventsSync || {});
      toast(t('syncDone', { n: result.synced }));
      await refreshStatus();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  $('saveEventsBtn').addEventListener('click', async () => {
    try {
      const updated = await api<Settings>('/api/admin/settings', {
        method: 'PUT',
        body: { events: collectEvents(), eventsSync: { enabled: $('stEventsAuto').checked } }
      });
      renderEvents(updated.events || []);
      renderEventsSyncStatus(updated.eventsSync || {});
      toast(t('eventsSaved'));
      await refreshStatus();
      if ($('stEventsAuto').checked) {
        const result = await api<{ ok?: boolean; message?: string }>('/api/admin/events/sync', { method: 'POST', body: {} });
        if (!result.ok) throw new Error(result.message || 'Sync gagal');
        const settings = await api<Settings>('/api/admin/settings');
        renderEvents(settings.events || []);
        renderEventsSyncStatus(settings.eventsSync || {});
      }
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  // ------------------------------------------------------------- save sections

  document.querySelectorAll('[data-save]').forEach((btnEl) => {
    const btn = btnEl as HTMLElement;
    btn.addEventListener('click', async () => {
      const section = btn.dataset.save;
      const patch = buildPatch(section);
      try {
        const updated = await api<Settings>('/api/admin/settings', { method: 'PUT', body: patch });
        populateSettings(updated);
        toast(t('settingsSaved'));
        if (section === 'ffmpeg') {
          const res = await api<{ streams?: StreamRow[]; ffmpegOk?: boolean | null }>('/api/admin/streams');
          state.ffmpegOk = res.ffmpegOk;
          state.streamsStatus = res.streams || [];
          renderStreams();
          renderFfmpegStatus();
        }
      } catch (err) {
        toast((err as Error).message, 'err');
      }
    });
  });

  $('pwSaveBtn').addEventListener('click', async () => {
    const current = String($('pwCurrent').value);
    const next = String($('pwNew').value);
    const confirm = String($('pwConfirm').value);
    if (!current || !next) return toast(t('fillPasswords'), 'err');
    if (next.length < 6) return toast(t('pwTooShort'), 'err');
    if (next !== confirm) return toast(t('pwMismatch'), 'err');
    try {
      const data = await api<{ token?: string }>('/api/admin/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      if (F.tokenRotate() && data.token) {
        state.token = data.token;
        localStorage.setItem('tvm_token', state.token);
      }
      $('pwCurrent').value = '';
      $('pwNew').value = '';
      $('pwConfirm').value = '';
      toast(t('passwordChanged'));
      await refreshStatus();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  });

  setInterval(syncAdminData, 10000);

  if (state.token) {
    loadApp().then(() => resetIdleTimer()).catch(() => showLogin());
  } else {
    showLogin();
  }

  applyLang();

  // PWA — daftar service worker supaya admin boleh dipasang di telefon/tab.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

// (awan sahaja) Bendera sesi untuk tukar PIN manual dari sidebar — di luar
// bootAdmin supaya pendengar borang PIN boleh mengaksesnya.
let pinChangeFromApp = false;
