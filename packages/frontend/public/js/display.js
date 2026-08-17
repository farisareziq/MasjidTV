"use strict";
const AndroidBridgeRef = () => {
  const raw = window.AndroidBridge;
  if (!raw) return raw;
  if (typeof raw.setStreamSlot === "function") return raw;
  const send = (method) => (...args) => {
    raw.postMessage(JSON.stringify({ method, args }));
  };
  return {
    setStreamSlot: send("setStreamSlot"),
    playStream: send("playStream"),
    stopStream: send("stopStream"),
    setStreamMuted: send("setStreamMuted"),
    onSessionExpired: send("onSessionExpired")
  };
};
const $ = (id) => document.getElementById(id);
const I18N = {
  ms: {
    prayerTimes: "Waktu Solat",
    prayerTimesAr: "\u0627\u064E\u0644\u0652\u0623\u064E\u0648\u0652\u0642\u064E\u0627\u062A",
    nextPrayer: "Solat Seterusnya",
    adhan: "Azan",
    iqamah: "Iqamah",
    tomorrow: "Esok",
    info: "MAKLUMAT",
    source: "Sumber",
    api: "JAKIM / Aladhan",
    local: "Pengiraan Tempatan",
    imam: "Imam",
    bilal: "Bilal",
    dutyTitle: "Bertugas Hari Ini",
    kutipanTitle: "Kutipan",
    eventTitle: "Hari Kebesaran",
    daysLeft: "{n} hari lagi",
    today: "Hari ini",
    kutipan: "Kutipan",
    live: "LIVE",
    streamOffline: "Stream tidak tersedia",
    jemaah: "Solat Jemaah",
    fridayName: "Jumaat",
    fridayJemaah: "Khutbah & Solat Jumaat",
    welcome: "Selamat datang ke masjid. Jom hidupkan masjid bersama-sama!",
    names: {
      imsak: "Imsak",
      fajr: "Subuh",
      sunrise: "Syuruk",
      dhuhr: "Zohor",
      asr: "Asar",
      maghrib: "Maghrib",
      isha: "Isyak"
    },
    namesAr: {
      imsak: "\u0625\u0650\u0645\u0652\u0633\u064E\u0627\u0643",
      fajr: "\u0635\u064F\u0628\u0652\u062D",
      sunrise: "\u0634\u064F\u0631\u064F\u0648\u0642",
      dhuhr: "\u0638\u064F\u0647\u0652\u0631",
      asr: "\u0639\u064E\u0635\u0652\u0631",
      maghrib: "\u0645\u064E\u063A\u0652\u0631\u0650\u0628",
      isha: "\u0639\u0650\u0634\u064E\u0627\u0621"
    },
    weather: {
      0: "Cerah",
      1: "Cerah",
      2: "Separa Berawan",
      3: "Mendung",
      45: "Berkabus",
      48: "Berkabus",
      51: "Hujan Renyai",
      53: "Hujan Renyai",
      55: "Hujan Renyai",
      61: "Hujan",
      63: "Hujan",
      65: "Hujan Lebat",
      66: "Hujan Ais",
      67: "Hujan Ais",
      71: "Salji",
      73: "Salji",
      75: "Salji Lebat",
      80: "Hujan Ribut",
      81: "Hujan Ribut",
      82: "Hujan Ribut",
      95: "Ribut Petir",
      96: "Ribut Petir",
      99: "Ribut Petir"
    }
  },
  en: {
    prayerTimes: "Prayer Times",
    prayerTimesAr: "\u0627\u064E\u0644\u0652\u0623\u064E\u0648\u0652\u0642\u064E\u0627\u062A",
    nextPrayer: "Next Prayer",
    adhan: "Adhan",
    iqamah: "Iqamah",
    tomorrow: "Tomorrow",
    info: "INFO",
    source: "Source",
    api: "JAKIM / Aladhan",
    local: "Local Calculation",
    imam: "Imam",
    bilal: "Bilal",
    dutyTitle: "Today's Duty",
    kutipanTitle: "Collection",
    eventTitle: "Islamic Events",
    daysLeft: "{n} days left",
    today: "Today",
    kutipan: "Collection",
    live: "LIVE",
    streamOffline: "Stream unavailable",
    jemaah: "Congregational Prayer",
    fridayName: "Jumu'ah",
    fridayJemaah: "Khutbah & Friday Prayer",
    welcome: "Welcome to the mosque. Let us bring the mosque to life together!",
    names: {
      imsak: "Imsak",
      fajr: "Fajr",
      sunrise: "Sunrise",
      dhuhr: "Dhuhr",
      asr: "Asr",
      maghrib: "Maghrib",
      isha: "Isha"
    },
    namesAr: {
      imsak: "\u0625\u0650\u0645\u0652\u0633\u064E\u0627\u0643",
      fajr: "\u0635\u064F\u0628\u0652\u062D",
      sunrise: "\u0634\u064F\u0631\u064F\u0648\u0642",
      dhuhr: "\u0638\u064F\u0647\u0652\u0631",
      asr: "\u0639\u064E\u0635\u0652\u0631",
      maghrib: "\u0645\u064E\u063A\u0652\u0631\u0650\u0628",
      isha: "\u0639\u0650\u0634\u064E\u0627\u0621"
    },
    weather: {
      0: "Clear",
      1: "Clear",
      2: "Partly Cloudy",
      3: "Overcast",
      45: "Foggy",
      48: "Foggy",
      51: "Drizzle",
      53: "Drizzle",
      55: "Drizzle",
      61: "Rain",
      63: "Rain",
      65: "Heavy Rain",
      66: "Freezing Rain",
      67: "Freezing Rain",
      71: "Snow",
      73: "Snow",
      75: "Heavy Snow",
      80: "Rain Showers",
      81: "Rain Showers",
      82: "Rain Showers",
      95: "Thunderstorm",
      96: "Thunderstorm",
      99: "Thunderstorm"
    }
  }
};
const WEATHER_ICONS = {
  0: "\u2600\uFE0F",
  1: "\u{1F324}\uFE0F",
  2: "\u26C5",
  3: "\u2601\uFE0F",
  45: "\u{1F32B}\uFE0F",
  48: "\u{1F32B}\uFE0F",
  51: "\u{1F326}\uFE0F",
  53: "\u{1F326}\uFE0F",
  55: "\u{1F326}\uFE0F",
  61: "\u{1F327}\uFE0F",
  63: "\u{1F327}\uFE0F",
  65: "\u{1F327}\uFE0F",
  66: "\u{1F327}\uFE0F",
  67: "\u{1F327}\uFE0F",
  71: "\u{1F328}\uFE0F",
  73: "\u{1F328}\uFE0F",
  75: "\u{1F328}\uFE0F",
  80: "\u{1F326}\uFE0F",
  81: "\u{1F327}\uFE0F",
  82: "\u{1F327}\uFE0F",
  95: "\u26C8\uFE0F",
  96: "\u26C8\uFE0F",
  99: "\u26C8\uFE0F"
};
const state = {
  settings: null,
  today: null,
  slides: [],
  slidesData: null,
  slideIndex: 0,
  slideTimer: null,
  hls: null,
  audioCache: /* @__PURE__ */ new Map(),
  playedAdhan: /* @__PURE__ */ new Set(),
  playedIqamah: /* @__PURE__ */ new Set(),
  pendingAudio: null,
  weatherTimer: null
};
const screenName = new URLSearchParams(location.search).get("screen") || "";
const debugMode = new URLSearchParams(location.search).get("debug") === "1";
const tz = () => state.settings?.prayer?.timezone || "Asia/Kuala_Lumpur";
const lang = () => state.settings?.display?.language || "ms";
const t = (key) => I18N[lang()][key] ?? key;
const isAndroid = typeof window !== "undefined" && typeof window.AndroidBridge !== "undefined";
let bridgeMuted = false;
let sessionInvalidNotified = false;
const isFriday = () => {
  const tm = testMode();
  const dk = tm.enabled && tm.date ? tm.date : state.today?.today;
  if (!dk) return false;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz(), weekday: "short" }).format(zonedMs(dk, "12:00", tz())) === "Fri";
  } catch {
    return (/* @__PURE__ */ new Date(`${dk}T00:00:00`)).getDay() === 5;
  }
};
const prayerLabel = (key) => key === "dhuhr" && isFriday() ? t("fridayName") : t("names")[key] || key;
const fridayJemaahEndMs = () => {
  const until = state.settings?.display?.fridayKhutbahUntil || "13:55";
  if (!/^\d{2}:\d{2}$/.test(until)) return null;
  const tm = testMode();
  const dk = tm.enabled && tm.date ? tm.date : state.today?.today;
  return dk ? zonedMs(dk, until, tz()) : null;
};
function notifySessionInvalid() {
  if (sessionInvalidNotified) return;
  sessionInvalidNotified = true;
  if (isAndroid) {
    try {
      AndroidBridgeRef().onSessionExpired();
    } catch {
    }
  }
}
async function api(url) {
  const params = new URLSearchParams(location.search);
  const key = params.get("key");
  const token = params.get("token");
  const headers = {};
  if (key) {
    headers["x-tenant-key"] = key;
    headers["x-display-key"] = key;
  }
  if (token) headers["x-device-token"] = token;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}
function hexToRgba(hex, alpha) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(255, 255, 255, ${alpha})`;
  const r = n >> 16 & 255;
  const g = n >> 8 & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function lightenHex(hex, amt) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return hex || "#e0bc6a";
  const mix = (v) => Math.round(v + (255 - v) * amt);
  const r = mix(n >> 16 & 255);
  const g = mix(n >> 8 & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
function applyColors() {
  const c = state.settings.display.colors || {};
  const root = document.documentElement.style;
  const bgTop = c.bgTop || "#06101f";
  const bgBottom = c.bgBottom || "#0a1a2f";
  const text = c.text || "#f3f6fb";
  const muted = c.muted || "#8fa4bd";
  const gold = c.gold || "#e0bc6a";
  const teal = c.teal || "#62d9c6";
  root.setProperty("--bg-0", bgTop);
  root.setProperty("--bg-1", bgBottom);
  root.setProperty("--text", text);
  root.setProperty("--muted", muted);
  root.setProperty("--gold", gold);
  root.setProperty("--gold-bright", lightenHex(gold, 0.32));
  root.setProperty("--teal", teal);
  root.setProperty("--gold-dim", hexToRgba(gold, 0.14));
  root.setProperty("--teal-dim", hexToRgba(teal, 0.12));
  root.setProperty("--border", hexToRgba(text, 0.1));
  root.setProperty("--panel", hexToRgba(text, 0.055));
  root.setProperty("--panel-strong", hexToRgba(text, 0.1));
  root.setProperty("--glow-1", hexToRgba(gold, 0.2));
  root.setProperty("--glow-2", hexToRgba(teal, 0.18));
  const FONT_HEAD = {
    sans: "inherit",
    serif: "Georgia, 'Times New Roman', 'Playfair Display', serif",
    classic: "Garamond, 'Palatino Linotype', 'Book Antiqua', serif"
  };
  root.setProperty("--font-head", FONT_HEAD[state.settings.display.headingFont] || "inherit");
  const img = state.settings.display.backgroundImage || "";
  root.setProperty("--bg-img", img ? `url("${img}")` : "none");
  root.setProperty("--bg-img-opacity", String((Number(state.settings.display.backgroundOpacity) || 0) / 100));
  const MEDIA_FIT_CSS = { stretch: "fill", fit: "contain", crop: "cover" };
  root.setProperty("--media-fit", MEDIA_FIT_CSS[state.settings.display.mediaFit] || "fill");
}
function renderHeader() {
  $("mosqueName").textContent = state.settings.mosque.name;
  $("mosqueMeta").textContent = [state.settings.mosque.tagline, state.settings.mosque.address].filter(Boolean).join(" \u2022 ");
  const mark = $("brandMark");
  if (state.settings.mosque.logo) {
    mark.src = state.settings.mosque.logo;
    mark.classList.add("logo");
  } else {
    mark.src = "/assets/logo.png";
    mark.classList.remove("logo");
  }
  const label = $("screenLabel");
  if (screenName) {
    label.textContent = screenName;
    label.hidden = false;
  }
  document.documentElement.dataset.theme = state.settings.display.theme;
  document.documentElement.lang = lang();
  const safe = Math.max(0, Math.min(8, Number(state.settings.display.safeMargin) || 0));
  document.documentElement.style.setProperty("--safe", `${safe}vw`);
  $("tickerLabel").textContent = t("info");
  $("soundChip").hidden = !state.settings.audio?.enabled || !(state.settings.audio.adhanUrl || state.settings.audio.iqamahUrl);
}
function tickDebug() {
  if (!debugMode) return;
  const el = $("debugChip");
  if (!el) return;
  const boxes = [];
  for (const id of ["brandMark", "mosqueName", "clock", "dateRow"]) {
    const node = document.getElementById(id);
    if (node) {
      const r = node.getBoundingClientRect();
      boxes.push(`${id}:${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  const st = computePrayerPhase();
  const phaseInfo = st.phase === "normal" ? "normal" : `${st.phase} ${Math.ceil((st.remaining || 0) / 1e3)}s`;
  el.textContent = `${innerWidth}\xD7${innerHeight} dpr${devicePixelRatio} | ${phaseInfo} | ${boxes.join(" | ")}`;
  el.hidden = false;
}
function renderPrayerStrip() {
  const s = state.settings.prayer;
  const rows = [];
  if (s.showImsak && state.today.prayers.imsak) rows.push("imsak");
  rows.push("fajr");
  if (s.showSunrise && state.today.prayers.sunrise) rows.push("sunrise");
  rows.push("dhuhr", "asr", "maghrib", "isha");
  const nextKey = state.today?.next?.key;
  const nextTomorrow = state.today?.next?.tomorrow === true;
  const iqamah = s.iqamah || {};
  $("stripTimes").innerHTML = rows.map((key) => {
    const prayer = state.today.prayers[key];
    if (!prayer) return "";
    const isNext = key === nextKey && !nextTomorrow;
    const isTomorrow = key === nextKey && nextTomorrow && key === "fajr";
    const iq = iqamah[key] ? escapeHtml(fmtPrayerTime(iqamah[key])) : "";
    return `
      <div class="prayer-item${isNext || isTomorrow ? " next" : ""}">
        <span class="p-name">${prayerLabel(key)}</span>
        <span class="p-time">${escapeHtml(fmtPrayerTime(prayer.time))}</span>
        ${isTomorrow ? `<span class="p-iqamah">${t("tomorrow")}</span>` : iq ? `<span class="p-iqamah">${t("iqamah")} ${iq}</span>` : ""}
      </div>`;
  }).join("");
}
function renderSource() {
  let sourceLabel;
  if (state.today.source === "jakim" && state.today.zone) {
    sourceLabel = `JAKIM \u2022 ${state.today.zone.code} \u2014 ${state.today.zone.label}`;
  } else if (state.today.source === "local") {
    sourceLabel = `${t("local")} \u2022 ${state.settings.prayer.method}`;
  } else {
    sourceLabel = `JAKIM (offline) \u2022 ${t("local")}`;
  }
  $("sourceLine").textContent = sourceLabel;
}
function tickClock() {
  const now = new Date(nowMs());
  const hour12 = state.settings?.display?.clockFormat === "12h";
  const withSeconds = state.settings?.display?.showSeconds !== false;
  let text;
  if (hour12) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz(),
      hour: "numeric",
      minute: "2-digit",
      second: withSeconds ? "2-digit" : void 0,
      hour12: true
    });
    const parts = {};
    for (const p of fmt.formatToParts(now)) {
      if (p.type !== "literal") parts[p.type] = p.value;
    }
    const ampm = parts.dayPeriod === "AM" ? lang() === "ms" ? "PG" : "AM" : lang() === "ms" ? "PTG" : "PM";
    text = `${parts.hour.padStart(2, "0")}:${parts.minute}${withSeconds ? `:${parts.second}` : ""} ${ampm}`;
  } else {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz(),
      hour: "2-digit",
      minute: "2-digit",
      second: withSeconds ? "2-digit" : void 0,
      hourCycle: "h23"
    });
    text = fmt.format(now);
  }
  $("clock").textContent = text;
  const blackClock = $("ovBlackClock");
  if (blackClock && !blackClock.hidden) blackClock.textContent = text;
  const loc = lang() === "ms" ? "ms-MY" : "en-MY";
  const dateFmt = new Intl.DateTimeFormat(loc, {
    timeZone: tz(),
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  $("gregorianDate").textContent = dateFmt.format(now);
  const jakimHijri = state.today?.hijri?.text;
  if (jakimHijri) {
    $("hijriDate").textContent = jakimHijri;
  } else {
    try {
      const offset = (Number(state.settings?.hijriOffset) || 0) * 864e5;
      const hijriFmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
        timeZone: tz(),
        day: "numeric",
        month: "long",
        year: "numeric"
      });
      $("hijriDate").textContent = hijriFmt.format(new Date(now.getTime() + offset));
    } catch {
      $("hijriDate").textContent = "\u2014";
    }
  }
}
const ADHAN_CALL_MS = 7e3;
const IQAMAH_LEAD_MS = 3e4;
function getActivePrayerEvent(now) {
  const s = state.settings?.prayer;
  if (!s || !state.today) return null;
  const fullTest = fullTestActive();
  const lead = (fullTest ? (Number(testMode().phaseMs) || 6e4) / 6e4 : Number(s.azanLeadMinutes) || 5) * 6e4;
  const off = fullTest ? Number(testMode().phaseMs) || 6e4 : (Number(s.iqamahOffsetMinutes) || 10) * 6e4;
  const jDur = fullTest ? Number(testMode().phaseMs) || 6e4 : (Number(s.jemaahDurationMinutes) || 15) * 6e4;
  const tm = testMode();
  const simulate = tm.enabled && tm.date && tm.time;
  const anchor = (timeStr, iqStr) => {
    if (!simulate) return { azanMs: 0, iqMs: 0, anchorDate: null };
    const azanMs = zonedMs(tm.date, timeStr, tz());
    const iqMs = fullTest ? azanMs + off : iqStr ? zonedMs(tm.date, iqStr, tz()) : azanMs + off;
    return { azanMs, iqMs, anchorDate: tm.date };
  };
  const list = [];
  for (const key of ["fajr", "dhuhr", "asr", "maghrib", "isha"]) {
    const a = state.today.prayers[key];
    if (!a) continue;
    if (simulate) {
      const { azanMs, iqMs } = anchor(a.time, state.today.iqamah?.[key]?.time);
      list.push({ key, azan: azanMs, iqamah: iqMs, tomorrow: false });
    } else {
      const iq = state.today.iqamah?.[key]?.ms || a.ms + off;
      list.push({ key, azan: a.ms, iqamah: iq, tomorrow: false });
    }
  }
  const nxt = state.today.next;
  if (nxt?.tomorrow && nxt.key === "fajr" && !simulate) {
    list.push({ key: "fajr", azan: nxt.time.ms, iqamah: nxt.time.ms + off, tomorrow: true });
  } else if (simulate && state.today.prayers.fajr) {
    const tomorrow = zonedMs(addDaysKey(tm.date, 1), state.today.prayers.fajr.time, tz());
    list.push({ key: "fajr", azan: tomorrow, iqamah: tomorrow + off, tomorrow: true });
  }
  for (const e of list) {
    const fEnd = e.key === "dhuhr" && isFriday() ? fridayJemaahEndMs() : null;
    const end = fEnd ? Math.max(fEnd, e.iqamah + jDur) : e.iqamah + jDur;
    if (now >= e.azan - lead && now < end) return { ...e, lead, off, jDur, end };
  }
  return null;
}
function addDaysKey(dateKey, days) {
  const d = /* @__PURE__ */ new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function computePrayerPhase(now = nowMs()) {
  const ev = getActivePrayerEvent(now);
  if (!ev) return { phase: "normal" };
  if (now < ev.azan) return { phase: "azan-countdown", ev, remaining: ev.azan - now };
  if (now < ev.azan + ADHAN_CALL_MS) return { phase: "azan-call", ev, remaining: ev.azan + ADHAN_CALL_MS - now };
  if (now < ev.iqamah) return { phase: "iqamah-countdown", ev, remaining: ev.iqamah - now };
  return { phase: "jemaah", ev, remaining: (ev.end || ev.iqamah + ev.jDur) - now };
}
function tickPrayerMode() {
  const st = computePrayerPhase();
  if (isAndroid) {
    const muted = st.phase !== "normal";
    if (muted !== bridgeMuted) {
      bridgeMuted = muted;
      try {
        AndroidBridgeRef().setStreamMuted(muted);
      } catch {
      }
    }
  }
  const ov = $("prayerOverlay");
  if (!ov) return;
  if (st.phase === "normal") {
    if (!ov.hidden) ov.hidden = true;
    return;
  }
  ov.hidden = false;
  const blackClock = $("ovBlackClock");
  const blackMode = st.phase === "jemaah" && state.settings?.prayer?.afterIqamah === "black";
  ov.classList.toggle("black-mode", blackMode);
  if (blackClock) blackClock.hidden = !blackMode;
  if (blackMode) return;
  const { ev } = st;
  const name = prayerLabel(ev.key);
  const time = ev.tomorrow ? state.today?.next?.time?.time : state.today.prayers[ev.key]?.time;
  const kicker = $("ovKicker");
  const arabic = $("ovArabic");
  const ovName = $("ovName");
  const sub = $("ovSub");
  const count = $("ovCountdown");
  arabic.classList.remove("big");
  switch (st.phase) {
    case "azan-countdown":
      kicker.textContent = "AZAN";
      arabic.textContent = "\u0627\u0644\u0623\u064E\u0630\u064E\u0627\u0646";
      ovName.textContent = `${name}${time ? ` \u2014 ${fmtPrayerTime(time)}` : ""}`;
      sub.textContent = "";
      count.textContent = formatDuration(st.remaining);
      break;
    case "azan-call":
      kicker.textContent = "WAKTU SOLAT";
      arabic.textContent = "\u0627\u0644\u0644\u0647\u064F \u0623\u064E\u0643\u0652\u0628\u064E\u0631";
      arabic.classList.add("big");
      ovName.textContent = `${name}${time ? ` \u2022 ${fmtPrayerTime(time)}` : ""}`;
      sub.textContent = "";
      count.textContent = "";
      break;
    case "iqamah-countdown":
      kicker.textContent = "IQAMAH";
      arabic.textContent = "\u0625\u0650\u0642\u064E\u0627\u0645\u064E\u0629";
      arabic.classList.add("big");
      ovName.textContent = name;
      sub.textContent = time ? `${t("names")[ev.key]} \u2014 ${fmtPrayerTime(time)}` : "";
      count.textContent = formatDuration(st.remaining);
      break;
    case "jemaah":
      kicker.textContent = "";
      arabic.textContent = "\u0635\u064E\u0644\u064E\u0627\u0629\u064F \u0627\u0644\u0652\u062C\u064E\u0645\u064E\u0627\u0639\u064E\u0629";
      ovName.textContent = ev.key === "dhuhr" && isFriday() ? t("fridayJemaah") : t("jemaah");
      sub.textContent = time ? `${name} \u2014 ${fmtPrayerTime(time)}` : name;
      count.textContent = "";
      break;
  }
}
function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1e3));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function timeTo12h(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!h && h !== 0) return hhmm;
  const meridiem = lang() === "ms" ? h < 12 ? "PG" : "PTG" : h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${meridiem}`;
}
function fmtPrayerTime(hhmm) {
  return state.settings?.display?.clockFormat === "12h" ? timeTo12h(hhmm) : hhmm;
}
function testMode() {
  return state.settings?.display?.testMode || {};
}
const fullTestActive = () => {
  const tm = testMode();
  return !!(tm.enabled && tm.runFullTest && tm.date && tm.time && tm.savedAtMs);
};
function tzOffsetMinutes(epochMs, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (wall - epochMs) / 6e4;
}
function zonedMs(dateKey, hhmm, timeZone) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, mi] = String(hhmm).split(":").map(Number);
  const i0 = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffsetMinutes(i0, timeZone);
  return i0 - off * 6e4;
}
function nowMs() {
  const tm = testMode();
  if (tm.enabled && tm.date && tm.time) {
    const anchor = zonedMs(tm.date, tm.time, tz());
    if (fullTestActive()) {
      const delay = (Number(tm.startDelaySec) || 0) * 1e3;
      const elapsed = Math.max(0, Date.now() - tm.savedAtMs - delay);
      return anchor + elapsed;
    }
    return anchor;
  }
  return Date.now();
}
function audioFor(url) {
  if (!url) return null;
  let a = state.audioCache.get(url);
  if (!a) {
    a = new Audio(url);
    a.preload = "auto";
    state.audioCache.set(url, a);
  }
  return a;
}
function preloadAudio(url) {
  if (!url) return;
  const a = audioFor(url);
  if (a.readyState >= 2 || !a.paused && !a.ended) return;
  try {
    a.load();
  } catch {
  }
}
function playOnce(key, url, targetMs) {
  if (!url) return;
  if (state.playedAdhan.has(key) || state.playedIqamah.has(key)) return;
  const now = nowMs();
  const diff = targetMs - now;
  if (diff > 1500 || diff < -6e5) return;
  const audio = audioFor(url);
  if (!audio) return;
  if (!audio.paused && !audio.ended) return;
  if (fullTestActive()) {
    for (const other of state.audioCache.values()) {
      if (other !== audio && !other.paused && !other.ended) {
        try {
          other.pause();
        } catch {
        }
      }
    }
  }
  audio.currentTime = 0;
  const target = key.startsWith("iq:") ? state.playedIqamah : state.playedAdhan;
  if (audio.dataset.pendingKey !== key) {
    audio.dataset.pendingKey = key;
    audio.addEventListener("playing", function onPlaying() {
      if (this.muted) return;
      this.removeEventListener("playing", onPlaying);
      delete this.dataset.pendingKey;
      target.add(key);
      if (state.pendingAudio?.key === key) state.pendingAudio = null;
    });
  }
  state.pendingAudio = { key, url, targetMs };
  playAudioWithUnlock(audio);
}
function playAudioWithUnlock(audio) {
  audio.play().catch(() => {
    audio.muted = true;
    audio.play().then(() => {
      setTimeout(() => {
        audio.muted = false;
        audio.play().catch(() => {
        });
      }, 50);
    }).catch(() => {
    });
  });
}
function tickAudio() {
  if (testMode().enabled && !fullTestActive()) return;
  const audio = state.settings?.audio;
  if (!audio?.enabled) return;
  const now = nowMs();
  const ev = getActivePrayerEvent(now);
  if (!ev || ev.tomorrow) return;
  const tm = testMode();
  const dateKey = fullTestActive() ? `t${tm.savedAtMs}` : state.today.today;
  if (now >= ev.azan - ev.lead && now < ev.azan) preloadAudio(audio.adhanUrl);
  if (now < ev.iqamah) preloadAudio(audio.iqamahUrl);
  playOnce(`adhan:${ev.key}:${dateKey}`, audio.adhanUrl, ev.azan);
  const iqLead = fullTestActive() ? Math.min(IQAMAH_LEAD_MS, (Number(tm.phaseMs) || 6e4) / 3) : IQAMAH_LEAD_MS;
  playOnce(`iq:${ev.key}:${dateKey}`, audio.iqamahUrl, ev.iqamah - iqLead);
}
function unlockAudio() {
  const silent = new Audio();
  silent.volume = 0;
  silent.play().catch(() => {
  });
  const pending = state.pendingAudio;
  if (pending) {
    state.pendingAudio = null;
    playOnce(pending.key, pending.url, nowMs());
  }
}
document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("keydown", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });
function retryPendingAudio() {
  const pending = state.pendingAudio;
  if (!pending) return;
  if (state.playedAdhan.has(pending.key) || state.playedIqamah.has(pending.key)) return;
  playOnce(pending.key, pending.url, nowMs());
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) retryPendingAudio();
});
window.addEventListener("focus", retryPendingAudio);
function renderSlides(data) {
  const banner = state.settings?.display?.staticBanner;
  if (banner && banner.enabled) {
    renderStaticBanner();
    return;
  }
  document.body.classList.remove("banner-mode");
  const streamSlides = (state.settings?.streams || []).filter((s) => s.enabled).map((s) => ({ kind: "stream", stream: s }));
  const annSlides = (data.announcements || []).map((a) => ({
    kind: a.category === "quran" ? "quran" : a.video ? "video" : a.category === "tabung" ? "tabung" : "announcement",
    category: a.category,
    title: a.title,
    message: a.message,
    arabic: a.arabic || null,
    ref: a.ref || null,
    translation: lang() === "ms" ? a.translationMs || "" : a.translationEn || "",
    image: a.image,
    video: a.video
  }));
  const builtin = streamSlides.length || annSlides.length ? [] : data.builtin.map((b) => ({
    kind: b.type,
    category: b.type,
    title: lang() === "ms" ? b.text_ms : b.text_en,
    arabic: b.arabic || null,
    ref: b.ref
  }));
  state.slides = [...annSlides, ...streamSlides, ...builtin];
  state.slideIndex = 0;
  buildSlideDots();
  if (!state.slides.length) {
    clearTimeout(state.slideTimer);
    state.slideTimer = null;
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    if (isAndroid) {
      try {
        AndroidBridgeRef().stopStream("");
      } catch {
      }
    }
    $("slide").innerHTML = `<p class="slide-msg">${t("welcome")}</p>`;
    $("slide").classList.add("visible");
    $("slideDots").innerHTML = "";
    return;
  }
  showSlide(0, true);
}
function renderStaticBanner() {
  clearTimeout(state.slideTimer);
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  if (isAndroid) {
    try {
      AndroidBridgeRef().stopStream("");
    } catch {
    }
  }
  const sb = state.settings.display.staticBanner || {};
  const el = $("slide");
  el.innerHTML = `
    <div class="static-banner${sb.image ? " has-img" : ""}">
      ${sb.image ? `<div class="banner-bg" style="background-image:url('${escapeHtml(sb.image)}')"></div>` : ""}
      <div class="banner-content">
        ${sb.title ? `<div class="banner-title">${escapeHtml(sb.title)}</div>` : ""}
        ${sb.message ? `<div class="banner-msg">${escapeHtml(sb.message)}</div>` : ""}
      </div>
    </div>`;
  el.classList.add("visible");
  $("slideDots").innerHTML = "";
  document.body.classList.add("banner-mode");
}
function buildSlideDots() {
  $("slideDots").innerHTML = state.slides.map((_, i) => `<span class="dot${i === 0 ? " on" : ""}" data-i="${i}"></span>`).join("");
}
function slideDuration(slide) {
  const base = (Number(state.settings.display.slideshowInterval) || 12) * 1e3;
  if (slide.kind === "stream") return (Number(slide.stream.duration) || 30) * 1e3;
  return base;
}
function scheduleNextSlide(slide) {
  clearTimeout(state.slideTimer);
  if (slide.kind === "video") return;
  state.slideTimer = setTimeout(() => {
    const nextIndex = (state.slideIndex + 1) % state.slides.length;
    showSlide(nextIndex, false);
  }, slideDuration(slide));
}
function showSlide(index, _instant) {
  const slide = state.slides[index];
  if (!slide) return;
  if (isAndroid) {
    try {
      AndroidBridgeRef().stopStream("");
    } catch {
    }
  }
  state.slideIndex = index;
  const el = $("slide");
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  el.innerHTML = slideHtml(slide);
  el.classList.remove("visible", "stream-wrap", "tabung-card", "media-slide");
  if (slide.kind === "stream") el.classList.add("stream-wrap");
  if (slide.kind === "tabung") el.classList.add("tabung-card");
  if (slide.kind === "quran") el.classList.add("quran-slide");
  if (slide.kind === "video" || slide.kind === "announcement" && slide.image || slide.kind === "tabung" && slide.image) {
    el.classList.add("media-slide");
  }
  void el.offsetWidth;
  el.classList.add("visible");
  document.querySelectorAll("#slideDots .dot").forEach((dot, i) => {
    dot.classList.toggle("on", i === index);
  });
  initSlideMedia(slide);
  scheduleNextSlide(slide);
  syncNativeStream(slide);
}
function slideHtml(slide) {
  if (slide.kind === "stream") return streamHtml(slide.stream);
  if (slide.kind === "video") {
    return mediaHtml(slide.video, "video", slide);
  }
  if (slide.kind === "tabung") {
    if (slide.image) return mediaHtml(slide.image, "image", slide);
    return `
      ${slide.title ? `<div class="slide-title">${escapeHtml(slide.title)}</div>` : ""}
      ${slide.message ? `<p class="slide-msg">${escapeHtml(slide.message)}</p>` : ""}`;
  }
  if (slide.kind === "quran") {
    return `
      ${slide.title ? `<div class="slide-title">${escapeHtml(slide.title)}</div>` : ""}
      ${slide.arabic ? `<div class="slide-arabic">${escapeHtml(slide.arabic)}</div>` : ""}
      ${slide.translation ? `<p class="slide-msg">${escapeHtml(slide.translation)}</p>` : ""}
      ${slide.ref ? `<div class="slide-ref">${escapeHtml(slide.ref)}</div>` : ""}`;
  }
  if (slide.kind === "announcement") {
    if (slide.image) return mediaHtml(slide.image, "image", slide);
    return `
      ${slide.title ? `<div class="slide-title">${escapeHtml(slide.title)}</div>` : ""}
      ${slide.message ? `<p class="slide-msg">${escapeHtml(slide.message)}</p>` : ""}`;
  }
  return `
    ${slide.arabic ? `<div class="slide-arabic">${escapeHtml(slide.arabic)}</div>` : ""}
    ${slide.title ? `<div class="slide-title">${escapeHtml(slide.title)}</div>` : ""}
    ${slide.ref ? `<div class="slide-ref">${escapeHtml(slide.ref)}</div>` : ""}`;
}
function mediaHtml(src, kind, slide) {
  return `
    <div class="media-fill">
      ${kind === "video" ? `<video class="slide-video" src="${escapeHtml(src)}" autoplay muted playsinline></video>` : `<img class="slide-img" src="${escapeHtml(src)}" alt="">`}
      <div class="media-overlay">
        ${slide.message ? `<p class="slide-msg">${escapeHtml(slide.message)}</p>` : ""}
      </div>
    </div>`;
}
function streamHtml(stream) {
  if (stream.kind === "youtube" && stream.youtubeId) {
    const embedOrigin = encodeURIComponent(location.origin || "https://masjidtv.vercel.app");
    const ytId = escapeHtml(String(stream.youtubeId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 11));
    return `
      <span class="stream-badge"><span class="dot"></span>${escapeHtml(t("live"))} \u2022 ${escapeHtml(stream.name)}</span>
      <iframe src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&modestbranding=1&origin=${embedOrigin}"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }
  if (stream.kind === "embed") {
    return `
      <span class="stream-badge"><span class="dot"></span>${escapeHtml(t("live"))} \u2022 ${escapeHtml(stream.name)}</span>
      <iframe src="${escapeHtml(stream.url)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }
  if (isAndroid && ["rtsp", "rtmp", "onvif", "relay"].includes(stream.kind)) {
    return `
      <span class="stream-badge"><span class="dot"></span>${escapeHtml(t("live"))} \u2022 ${escapeHtml(stream.name)}</span>
      <div class="native-stream-slot" data-stream="${escapeHtml(stream.id || "")}"></div>`;
  }
  return `
    <span class="stream-badge"><span class="dot"></span>${escapeHtml(t("live"))} \u2022 ${escapeHtml(stream.name)}</span>
    <video id="slideVideo" autoplay muted playsinline></video>`;
}
function initSlideMedia(slide) {
  if (slide.kind === "video") {
    initSlideVideo();
    return;
  }
  if (slide.kind !== "stream") return;
  const video = document.getElementById("slideVideo");
  if (!video) return;
  const url = slide.stream.kind === "relay" ? slide.stream.hlsUrl : slide.stream.url;
  if (!url) {
    video.outerHTML = `<p class="slide-error">${escapeHtml(t("streamOffline"))}</p>`;
    return;
  }
  if (typeof Hls !== "undefined" && Hls.isSupported()) {
    const hls = new Hls({ liveSyncDurationCount: 3 });
    state.hls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (evt, data) => {
      if (data.fatal) {
        video.outerHTML = `<p class="slide-error">${escapeHtml(t("streamOffline"))}</p>`;
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
  } else {
    video.outerHTML = `<p class="slide-error">${escapeHtml(t("streamOffline"))}</p>`;
  }
}
function syncNativeStream(slide) {
  if (!isAndroid) return;
  if (!slide || slide.kind !== "stream" || !["rtsp", "rtmp", "onvif", "relay"].includes(slide.stream.kind)) {
    try {
      AndroidBridgeRef().stopStream("");
    } catch {
    }
    return;
  }
  const slot = document.querySelector("#slide .native-stream-slot");
  if (!slot) return;
  const r = slot.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  try {
    AndroidBridgeRef().setStreamSlot(
      Math.round(r.left * dpr),
      Math.round(r.top * dpr),
      Math.round(r.width * dpr),
      Math.round(r.height * dpr)
    );
    AndroidBridgeRef().playStream(slide.stream.url || "", slide.stream.name || "", slide.stream.id || "");
  } catch {
  }
}
if (isAndroid) {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => syncNativeStream(state.slides[state.slideIndex]), 200);
  });
}
function initSlideVideo() {
  const video = document.querySelector("#slide .slide-video");
  if (!video) return;
  const advance = () => {
    clearTimeout(state.slideTimer);
    const nextIndex = (state.slideIndex + 1) % state.slides.length;
    showSlide(nextIndex, false);
  };
  video.addEventListener("ended", advance, { once: true });
  video.addEventListener("error", () => {
    clearTimeout(state.slideTimer);
    state.slideTimer = setTimeout(advance, 2500);
  }, { once: true });
  video.play().catch(() => {
    state.slideTimer = setTimeout(advance, (Number(state.settings.display.slideshowInterval) || 12) * 1e3);
  });
}
$("slideDots").addEventListener("click", (e) => {
  const dot = e.target.closest(".dot");
  if (dot) showSlide(Number(dot.dataset.i), false);
});
function renderSideCards(data) {
  const now = /* @__PURE__ */ new Date();
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz(), weekday: "long" }).format(now).toLowerCase();
  const duty = (state.settings?.roster || {})[day];
  const dutyPanel = $("dutyPanel");
  if (duty && (duty.imam || duty.bilal)) {
    dutyPanel.hidden = false;
    $("dutyTitle").textContent = t("dutyTitle");
    const parts = [];
    if (duty.imam) parts.push(`<span class="role">${t("imam")}</span><span class="big">${escapeHtml(duty.imam)}</span>`);
    if (duty.bilal) parts.push(`<span class="role">${t("bilal")}</span><span class="big">${escapeHtml(duty.bilal)}</span>`);
    $("dutyBody").innerHTML = parts.join("");
  } else {
    dutyPanel.hidden = true;
  }
  const tabung = (data.announcements || []).find((a) => a.category === "tabung");
  const kutipanPanel = $("kutipanPanel");
  if (tabung) {
    kutipanPanel.hidden = false;
    $("kutipanTitle").textContent = t("kutipanTitle");
    $("kutipanBody").innerHTML = `<span class="big">${escapeHtml(tabung.title)}</span>` + (tabung.message ? `<span class="small">${escapeHtml(tabung.message)}</span>` : "");
  } else {
    kutipanPanel.hidden = true;
  }
  const events = state.settings?.events || [];
  const eventPanel = $("eventPanel");
  if (events.length) {
    eventPanel.hidden = false;
    $("eventTitle").textContent = t("eventTitle");
    const e = events[0];
    const name = lang() === "ms" ? e.name : e.nameEn || e.name;
    const label = e.today ? `${t("today")}!` : t("daysLeft").replace("{n}", String(e.daysLeft));
    let html = `<span class="big">${escapeHtml(name)}</span><span class="med days">${label}</span>`;
    if (events[1]) {
      const e2 = events[1];
      const name2 = lang() === "ms" ? e2.name : e2.nameEn || e2.name;
      html += `<span class="small">${escapeHtml(name2)} \u2014 ${e2.daysLeft}d</span>`;
    }
    $("eventBody").innerHTML = html;
  } else {
    eventPanel.hidden = true;
  }
}
let lastTickerKey = "";
function renderTicker(data) {
  const enabled = state.settings.display.showTicker;
  $("tickerBar").hidden = !enabled;
  if (!enabled) return;
  const custom = String(state.settings.display.tickerCustom || "").trim();
  let items;
  if (custom) {
    items = custom.split(/\r?\n/).filter((l) => l.trim()).map(
      (l) => `<span class="ticker-item">${escapeHtml(l.trim())}</span>`
    );
  } else {
    items = data.announcements.map(
      (a) => `<span class="ticker-item"><span class="tick-title">${escapeHtml(a.title)}</span>${a.message ? "\u2014 " + escapeHtml(a.message) : ""}</span>`
    );
  }
  if (!items.length) {
    items.push(`<span class="ticker-item">${escapeHtml(t("welcome"))}</span>`);
  }
  const content = items.join("");
  const speed = state.settings.display.tickerSpeed || "normal";
  const key = `${enabled}|${speed}|${content}`;
  if (key === lastTickerKey) return;
  lastTickerKey = key;
  const track = $("tickerTrack");
  track.style.animation = "none";
  track.innerHTML = content;
  void track.offsetWidth;
  const baseW = Math.max(1, track.scrollWidth);
  const needed = Math.max(2, Math.ceil(2 * window.innerWidth / baseW));
  const copies = needed % 2 === 0 ? needed : needed + 1;
  track.innerHTML = content.repeat(copies);
  void track.offsetWidth;
  const pxPerSec = { slow: 35, normal: 60, fast: 110 }[speed] || 60;
  const duration = Math.max(15, track.scrollWidth / pxPerSec);
  track.style.animation = `ticker-scroll ${duration}s linear infinite`;
}
async function loadWeather() {
  const chip = $("weatherChip");
  if (!chip) return;
  chip.hidden = true;
  const loc = state.settings?.location;
  if (!state.settings?.weather?.enabled || !state.settings?.display?.showWeather || !loc) return;
  const { latitude, longitude } = loc;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&forecast_days=1`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8e3);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error("weather");
    const data = await res.json();
    const code = data.current?.weather_code;
    const temp = Math.round(data.current?.temperature_2m);
    const unit = state.settings?.weather?.unit === "f" ? "\xB0F" : "\xB0C";
    chip.innerHTML = `${WEATHER_ICONS[code] || "\u{1F321}\uFE0F"} ${temp}${unit} <span class="weather-desc">${I18N[lang()].weather[code] || ""}</span>`;
    chip.hidden = false;
  } catch {
    chip.hidden = true;
  }
}
const SYNC_INTERVAL_MS = 1e4;
let dataCache = { settings: "", today: "", slides: "" };
const stableToday = (today) => {
  if (!today || typeof today !== "object") return today;
  const copy = { ...today };
  delete copy.now;
  return copy;
};
function renderEverything() {
  applyColors();
  renderHeader();
  renderPrayerStrip();
  renderSource();
  renderSlides(state.slidesData || []);
  renderSideCards(state.slidesData || []);
  renderTicker(state.slidesData || []);
  tickClock();
  tickPrayerMode();
}
async function refresh() {
  try {
    const [settings, today, slides] = await Promise.all([
      api("/api/settings"),
      api("/api/today"),
      api("/api/slides")
    ]);
    state.settings = settings;
    state.today = today;
    state.slidesData = slides;
    dataCache = {
      settings: JSON.stringify(settings),
      today: JSON.stringify(stableToday(today)),
      slides: JSON.stringify(slides)
    };
    renderEverything();
    loadWeather().catch(() => {
    });
  } catch (err) {
    console.error("[display] refresh failed:", err);
    const el = $("slide");
    if (String(err.message).includes("401")) {
      el.innerHTML = '<p class="slide-msg">Sesi TV tidak sah \u2014 sila pautkan semula di admin.</p>';
      notifySessionInvalid();
    } else {
      el.innerHTML = '<p class="slide-msg">Menghubungi pelayan\u2026 / Connecting to server\u2026</p>';
    }
    el.classList.add("visible");
  }
}
async function sync() {
  try {
    const [settings, today, slides] = await Promise.all([
      api("/api/settings"),
      api("/api/today"),
      api("/api/slides")
    ]);
    const settingsChanged = JSON.stringify(settings) !== dataCache.settings;
    const todayChanged = JSON.stringify(stableToday(today)) !== dataCache.today;
    const slidesChanged = JSON.stringify(slides) !== dataCache.slides;
    if (!settingsChanged && !todayChanged && !slidesChanged) return;
    state.settings = settings;
    state.today = today;
    state.slidesData = slides;
    dataCache = {
      settings: JSON.stringify(settings),
      today: JSON.stringify(stableToday(today)),
      slides: JSON.stringify(slides)
    };
    if (settingsChanged) {
      applyColors();
      renderHeader();
      renderPrayerStrip();
      renderSource();
      renderSlides(slides);
    } else if (todayChanged) {
      renderPrayerStrip();
      renderSource();
    }
    if (slidesChanged) {
      renderSlides(slides);
    }
    renderSideCards(slides);
    renderTicker(slides);
    tickClock();
    tickPrayerMode();
  } catch (err) {
    console.error("[display] sync failed:", err);
    if (String(err.message).includes("401")) notifySessionInvalid();
  }
}
window.addEventListener("error", (e) => {
  console.error("[display] uncaught:", e.message);
});
function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
setInterval(tickClock, 1e3);
setInterval(tickAudio, 1e3);
setInterval(tickPrayerMode, 1e3);
setInterval(tickDebug, 2e3);
setInterval(sync, SYNC_INTERVAL_MS);
setInterval(loadWeather, 9e5);
const style = document.createElement("style");
style.textContent = `
  @keyframes ticker-scroll {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }
`;
document.head.appendChild(style);
refresh();
