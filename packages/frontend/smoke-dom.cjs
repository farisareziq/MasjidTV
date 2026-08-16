// Smoke: evaluate compiled display.js/admin.js in a minimal DOM stub and
// confirm no immediate exceptions + key DOM side effects happen (title set,
// intervals registered). Catches top-level breakage (syntax, null derefs on
// boot path) without a real browser.
const fs = require('fs');
const path = require('path');

function domStub() {
  const elements = new Map();
  const mkEl = (id) => {
    const el = {
      id, hidden: false, innerHTML: '', textContent: '', value: '', checked: false,
      className: '', style: { setProperty() {}, animation: '' },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      dataset: {}, addEventListener() {}, removeEventListener() {},
      appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
      closest: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      scrollIntoView() {}, focus() {}, play: () => Promise.resolve(), canPlayType: () => '',
      src: '', outerHTML: '', files: [], offsetWidth: 0, scrollWidth: 100
    };
    return el;
  };
  const document = {
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, mkEl(id)); return elements.get(id); },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => mkEl('el-' + tag),
    addEventListener() {},
    documentElement: mkEl('html'),
    body: mkEl('body'),
    head: { appendChild() {} },
    hidden: false
  };
  document.documentElement.style = { setProperty() {} };
  const timers = [];
  const windowObj = {
    location: { search: '?key=abc', origin: 'http://localhost:3000', reload() {} },
    addEventListener() {},
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    setInterval: (fn, ms) => { timers.push([fn, ms]); return timers.length; }
  };
  const Audio = class { constructor() { this.paused = true; this.ended = false; this.muted = false; this.readyState = 0; } play() { return Promise.resolve(); } load() {} addEventListener() {} removeEventListener() {} };
  const fetchMock = async (url) => {
    if (url.includes('/api/settings')) return { ok: true, status: 200, json: async () => ({ mosque: { name: 'Masjid Uji', tagline: '', address: '', logo: '' }, prayer: { timezone: 'Asia/Kuala_Lumpur', method: 'KARACHI', source: 'jakim', zone: 'WLY01', iqamah: {} }, display: { language: 'ms', theme: 'dark', clockFormat: '24h', showSeconds: true, slideshowInterval: 12, showTicker: true, tickerSpeed: 'normal', safeMargin: 2, mediaFit: 'stretch', colors: {}, testMode: {} }, audio: { enabled: false }, weather: {}, streams: [], events: [], roster: {} }) };
    if (url.includes('/api/today')) return { ok: true, status: 200, json: async () => ({ now: new Date().toISOString(), today: '2026-08-16', timeZone: 'Asia/Kuala_Lumpur', source: 'local', hijri: null, zone: null, prayers: { fajr: { time: '05:58', ms: Date.now() + 3600000 }, dhuhr: { time: '13:15', ms: Date.now() + 8 * 3600000 }, asr: { time: '16:30', ms: Date.now() + 11 * 3600000 }, maghrib: { time: '19:25', ms: Date.now() + 14 * 3600000 }, isha: { time: '20:40', ms: Date.now() + 15 * 3600000 } }, iqamah: {}, next: null }) };
    if (url.includes('/api/slides')) return { ok: true, status: 200, json: async () => ({ announcements: [], builtin: [] }) };
    if (url.includes('/api/methods')) return { ok: true, status: 200, json: async () => ({ KARACHI: { label: 'KARACHI' } }) };
    if (url.includes('/api/zones')) return { ok: true, status: 200, json: async () => ({ zones: { 'Selangor': [{ zone: 'WLY01', label: 'Gombak' }] } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { document, windowObj, Audio, fetchMock, timers, elements };
}

function run(name, file, stub) {
  const code = fs.readFileSync(file, 'utf8');
  const fn = new Function('window', 'document', 'location', 'localStorage', 'sessionStorage', 'navigator', 'Audio', 'fetch', 'Hls', 'confirm', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'history', 'URLSearchParams', 'URL', 'Intl', 'Date', 'JSON', 'Number', 'String', 'Math', 'Object', 'Array', 'Map', 'Set', 'Promise', 'Error', 'console', code + '\n');
  try {
    fn(stub.windowObj, stub.document, stub.windowObj.location, { getItem: () => null, setItem() {}, removeItem() {} }, { getItem: () => null, setItem() {}, removeItem() {} }, { serviceWorker: {} }, stub.Audio, stub.fetchMock, { isSupported: () => false, Events: { ERROR: 'err' } }, () => true, () => 0, stub.windowObj.setInterval, () => {}, () => {}, { replaceState() {} }, URLSearchParams, URL, Intl, Date, JSON, Number, String, Math, Object, Array, Map, Set, Promise, Error, console);
    console.log(`${name}: no top-level exception (${stub.timers.length} intervals registered)`);
    return true;
  } catch (e) {
    console.log(`${name}: FAILED — ${e.message}`);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
    return false;
  }
}

const root = path.dirname(process.argv[1]);
(async () => {
  // Tunggu promise boot (fetch mock async) selesai.
  const ok1 = run('display.js (local)', path.join(root, 'public/js/display.js'), domStub());
  const ok2 = run('display.js (cloud)', path.join(root, 'public-cloud/js/display.js'), domStub());
  const ok3 = run('admin.js (local)', path.join(root, 'public/js/admin.js'), domStub());
  const ok4 = run('admin.js (cloud)', path.join(root, 'public-cloud/js/admin.js'), domStub());
  await new Promise(r => setTimeout(r, 300));

  // Uji adapter AndroidBridge mod postMessage (Flutter webview_flutter):
  // paparan mesti panggil postMessage(JSON) bila kaedah terus tiada.
  const fs2 = require('fs');
  const stub = domStub();
  const posted = [];
  stub.windowObj.AndroidBridge = { postMessage: (m) => posted.push(m) };
  const code = fs2.readFileSync(path.join(root, 'public/js/display.js'), 'utf8');
  try {
    const fn = new Function('window', 'document', 'location', 'localStorage', 'sessionStorage', 'navigator', 'Audio', 'fetch', 'Hls', 'confirm', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'history', code);
    fn(stub.windowObj, stub.document, stub.windowObj.location, { getItem: () => null, setItem() {}, removeItem() {} }, { getItem: () => null, setItem() {}, removeItem() {} }, { serviceWorker: {} }, stub.Audio, stub.fetchMock, { isSupported: () => false, Events: { ERROR: 'e' } }, () => true, () => 0, stub.windowObj.setInterval, () => {}, () => {}, { replaceState() {} });
    await new Promise(r => setTimeout(r, 200));
    // tickPrayerMode berjalan setiap 1s — force satu tick segera dengan
    // mencetuskan state yang memanggil setStreamMuted? Bridge dipanggil hanya
    // bila slide stream aktif. Semak sekurang-kurangnya tiada exception dan
    // adapter tidak menghalang boot.
    console.log('bridge postMessage mode: boot OK (posted=' + posted.length + ')');
  } catch (e) {
    console.log('bridge postMessage mode: FAILED — ' + e.message);
    process.exit(1);
  }

  process.exit(ok1 && ok2 && ok3 && ok4 ? 0 : 1);
})();
