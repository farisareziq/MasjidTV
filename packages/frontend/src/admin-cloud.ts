'use strict';

// Module scope (bukan skrip global) — setiap halaman memuatkan satu fail sahaja.

// ------------------------------------------------------------- jenis domain
// Nota: jenis diimport daripada teras domain @masjidtv/shared (jenis sahaja,
// dipadam semasa kompil — kelakuan runtime kekal serupa dengan baseline JS).
import type { Settings, Announcement, TodayPayload, EventsSyncSettings, PrayerTimePayload } from '@masjidtv/shared';

type AdminStatus = {
  version: string; uptime: number; screenUrl: string; adminUrl: string;
  counts: { announcements: number; activeAnnouncements: number };
  mosque: string; language: string; prayerMethod: string; prayerSource: string; prayerZone: string;
  eventsSync: EventsSyncSettings; audioEnabled: boolean; streamCount: number; activeStreamCount: number;
  nextEvent: { name: string; next: string; daysLeft: number; today: boolean } | null;
  adminPasswordFile: boolean;
};
type StreamRow = { id: string; name: string; type: string; url: string; duration: number; enabled: boolean; status?: string };
type UploadResult = { url: string; kind: string };
type LicenseInfo = { status: string; trialUntil?: number; apiKey?: string };
type TenantInfo = { id: string; name: string; status: string; apiKey: string; license?: { status: string; trialUntil?: number } };
type TvDevice = { id: string; device_id: string; name?: string; last_seen?: number | string };

interface AdminState {
  token: string;
  role: string;
  editingId: string | null;
  announcements: Array<Announcement & { status?: string }>;
  methods: Record<string, { label: string }>;
  status: AdminStatus | null;
  today: TodayPayload | null;
  streamsStatus: StreamRow[];
  zones: Record<string, Array<{ zone: string; label: string }>>;
  ffmpegOk: boolean | null;
  toastTimer: ReturnType<typeof setTimeout> | null;
  settings?: Settings;
  license?: LicenseInfo;
  superTenants?: TenantInfo[];
}

// AndroidBridge & TVM_IDLE_MS dinyatakan dalam globals.d.ts (dikongsi).

// Elemen DOM longgar (padan gaya baseline JS): HTMLElement + medan borang lazim.
type Elem = HTMLElement & Record<string, any>;
const $ = (id: string): Elem => document.getElementById(id) as Elem;

const state: AdminState = {
  token: localStorage.getItem('tvm_token') || '',
  role: localStorage.getItem('tvm_role') || '',
  editingId: null,
  announcements: [],
  methods: {},
  status: null,
  today: null,
  streamsStatus: [],
  zones: {},
  ffmpegOk: null,
  toastTimer: null
};

const WEEKDAYS: Array<[string, string]> = [
  ['sunday', 'Sunday'], ['monday', 'Monday'], ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'], ['thursday', 'Thursday'], ['friday', 'Friday'],
  ['saturday', 'Saturday']
];

const STREAM_TYPES: string[] = ['rtsp', 'rtmp', 'onvif', 'hls', 'youtube', 'webrtc'];

const COLOR_PRESETS: Record<string, { bgTop: string; bgBottom: string; text: string; muted: string; gold: string; teal: string; font?: string }> = {
  navy: { bgTop: '#06101f', bgBottom: '#0a1a2f', text: '#f3f6fb', muted: '#8fa4bd', gold: '#e0bc6a', teal: '#62d9c6' },
  emerald: { bgTop: '#03130f', bgBottom: '#08271c', text: '#f0faf5', muted: '#8fb5a4', gold: '#e6c976', teal: '#5ee6b0' },
  royal: { bgTop: '#0a0f2e', bgBottom: '#151d52', text: '#f2f3ff', muted: '#9aa3d8', gold: '#d9b45c', teal: '#6fb7ff' },
  maroon: { bgTop: '#220711', bgBottom: '#421127', text: '#fdf1f4', muted: '#c99aa8', gold: '#e8c37a', teal: '#ff9d76' },
  cream: { bgTop: '#000000', bgBottom: '#161310', text: '#f2e2bd', muted: '#b3a67f', gold: '#e8d29a', teal: '#cbb783', font: 'serif' },
  light: { bgTop: '#eef2f7', bgBottom: '#ffffff', text: '#12233d', muted: '#5d7189', gold: '#a97c1f', teal: '#0d8f7c' }
};

const ADMIN_LANG_KEY = 'tvm_admin_lang';
let adminLang: string = localStorage.getItem(ADMIN_LANG_KEY) || 'en';

const I18N: Record<string, Record<string, string>> = {
  en: {
    loginSub: 'Manage the mosque signage system',
    loginPassword: 'Admin password',
    signIn: 'Sign in',
    overview: 'Overview',
    announcements: 'Announcements',
    tv: 'TV & Screens',
    tvSub: 'Pair Android TV devices using the code shown on the TV screen.',
    tvPairTitle: 'Pair new TV',
    tvPairCode: 'Code shown on TV',
    tvPairBtn: 'Pair TV',
    tvDevices: 'Paired devices',
    tvUnpair: 'Unpair',
  tvRename: 'Rename',
  tvRenamePrompt: 'Device name (e.g. Mi TV Prayer Hall):',
  tvRenameEmpty: 'Name cannot be empty',
    tvEmpty: 'No devices paired yet.',
    settings: 'Settings',
    signOut: 'Sign out',
    overviewSub: 'Live status of the signage system.',
    server: 'Server',
    nextPrayer: 'Next prayer',
    prayerFajr: 'Fajr',
    prayerDhuhr: 'Dhuhr',
    prayerAsr: 'Asr',
    prayerMaghrib: 'Maghrib',
    prayerIsha: 'Isha',
    prayerJumaah: 'Jumu\'ah (khutbah)',
    announcementsTitle: 'Announcements',
    nextIslamicEvent: 'Next Islamic event',
    signageScreen: 'Signage screen',
    openDisplay: 'Open display',
    copyUrl: 'Copy URL',
    notes: 'Notes',
    note1: 'Point any screen on the network to {url} and open it fullscreen (Edge kiosk handles this automatically on the mini PC).',
    notePassword: '⚠️ The default admin password file still exists at {file}. Change the password in Settings and the file is removed.',
    noteJakim: 'Prayer times and hijri date come from the official JAKIM e-Solat API (selected zone), with automatic offline calculation fallback.',
    noteAudio: '🔊 Adhan/Iqamah audio is configured — the screen will call at prayer times.',
    noteStreams: '📡 {count} live stream(s) configured. RTSP/RTMP/ONVIF need ffmpeg on the mini PC.',
    noteEvents: '📅 Islamic events auto-synced from JAKIM takwim.',
    runningFor: 'Running for {time} • v{version}',
    activeNow: '{n} active now',
    eventDays: '{n} days • {date}',
    eventToday: 'Hari ini! / Today!',
    announcementsSub: 'Shown in the slideshow and ticker on every screen.',
    newAnnouncement: '+ New announcement',
    refresh: 'Refresh',
    editAnnouncement: 'Edit announcement',
    title: 'Title',
    category: 'Category',
    message: 'Message',
    startDate: 'Start date (optional)',
    endDate: 'End date (optional)',
    priority: 'Priority (0–10)',
    active: 'Active',
    mediaOptional: 'Media — image or video (optional)',
    removeImage: 'Remove image',
    removeVideo: 'Remove video',
    save: 'Save',
    cancel: 'Cancel',
    catAnnouncement: 'Announcement',
    catEvent: 'Event',
    catGeneral: 'General',
    catWelcome: 'Welcome',
    catTabung: 'Tabung / Collection',
    catQuran: 'Quran — daily verse',
    quranDaily: 'Daily Quran verse (auto-rotates every day)',
    quranArabic: 'Arabic text (optional — override daily pick)',
    quranTranslationMs: 'Translation — Malay',
    quranTranslationEn: 'Translation — English',
    quranRef: 'Reference (e.g. Al-Baqarah 2:45)',
    annOrderSaved: 'Display order saved',
    video: 'video',
    emptyAnnouncements: 'No announcements yet. Click “+ New announcement” to add the first one.',
    pause: 'Pause',
    edit: 'Edit',
    delete: 'Delete',
    statusActive: 'active',
    statusInactive: 'inactive',
    from: 'from {d}',
    until: 'until {d}',
    priorityN: 'priority {n}',
    deleteConfirm: 'Delete “{title}”?',
    settingsSub: 'Changes apply to all screens automatically.',
    navProfil: 'Mosque Profile',
    navProfilSub: 'Mosque details, location, weather and account.',
    navPrayer: 'Prayer Times',
    navPrayerSub: 'Prayer schedule, azan/iqamah and audio.',
    navDisplay: 'Display',
    navDisplaySub: 'Screen layout, colours and test mode.',
    navContent: 'Content & Media',
    navContentSub: 'Live streams, Islamic events and duty roster.',
    mosque: 'Mosque',
    location: 'Location',
    prayerTimes: 'Prayer times',
    audioTitle: 'Audio — Azan & Iqamah',
    displayTitle: 'Display',
    liveStreams: 'Live streams (IP camera / ONVIF / RTSP / RTMP / HLS / WebRTC / YouTube)',
    eventsTitle: 'Islamic events (countdown)',
    dutyTitle: 'Imam & Bilal duty',
    weatherTitle: 'Weather',
    hijriTitle: 'Hijri date',
    passwordTitle: 'Change admin password',
    name: 'Name',
    tagline: 'Tagline',
    address: 'Address',
    logoOptional: 'Logo (optional)',
    removeLogo: 'Remove logo',
    saveMosque: 'Save mosque',
    locationSub: 'Used for prayer-time calculation and weather. Latitude/longitude in decimal degrees.',
    latitude: 'Latitude',
    longitude: 'Longitude',
    placeName: 'Place name',
    saveLocation: 'Save location',
    jakimZone: 'JAKIM zone (official prayer times)',
    timeSource: 'Time source',
    sourceLocal: 'Local calculation only',
    fallbackMethod: 'Fallback calculation method',
    timezone: 'Timezone (IANA)',
    showImsak: 'Show Imsak',
    imsakOffset: 'Imsak offset (min before Fajr)',
    showSunrise: 'Show Syuruk/Sunrise',
    azanLead: 'Azan countdown starts (min before adhan)',
    iqamahOffset: 'Iqamah after adhan (minutes)',
    jemaahDur: 'Solat Jemaah screen (minutes)',
    afterIqamah: 'After iqamah display',
    afterIqamahJemaah: 'Solat Jemaah screen',
    afterIqamahBlack: 'Black screen with clock (top-right)',
    adjustments: 'Adjustments (minutes)',
    iqamahFixed: 'Iqamah fixed times (HH:MM, optional — leave empty to use the offset above)',
    fajr: 'Fajr',
    sunrise: 'Sunrise',
    dhuhr: 'Dhuhr',
    asr: 'Asr',
    maghrib: 'Maghrib',
    isha: 'Isha',
    savePrayer: 'Save prayer settings',
    audioSub: 'The screen plays the adhan at the start of each prayer and the iqamah call at the configured iqamah time. Upload your own audio files or paste a URL.',
    audioEnabled: 'Audio enabled',
    adhanAudio: 'Azan audio',
    iqamahAudio: 'Iqamah audio',
    saveAudio: 'Save audio settings',
    languageLabel: 'Language',
    colourPreset: 'Colour preset',
    clockFormat: 'Clock format',
    showSeconds: 'Show seconds',
    slideshowInterval: 'Slideshow interval (seconds)',
    fridayKhutbahUntil: 'Khutbah & Friday Prayer until (HH:mm)',
    tickerSpeed: 'Ticker speed',
    safeMargin: 'Safe margin (% of screen, for TV overscan)',
    mediaFit: 'Media fit mode',
    mediaFitStretch: 'Stretch — full, no bars & no crop',
    mediaFitFit: 'Fit — original ratio, black bars',
    mediaFitCrop: 'Crop — full, edges trimmed',
    showTicker: 'Show ticker',
    tickerCustom: 'Ticker custom text (optional — replaces system announcements, one message per line)',
    showWeather: 'Show weather',
    bannerStatic: 'Static banner',
    bannerHint: 'Full-screen static banner for events. The azan/iqamah countdown still runs as usual on top of it.',
    bannerEnabled: 'Show static banner (full screen)',
    bannerTitle: 'Banner title',
    bannerMessage: 'Banner message',
    bannerImage: 'Banner background image (optional)',
    bannerUploaded: 'Banner image uploaded',
    coloursBg: 'Colours & background',
    bgTop: 'Background (top)',
    bgBottom: 'Background (bottom)',
    textColour: 'Text',
    mutedText: 'Muted text',
    accentGold: 'Accent (gold)',
    accentTeal: 'Accent 2 (teal)',
    bgPhoto: 'Background photo (optional)',
    removePhoto: 'Remove photo',
    photoOpacity: 'Photo opacity',
    saveDisplay: 'Save display settings',
    testModeTitle: 'Test mode — azan & iqamah countdown',
    testModeSub: 'Simulate the clock and date to preview the full-screen azan/iqamah flow. "Run full test" plays the whole flow live — every phase 1 minute — including the adhan & iqamah audio.',
    testEnabled: 'Enable test mode',
    testDate: 'Simulated date',
    testTime: 'Simulated time',
    testPrayer: 'Quick set — prayer',
    testMinus5: 'T − 5 min',
    testAzan: 'Adhan time',
    testIqamah: 'Iqamah time',
    saveTestMode: 'Save test mode',
    testRunFull: '▶ Run full test (1 min/phase, with sound)',
    testFullStarted: 'Full test started — watch the display screen',
    presetCustom: '— Custom —',
    presetNavy: 'Navy & Gold (default)',
    presetEmerald: 'Emerald & Gold',
    presetRoyal: 'Royal Blue & Gold',
    presetMaroon: 'Maroon & Gold',
    presetCream: 'Black & Cream',
    presetLight: 'Light',
    headingFont: 'Heading font',
    fontSans: 'Sans (default)',
    fontSerif: 'Serif — Royal',
    fontClassic: 'Classic — Formal',
    clock24: '24-hour',
    clock12: '12-hour',
    tickerSlow: 'Slow',
    tickerNormal: 'Normal',
    tickerFast: 'Fast',
    streamsSub: 'RTSP, RTMP and ONVIF streams are converted to HLS by ffmpeg on this machine and shown in the slideshow. YouTube accepts a normal or live video URL. WebRTC uses a custom embed URL (e.g. your WebRTC gateway page).',
    ffmpegPath: 'ffmpeg path (for RTSP/RTMP/ONVIF)',
    saveFfmpeg: 'Save ffmpeg path',
    addStream: '+ Add stream',
    saveStreams: 'Save streams',
    emptyStreams: 'No streams yet. Add an IP camera, YouTube video, or live stream URL.',
    streamName: 'Name',
    streamType: 'Type',
    seconds: 'Seconds',
    streamUrl: 'URL',
    enabled: 'Enabled',
    eventsSub: 'Auto-synced from the official JAKIM takwim — dates are updated according to the selected zone.',
    eventsAuto: 'Auto-sync from JAKIM',
    syncNow: 'Sync now',
    addEvent: '+ Add event',
    saveEvents: 'Save events',
    nameBm: 'Name (BM)',
    nameEn: 'Name (EN)',
    date: 'Date',
    repeatYearly: 'Repeat yearly',
    emptyEvents: 'No Islamic events yet.',
    eventNew: 'new',
    eventNotUpcoming: 'not upcoming',
    sourceJakim: 'JAKIM',
    sourceAnggaran: 'estimate',
    rosterSub: "Today's duty is shown on the screen.",
    saveRoster: 'Save roster',
    imam: 'Imam',
    bilal: 'Bilal',
    weatherEnabled: 'Weather enabled',
    unit: 'Unit',
    saveWeather: 'Save weather',
    celsius: 'Celsius',
    fahrenheit: 'Fahrenheit',
    hijriOffset: 'Day offset (−2 to +2)',
    saveHijri: 'Save Hijri offset',
    currentPassword: 'Current password',
    newPassword: 'New password (min 6 chars)',
    confirmPassword: 'Confirm new password',
    changePassword: 'Change password',
    sessionExpired: 'Session expired — please sign in again',
    requestFailed: 'Request failed ({s})',
    wrongPassword: 'Wrong password',
    signInFailed: 'Sign in failed',
    screenUrlCopied: 'Screen URL copied',
    copyFailed: 'Copy failed — select the URL manually',
    annPaused: 'Announcement paused',
    annActivated: 'Announcement activated',
    annDeleted: 'Announcement deleted',
    annUpdated: 'Announcement updated',
    annCreated: 'Announcement created',
    annRefreshed: 'Announcements refreshed',
    notFound: 'Not found',
    mediaUploaded: 'Media uploaded',
    uploadFailed: 'Upload failed',
    logoUploaded: 'Logo uploaded — click “Save mosque” to apply',
    azanUploaded: 'Azan audio uploaded — click “Save audio settings” to apply',
    iqamahUploaded: 'Iqamah audio uploaded — click “Save audio settings” to apply',
    bgUploaded: 'Background photo uploaded — click “Save display settings” to apply',
    settingsSaved: 'Settings saved',
    streamsSaved: 'Streams saved & relay restarted',
    syncInProgress: 'Syncing with JAKIM…',
    syncDone: 'Sync complete: {n} dates',
    syncFailed: 'Sync failed',
    eventsSaved: 'Events saved',
    passwordChanged: 'Password changed',
    fillPasswords: 'Fill in all password fields',
    pwTooShort: 'New password must be at least 6 characters',
    pwMismatch: 'New passwords do not match',
    idleLogout: 'Session ended due to inactivity — please sign in again',
    logoMustImage: 'Logo must be an image',
    bgMustImage: 'Background must be an image',
    checkingFfmpeg: 'Checking ffmpeg…',
    ffmpegOk: '✅ ffmpeg detected — RTSP/RTMP/ONVIF relays available.',
    ffmpegMissing: '⚠️ ffmpeg NOT found. Install ffmpeg and set its path above for RTSP/RTMP/ONVIF streams (HLS, YouTube and WebRTC embeds work without it).',
    statusRunning: 'running',
    statusStarting: 'starting',
    statusReady: 'ready',
    statusNoFfmpeg: 'no ffmpeg',
    statusDisabled: 'disabled',
    statusStopped: 'stopped',
    lastSynced: 'Last: {t}',
    neverSynced: 'not yet',
    todayDuty: 'today',
    daysShort: '{n}d'
    ,
    sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday'
    ,
    loginUsername: 'Username',
    pinChangeSub: 'Set your superuser PIN before continuing',
    newPin: 'New PIN',
    confirmPin: 'Confirm PIN',
    changePin: 'Change PIN',
    changePinOk: 'PIN updated',
    pinMismatch: 'PINs do not match',
    pinTooShort: 'PIN must be at least 8 characters',
    masjid: 'Masjid',
    masjidSub: 'Register mosque accounts and manage licenses.',
    registerMasjid: 'Register mosque',
    mosqueNameLabel: 'Mosque name',
    usernameLabel: 'Admin username',
    passwordLabel: 'Admin password',
    registerBtn: 'Register',
    license: 'License',
    licenseTrial: 'Trial — {d} days left',
    licenseActive: 'Licensed (permanent)',
    licenseLocked: 'License required',
    licenseSuspended: 'Suspended',
    apiKeyLabel: 'Display API key',
    copyKey: 'Copy key',
    copied: 'Copied',
    registerLicense: 'Register license',
    licenseCodeLabel: 'License code',
    tenantId: 'Tenant ID',
    activate: 'Activate',
    suspend: 'Suspend',
    resetKey: 'Reset API key',
    users: 'Users',
    addUser: '+ Add user',
    removeUser: 'Remove',
    createdOn: 'Created {d}',
    tenantStatus: 'Status: {s}',
    trialEnds: 'Trial until {d}',
    adminBadge: 'admin',
    deleteTenantConfirm: 'Delete “{name}”? This permanently removes the mosque account, its admin user, announcements and media.',
    userDeleteConfirm: 'Remove user “{name}”?'
  },
  ms: {
    loginSub: 'Urus sistem paparan masjid',
    loginPassword: 'Kata laluan admin',
    signIn: 'Log Masuk',
    overview: 'Ringkasan',
    announcements: 'Pengumuman',
    tv: 'TV & Paparan',
    tvSub: 'Pautkan peranti Android TV menggunakan kod yang dipaparkan pada skrin TV.',
    tvPairTitle: 'Pair TV baharu',
    tvPairCode: 'Kod pada skrin TV',
    tvPairBtn: 'Pair TV',
    tvDevices: 'Peranti terpaut',
    tvUnpair: 'Nyah-paut',
  tvRename: 'Nama semula',
  tvRenamePrompt: 'Nama peranti (cth. Mi TV Ruang Solat):',
  tvRenameEmpty: 'Nama tidak boleh kosong',
    tvEmpty: 'Tiada peranti terpaut lagi.',
    settings: 'Tetapan',
    signOut: 'Log Keluar',
    overviewSub: 'Status langsung sistem paparan.',
    server: 'Server',
    nextPrayer: 'Solat Seterusnya',
    prayerFajr: 'Subuh',
    prayerDhuhr: 'Zohor',
    prayerAsr: 'Asar',
    prayerMaghrib: 'Maghrib',
    prayerIsha: 'Isyak',
    prayerJumaah: 'Jumaat (khutbah)',
    announcementsTitle: 'Pengumuman',
    nextIslamicEvent: 'Hari Kebesaran Seterusnya',
    signageScreen: 'Skrin Paparan',
    openDisplay: 'Buka paparan',
    copyUrl: 'Salin URL',
    notes: 'Nota',
    note1: 'Arahkan mana-mana skrin pada rangkaian ke {url} dan buka skrin penuh (Edge kiosk mengendalikannya automatik pada mini PC).',
    notePassword: '⚠️ Fail kata laluan lalai masih wujud di {file}. Tukar kata laluan di Tetapan dan fail akan dipadam.',
    noteJakim: 'Waktu solat dan tarikh hijrah datang dari API rasmi JAKIM e-Solat (zon terpilih), dengan fallback pengiraan tempatan automatik.',
    noteAudio: '🔊 Audio azan/iqamah dikonfigurasi — skrin akan berbunyi pada waktu solat.',
    noteStreams: '📡 {count} live stream dikonfigurasi. RTSP/RTMP/ONVIF memerlukan ffmpeg pada mini PC.',
    noteEvents: '📅 Hari kebesaran Islam auto-sync dari takwim JAKIM.',
    runningFor: 'Berjalan {time} • v{version}',
    activeNow: '{n} aktif sekarang',
    eventDays: '{n} hari • {date}',
    eventToday: 'Hari ini!',
    announcementsSub: 'Dipaparkan dalam slaid dan ticker pada setiap skrin.',
    newAnnouncement: '+ Pengumuman baharu',
    refresh: 'Muat Semula',
    editAnnouncement: 'Kemas kini pengumuman',
    title: 'Tajuk',
    category: 'Kategori',
    message: 'Mesej',
    startDate: 'Tarikh mula (pilihan)',
    endDate: 'Tarikh tamat (pilihan)',
    priority: 'Keutamaan (0–10)',
    active: 'Aktif',
    mediaOptional: 'Media — imej atau video (pilihan)',
    removeImage: 'Buang imej',
    removeVideo: 'Buang video',
    save: 'Simpan',
    cancel: 'Batal',
    catAnnouncement: 'Pengumuman',
    catEvent: 'Acara',
    catGeneral: 'Umum',
    catWelcome: 'Selamat Datang',
    catTabung: 'Tabung / Kutipan',
    catQuran: 'Quran — Ayat Harian',
    quranDaily: 'Ayat Quran pilihan harian (auto-tukar setiap hari)',
    quranArabic: 'Teks Arab (pilihan — ganti ayat harian)',
    quranTranslationMs: 'Terjemahan — Melayu',
    quranTranslationEn: 'Terjemahan — Inggeris',
    quranRef: 'Rujukan (cth. Al-Baqarah 2:45)',
    annOrderSaved: 'Susunan paparan disimpan',
    video: 'video',
    emptyAnnouncements: 'Tiada pengumuman lagi. Klik “+ Pengumuman baharu” untuk menambah.',
    pause: 'Jeda',
    edit: 'Sunting',
    delete: 'Padam',
    statusActive: 'aktif',
    statusInactive: 'tidak aktif',
    from: 'dari {d}',
    until: 'hingga {d}',
    priorityN: 'keutamaan {n}',
    deleteConfirm: 'Padam “{title}”?',
    settingsSub: 'Perubahan terpakai pada semua skrin secara automatik.',
    navProfil: 'Profil Masjid',
    navProfilSub: 'Maklumat masjid, lokasi, cuaca dan akaun.',
    navPrayer: 'Waktu Solat',
    navPrayerSub: 'Jadual solat, azan/iqamah dan audio.',
    navDisplay: 'Paparan',
    navDisplaySub: 'Susun atur skrin, warna dan mod ujian.',
    navContent: 'Kandungan & Media',
    navContentSub: 'Siaran langsung, acara Islam dan jadual bertugas.',
    mosque: 'Masjid',
    location: 'Lokasi',
    prayerTimes: 'Waktu solat',
    audioTitle: 'Audio — Azan & Iqamah',
    displayTitle: 'Paparan',
    liveStreams: 'Live stream (kamera IP / ONVIF / RTSP / RTMP / HLS / WebRTC / YouTube)',
    eventsTitle: 'Hari Kebesaran Islam (countdown)',
    dutyTitle: 'Imam & Bilal bertugas',
    weatherTitle: 'Cuaca',
    hijriTitle: 'Tarikh hijrah',
    passwordTitle: 'Tukar kata laluan admin',
    name: 'Nama',
    tagline: 'Tagline',
    address: 'Alamat',
    logoOptional: 'Logo (pilihan)',
    removeLogo: 'Buang logo',
    saveMosque: 'Simpan masjid',
    locationSub: 'Digunakan untuk pengiraan waktu solat dan cuaca. Latitud/longitud dalam darjah perpuluhan.',
    latitude: 'Latitud',
    longitude: 'Longitud',
    placeName: 'Nama tempat',
    saveLocation: 'Simpan lokasi',
    jakimZone: 'Zon JAKIM (waktu solat rasmi)',
    timeSource: 'Sumber masa',
    sourceLocal: 'Pengiraan tempatan sahaja',
    fallbackMethod: 'Kaedah pengiraan fallback',
    timezone: 'Zon waktu (IANA)',
    showImsak: 'Papar Imsak',
    imsakOffset: 'Jarak imsak (minit sebelum Subuh)',
    showSunrise: 'Papar Syuruk',
    azanLead: 'Countdown azan bermula (minit sebelum azan)',
    iqamahOffset: 'Iqamah selepas azan (minit)',
    jemaahDur: 'Paparan Solat Jemaah (minit)',
    afterIqamah: 'Paparan selepas iqamah',
    afterIqamahJemaah: 'Paparan Solat Jemaah',
    afterIqamahBlack: 'Skrin hitam dengan jam (bucu kanan atas)',
    adjustments: 'Pelarasan (minit)',
    iqamahFixed: 'Masa tetap iqamah (HH:MM, pilihan — kosongkan untuk guna offset di atas)',
    fajr: 'Subuh',
    sunrise: 'Syuruk',
    dhuhr: 'Zohor',
    asr: 'Asar',
    maghrib: 'Maghrib',
    isha: 'Isyak',
    savePrayer: 'Simpan tetapan solat',
    audioSub: 'Skrin memainkan azan pada permulaan setiap solat dan panggilan iqamah pada masa iqamah yang ditetapkan. Muat naik fail audio sendiri atau tampal URL.',
    audioEnabled: 'Audio diaktifkan',
    adhanAudio: 'Audio azan',
    iqamahAudio: 'Audio iqamah',
    saveAudio: 'Simpan tetapan audio',
    languageLabel: 'Bahasa',
    colourPreset: 'Preset warna',
    clockFormat: 'Format jam',
    showSeconds: 'Papar saat',
    slideshowInterval: 'Selang slaid (saat)',
    fridayKhutbahUntil: 'Khutbah & Solat Jumaat sehingga (HH:mm)',
    tickerSpeed: 'Kelajuan ticker',
    safeMargin: 'Margin selamat (% skrin, untuk overscan TV)',
    mediaFit: 'Mod muat media',
    mediaFitStretch: 'Stretch — penuh, tanpa bar & tanpa crop',
    mediaFitFit: 'Fit — nisbah asal, bar hitam',
    mediaFitCrop: 'Crop — penuh, tepi dipangkas',
    showTicker: 'Papar ticker',
    tickerCustom: 'Teks tersuai ticker (pilihan — ganti pengumuman sistem, satu mesej sebaris)',
    showWeather: 'Papar cuaca',
    bannerStatic: 'Banner statik',
    bannerHint: 'Banner statik skrin penuh untuk majlis. Countdown azan/iqamah tetap berjalan seperti biasa di atasnya.',
    bannerEnabled: 'Papar banner statik (skrin penuh)',
    bannerTitle: 'Tajuk banner',
    bannerMessage: 'Mesej banner',
    bannerImage: 'Imej latar banner (pilihan)',
    bannerUploaded: 'Imej banner dimuat naik',
    coloursBg: 'Warna & latar',
    bgTop: 'Latar (atas)',
    bgBottom: 'Latar (bawah)',
    textColour: 'Teks',
    mutedText: 'Teks redup',
    accentGold: 'Aksen (emas)',
    accentTeal: 'Aksen 2 (teal)',
    bgPhoto: 'Foto latar (pilihan)',
    removePhoto: 'Buang foto',
    photoOpacity: 'Kelegapan foto',
    saveDisplay: 'Simpan tetapan paparan',
    testModeTitle: 'Mod ujian — countdown azan & iqamah',
    testModeSub: 'Simulasikan jam dan tarikh untuk melihat aliran azan/iqamah skrin penuh. "Jalankan ujian penuh" memainkan seluruh aliran secara langsung — setiap fasa 1 minit — termasuk audio azan & iqamah.',
    testEnabled: 'Aktifkan mod ujian',
    testDate: 'Tarikh simulasi',
    testTime: 'Jam simulasi',
    testPrayer: 'Set pantas — solat',
    testMinus5: 'T − 5 min',
    testAzan: 'Waktu azan',
    testIqamah: 'Waktu iqamah',
    saveTestMode: 'Simpan mod ujian',
    testRunFull: '▶ Jalankan ujian penuh (1 minit/fasa, dengan bunyi)',
    testFullStarted: 'Ujian penuh bermula — perhatikan skrin paparan',
    presetCustom: '— Tersuai —',
    presetNavy: 'Navy & Emas (lalai)',
    presetEmerald: 'Emerald & Emas',
    presetRoyal: 'Biru Diraja & Emas',
    presetMaroon: 'Maroon & Emas',
    presetCream: 'Hitam & Krim',
    presetLight: 'Cerah',
    headingFont: 'Font tajuk',
    fontSans: 'Sans (lalai)',
    fontSerif: 'Serif — Diraja',
    fontClassic: 'Klasik — Formal',
    clock24: '24 jam',
    clock12: '12 jam',
    tickerSlow: 'Perlahan',
    tickerNormal: 'Normal',
    tickerFast: 'Pantas',
    streamsSub: 'Stream RTSP, RTMP dan ONVIF ditukar ke HLS oleh ffmpeg pada mesin ini dan dipaparkan dalam slaid. YouTube menerima URL video biasa atau live. WebRTC menggunakan URL embed tersuai (cth. halaman gateway WebRTC anda).',
    ffmpegPath: 'Laluan ffmpeg (untuk RTSP/RTMP/ONVIF)',
    saveFfmpeg: 'Simpan laluan ffmpeg',
    addStream: '+ Tambah stream',
    saveStreams: 'Simpan stream',
    emptyStreams: 'Tiada stream lagi. Tambah kamera IP, video YouTube, atau URL live stream.',
    streamName: 'Nama',
    streamType: 'Jenis',
    seconds: 'Saat',
    streamUrl: 'URL',
    enabled: 'Aktif',
    eventsSub: 'Auto-sync dari takwim rasmi JAKIM — tarikh dikemas kini mengikut zon yang dipilih.',
    eventsAuto: 'Auto-sync dari JAKIM',
    syncNow: 'Sync sekarang',
    addEvent: '+ Tambah acara',
    saveEvents: 'Simpan acara',
    nameBm: 'Nama (BM)',
    nameEn: 'Nama (EN)',
    date: 'Tarikh',
    repeatYearly: 'Berulang tahunan',
    emptyEvents: 'Tiada hari kebesaran lagi.',
    eventNew: 'baharu',
    eventNotUpcoming: 'tidak akan datang',
    sourceJakim: 'JAKIM',
    sourceAnggaran: 'anggaran',
    rosterSub: 'Tugas hari ini dipaparkan pada skrin.',
    saveRoster: 'Simpan jadual',
    imam: 'Imam',
    bilal: 'Bilal',
    weatherEnabled: 'Cuaca diaktifkan',
    unit: 'Unit',
    saveWeather: 'Simpan cuaca',
    celsius: 'Celsius',
    fahrenheit: 'Fahrenheit',
    hijriOffset: 'Offset hari (−2 hingga +2)',
    saveHijri: 'Simpan offset hijrah',
    currentPassword: 'Kata laluan semasa',
    newPassword: 'Kata laluan baharu (min 6 aksara)',
    confirmPassword: 'Sahkan kata laluan baharu',
    changePassword: 'Tukar kata laluan',
    sessionExpired: 'Sesi tamat — sila log masuk semula',
    requestFailed: 'Permintaan gagal ({s})',
    wrongPassword: 'Kata laluan salah',
    signInFailed: 'Log masuk gagal',
    screenUrlCopied: 'URL skrin disalin',
    copyFailed: 'Salinan gagal — pilih URL secara manual',
    annPaused: 'Pengumuman dijeda',
    annActivated: 'Pengumuman diaktifkan',
    annDeleted: 'Pengumuman dipadam',
    annUpdated: 'Pengumuman dikemas kini',
    annCreated: 'Pengumuman dicipta',
    annRefreshed: 'Pengumuman dimuat semula',
    notFound: 'Tidak ditemui',
    mediaUploaded: 'Media dimuat naik',
    uploadFailed: 'Muat naik gagal',
    logoUploaded: 'Logo dimuat naik — klik “Simpan masjid” untuk terpakai',
    azanUploaded: 'Audio azan dimuat naik — klik “Simpan tetapan audio” untuk terpakai',
    iqamahUploaded: 'Audio iqamah dimuat naik — klik “Simpan tetapan audio” untuk terpakai',
    bgUploaded: 'Foto latar dimuat naik — klik “Simpan tetapan paparan” untuk terpakai',
    settingsSaved: 'Tetapan disimpan',
    streamsSaved: 'Stream disimpan & relay dimulakan semula',
    syncInProgress: 'Menyelaraskan dengan JAKIM…',
    syncDone: 'Sync selesai: {n} tarikh',
    syncFailed: 'Sync gagal',
    eventsSaved: 'Acara disimpan',
    passwordChanged: 'Kata laluan ditukar',
    fillPasswords: 'Isi semua ruangan kata laluan',
    pwTooShort: 'Kata laluan baharu mesti sekurang-kurangnya 6 aksara',
    pwMismatch: 'Kata laluan baharu tidak sepadan',
    idleLogout: 'Sesi tamat kerana tidak aktif — sila log masuk semula',
    logoMustImage: 'Logo mestilah imej',
    bgMustImage: 'Latar mestilah imej',
    checkingFfmpeg: 'Menyemak ffmpeg…',
    ffmpegOk: '✅ ffmpeg dikesan — relay RTSP/RTMP/ONVIF tersedia.',
    ffmpegMissing: '⚠️ ffmpeg TIDAK dijumpai. Pasang ffmpeg dan tetapkan laluannya di atas untuk stream RTSP/RTMP/ONVIF (HLS, YouTube dan embed WebRTC berfungsi tanpanya).',
    statusRunning: 'berjalan',
    statusStarting: 'bermula',
    statusReady: 'sedia',
    statusNoFfmpeg: 'tiada ffmpeg',
    statusDisabled: 'dilumpuhkan',
    statusStopped: 'berhenti',
    lastSynced: 'Terakhir: {t}',
    neverSynced: 'belum pernah',
    todayDuty: 'hari ini',
    daysShort: '{n}h'
    ,
    sunday: 'Ahad', monday: 'Isnin', tuesday: 'Selasa', wednesday: 'Rabu', thursday: 'Khamis', friday: 'Jumaat', saturday: 'Sabtu'
    ,
    loginUsername: 'Username',
    pinChangeSub: 'Tetapkan PIN superuser anda sebelum meneruskan',
    newPin: 'PIN baharu',
    confirmPin: 'Sahkan PIN',
    changePin: 'Tukar PIN',
    changePinOk: 'PIN dikemaskini',
    pinMismatch: 'PIN tidak sepadan',
    pinTooShort: 'PIN mesti sekurang-kurangnya 8 aksara',
    masjid: 'Masjid',
    masjidSub: 'Daftar akaun masjid dan urus lesen.',
    registerMasjid: 'Daftar masjid',
    mosqueNameLabel: 'Nama masjid',
    usernameLabel: 'Username admin',
    passwordLabel: 'Kata laluan admin',
    registerBtn: 'Daftar',
    license: 'Lesen',
    licenseTrial: 'Trial — {d} hari lagi',
    licenseActive: 'Berlesen (kekal)',
    licenseLocked: 'Lesen diperlukan',
    licenseSuspended: 'Digantung',
    apiKeyLabel: 'Kunci API paparan',
    copyKey: 'Salin kunci',
    copied: 'Disalin',
    registerLicense: 'Daftar lesen',
    licenseCodeLabel: 'Kod lesen',
    tenantId: 'ID Masjid',
    activate: 'Aktifkan',
    suspend: 'Tangguh',
    resetKey: 'Reset kunci API',
    users: 'Pengguna',
    addUser: '+ Tambah pengguna',
    removeUser: 'Buang',
    createdOn: 'Dicipta {d}',
    tenantStatus: 'Status: {s}',
    trialEnds: 'Trial hingga {d}',
    adminBadge: 'admin',
    deleteTenantConfirm: 'Padam “{name}”? Akaun masjid, pengguna admin, pengumuman dan media akan dipadam kekal.',
    userDeleteConfirm: 'Buang pengguna “{name}”?'
  }
};

function t(key: string, vars: Record<string, string | number> = {}) {
  let s = (I18N[adminLang] && I18N[adminLang][key]) ?? (I18N.en[key] ?? key);
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

function applyLang() {
  document.documentElement.lang = adminLang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t((el as HTMLElement).dataset.i18n!); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { (el as HTMLInputElement).placeholder = t((el as HTMLElement).dataset.i18nPlaceholder!); });
  const sel = $('adminLang');
  if (sel) sel.value = adminLang;
  renderAll();
}

function setAdminLang(lang: string) {
  adminLang = lang === 'ms' ? 'ms' : 'en';
  localStorage.setItem(ADMIN_LANG_KEY, adminLang);
  applyLang();
}

function renderAll() {
  if (!state.status) return;
  renderOverview();
  renderAnnouncements(state.announcements || []);
  populateSettings(state.settings || {});
  renderTv();
}

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

// ------------------------------------------------------------------ helpers

interface ApiOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface ApiOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

async function api(path: string, options: ApiOptions = {}): Promise<any> {
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

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', mkv: 'video/x-matroska',
  webm: 'video/webm', ogv: 'video/ogg', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  '3gp': 'video/3gpp', '3g2': 'video/3gpp2', ts: 'video/mp2t', flv: 'video/x-flv',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp'
};

function fileMime(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

async function uploadFile(file: File): Promise<UploadResult> {
  const mime = fileMime(file);
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

async function uploadToBlob(file: Blob, mime: string): Promise<UploadResult> {
  const { presignedUrl, pathname, kind } = await api('/api/admin/upload-url', {
    method: 'POST',
    body: { contentType: mime }
  });
  const putRes = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: file
  });
  if (!putRes.ok) throw new Error(`Muat naik ke Blob gagal (${putRes.status})`);
  const { url, kind: kind2 } = await api('/api/admin/upload-confirm', {
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

function toast(message: string, kind: string = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function showLogin() {
  $('appView').hidden = true;
  $('pinChangeView').hidden = true;
  $('loginView').hidden = false;
  $('loginUsername').focus();
}

function showApp() {
  $('pinChangeView').hidden = true;
  $('loginView').hidden = true;
  $('appView').hidden = false;
  const pairParam = new URLSearchParams(location.search).get('pair');
  if (pairParam) {
    switchView('tv');
    const input = $('tvPairCode');
    if (input) input.value = String(pairParam).toUpperCase();
  }
}

function showPinChange() {
  $('loginView').hidden = true;
  $('appView').hidden = true;
  $('pinChangeView').hidden = false;
  $('pinNew').focus();
}

// Tukar PIN secara manual dari sidebar (superuser sahaja).
let pinChangeFromApp = false;
$('changePinBtn').addEventListener('click', () => {
  pinChangeFromApp = true;
  showPinChange();
});

function switchView(name: string) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'tv') renderTv();
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView((btn as HTMLElement).dataset.view!));
});

const langSelect = document.getElementById('adminLang') as HTMLSelectElement | null;
if (langSelect) langSelect.addEventListener('change', (e) => setAdminLang((e.target as HTMLSelectElement).value));

// -------------------------------------------------------------------- login

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  $('loginError').hidden = true;
  try {
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
  state.role = '';
  localStorage.removeItem('tvm_token');
  localStorage.removeItem('tvm_role');
  showLogin();
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
  if (pin.length < 8) {
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

// ------------------------------------------------------------------ overview

async function loadApp() {
  showApp();
  const isSuper = state.role === 'superuser';
  $('masjidNavBtn').hidden = !isSuper;
  $('tvNavBtn').hidden = isSuper;
  $('licenseCard').hidden = isSuper;
  $('changePinBtn').hidden = !isSuper;
  try {
    if (isSuper) {
      await refreshTenants();
      $('sideMosque').textContent = 'Superuser';
      $('sideVersion').textContent = 'v0.2.0';
      switchView('masjid');
      return;
    }
    const [status, settings, methods, zonesRes, announcements, today, streamsRes, license] = await Promise.all([
      api('/api/admin/status'),
      api('/api/admin/settings'),
      api('/api/methods'),
      api('/api/zones'),
      api('/api/admin/announcements'),
      api('/api/today'),
      api('/api/admin/streams'),
      api('/api/admin/license')
    ]);
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
  $('note1').innerHTML = t('note1', { url: urlHtml });
  $('passwordNote').hidden = !s.adminPasswordFile;
  if (s.adminPasswordFile) {
    $('passwordNote').innerHTML = t('notePassword', { file: '<code>server/data/ADMIN_PASSWORD.txt</code>' });
  }
  $('audioNote').hidden = !s.audioEnabled;
  $('streamNote').hidden = s.streamCount === 0;
  $('streamNote').innerHTML = t('noteStreams', { count: `${s.activeStreamCount}/${s.streamCount}` });
  $('eventsSyncNote').hidden = !(s.eventsSync?.enabled);
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
  renderNextPrayer();
}

$('licRegisterBtn').addEventListener('click', async () => {
  const code = $('licCodeInput').value.trim();
  if (!code) return toast(t('licenseCodeLabel'), 'err');
  try {
    const res = await api('/api/admin/license', { method: 'POST', body: { code } });
    state.license = res;
    $('licCodeInput').value = '';
    renderOverview();
    toast(t('licenseActive'));
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

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

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
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

function renderAnnouncements(items: Array<Announcement & { status?: string }>) {
  const list = $('announcementList');
  if (!items.length) {
    state.announcements = [];
    list.innerHTML = `<div class="empty-state">${escapeHtml(t('emptyAnnouncements'))}</div>`;
    return;
  }
  state.announcements = items;
  const catLabel = (cat: string) => t(`cat${cat.charAt(0).toUpperCase()}${cat.slice(1)}`);
  list.innerHTML = items.map((a, i) => `
    <div class="announcement-item${a.active ? '' : ' inactive'}">
      <div>
        <div class="ann-title">${escapeHtml(a.title)}</div>
        <div class="ann-meta">
          <span class="chip ${a.category}">${escapeHtml(catLabel(a.category))}</span>
          <span class="chip ${a.status}">${t(a.status === 'active' ? 'statusActive' : 'statusInactive')}</span>
          ${a.video ? `<span class="chip event">${t('video')}</span>` : ''}
          ${a.start ? `<span>${t('from', { d: a.start })}</span>` : ''}
          ${a.end ? `<span>${t('until', { d: a.end })}</span>` : ''}
          <span>${t('priorityN', { n: a.priority })}</span>
        </div>
        ${a.message ? `<p class="ann-msg">${escapeHtml(a.message)}</p>` : ''}
      </div>
      <div class="ann-actions">
        <div class="ann-sort">
          <button class="btn ghost sm" data-action="up" data-id="${a.id}" ${i === 0 ? 'disabled' : ''} title="▲">▲</button>
          <button class="btn ghost sm" data-action="down" data-id="${a.id}" ${i === items.length - 1 ? 'disabled' : ''} title="▼">▼</button>
        </div>
        <button class="btn ghost sm" data-action="toggle" data-id="${a.id}">${a.active ? t('pause') : t('activate')}</button>
        <button class="btn ghost sm" data-action="edit" data-id="${a.id}">${t('edit')}</button>
        <button class="btn danger sm" data-action="delete" data-id="${a.id}">${t('delete')}</button>
      </div>
    </div>`).join('');
}

$('announcementList').addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLButtonElement | null;
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  try {
    if (action === 'toggle') {
      const current = await api('/api/admin/announcements').then((list: any[]) => list.find((x) => x.id === id));
      if (!current) throw new Error(t('notFound'));
      await api(`/api/admin/announcements/${id}`, { method: 'PUT', body: { active: !current.active } });
      toast(current.active ? t('annPaused') : t('annActivated'));
    } else if (action === 'edit') {
      const current = await api('/api/admin/announcements').then((list: any[]) => list.find((x) => x.id === id));
      openAnnouncementForm(current);
      return;
    } else if (action === 'up' || action === 'down') {
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

async function refreshAnnouncements() {
  const items = await api('/api/admin/announcements');
  renderAnnouncements(items);
}

function openAnnouncementForm(item: (Announcement & { status?: string }) | null) {
  state.editingId = item ? item.id : null;
  $('announcementFormTitle').textContent = item ? t('editAnnouncement') : t('newAnnouncement');
  $('anTitle').value = item?.title || '';
  $('anCategory').value = item?.category || 'announcement';
  $('anMessage').value = item?.message || '';
  $('anQuranDaily').checked = item ? item.quranDaily !== false : true;
  $('anArabic').value = item?.arabic || '';
  $('anTranslationMs').value = item?.translationMs || '';
  $('anTranslationEn').value = item?.translationEn || '';
  $('anRef').value = item?.ref || '';
  $('anStart').value = item?.start || '';
  $('anEnd').value = item?.end || '';
  $('anPriority').value = item?.priority ?? 0;
  $('anActive').checked = item ? item.active : true;
  $('anImageUrl').value = item?.image || '';
  $('anVideoUrl').value = item?.video || '';
  setMediaPreview(item?.image || '', item?.video || '');
  toggleQuranBox();
  $('announcementForm').hidden = false;
  $('announcementForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleQuranBox() {
  const quran = $('anCategory').value === 'quran';
  $('anQuranBox').hidden = !quran;
  if (quran && !$('anTitle').value.trim()) {
    $('anTitle').value = 'Ayat Quran Harian';
  }
}

$('anCategory').addEventListener('change', toggleQuranBox);

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
  setMediaPreview('', $('anVideoUrl').value);
});

$('anVideoClear').addEventListener('click', () => {
  $('anVideoUrl').value = '';
  $('anImage').value = '';
  setMediaPreview($('anImageUrl').value, '');
});

$('anSave').addEventListener('click', async () => {
  const payload = {
    title: $('anTitle').value,
    message: $('anMessage').value,
    category: $('anCategory').value,
    start: $('anStart').value || null,
    end: $('anEnd').value || null,
    priority: Number($('anPriority').value) || 0,
    active: $('anActive').checked,
    image: $('anImageUrl').value || null,
    video: $('anVideoUrl').value || null,
    quranDaily: $('anQuranDaily').checked,
    arabic: $('anArabic').value,
    translationMs: $('anTranslationMs').value,
    translationEn: $('anTranslationEn').value,
    ref: $('anRef').value
  };
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

async function refreshStatus() {
  state.status = await api('/api/admin/status');
  renderOverview();
}

// ------------------------------------------------------------------ settings

// Bendera "kotor": sebarang suntingan borang sejak isian semula terakhir.
let settingsDirty = false;
document.addEventListener('input', () => { settingsDirty = true; }, true);
document.addEventListener('change', () => { settingsDirty = true; }, true);

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
  $('stHeadingFont').value = s.display.headingFont || 'sans';
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
  $('stFridayUntil').value = s.display.fridayKhutbahUntil || '13:55';
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
  if (p.font) $('stHeadingFont').value = p.font;
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

function shiftTime(hhmm: string, mins: number): string {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m + mins);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Kunci solat untuk rujukan waktu — "jumaah" menggunakan waktu Zohor
// (aliran khutbah Jumaat menggantikan fasa jemaah Zohor pada hari Jumaat).
const testPrayerKey = (): string => {
  const v = $('stTestPrayer').value;
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

$('stTestPrayer').addEventListener('change', updateTestRef);

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
  list.innerHTML = current.map((s) => {
    const st = statusMap.get(s.id);
    const chip = streamStatusChip(st?.status);
    return `
      <div class="stream-row" data-id="${s.id}">
        <label><span data-i18n="streamName">Name</span><input type="text" class="st-name" value="${escapeHtml(s.name)}" placeholder="Camera 1"></label>
        <label><span data-i18n="streamType">Type</span><select class="st-type">
          ${STREAM_TYPES.map((ty) => `<option value="${ty}" ${ty === s.type ? 'selected' : ''}>${ty.toUpperCase()}</option>`).join('')}
        </select></label>
        <label><span data-i18n="seconds">Seconds</span><input type="number" class="st-duration" min="10" max="600" value="${s.duration || 30}"></label>
        <label class="st-url-wrap"><span data-i18n="streamUrl">URL</span><input type="text" class="st-url" value="${escapeHtml(s.url)}" placeholder="rtsp://… / https://youtu.be/… / https://…"></label>
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

$('streamList').addEventListener('click', (e) => {
  const del = (e.target as HTMLElement).closest('[data-del]') as HTMLElement | null;
  if (!del) return;
  const row = del.closest('.stream-row') as HTMLElement | null;
  state.streamsStatus = collectStreams().filter((s) => s.id !== row!.dataset.id);
  renderStreams();
});

$('addStreamBtn').addEventListener('click', () => {
  const draft = { id: `draft-${Date.now()}`, name: '', type: 'rtsp', url: '', duration: 30, enabled: true };
  state.streamsStatus = [...collectStreams(), draft];
  renderStreams();
});

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

$('saveStreamsBtn').addEventListener('click', async () => {
  try {
    const res = await api('/api/admin/streams', { method: 'PUT', body: { streams: collectStreams() } });
    state.streamsStatus = res.streams || [];
    renderStreams();
    renderFfmpegStatus();
    toast(t('streamsSaved'));
    await refreshStatus();
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

function renderFfmpegStatus() {
  const el = $('ffmpegStatus');
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

$('syncEventsBtn').addEventListener('click', async () => {
  try {
    toast(t('syncInProgress'));
    const result = await api('/api/admin/events/sync', { method: 'POST', body: {} });
    if (!result.ok) throw new Error(result.message || 'Sync gagal');
    const settings = await api('/api/admin/settings');
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
    const updated = await api('/api/admin/settings', {
      method: 'PUT',
      body: { events: collectEvents(), eventsSync: { enabled: $('stEventsAuto').checked } }
    });
    renderEvents(updated.events || []);
    renderEventsSyncStatus(updated.eventsSync || {});
    toast(t('eventsSaved'));
    await refreshStatus();
    if ($('stEventsAuto').checked) {
      const result = await api('/api/admin/events/sync', { method: 'POST', body: {} });
      if (!result.ok) throw new Error(result.message || 'Sync gagal');
      const settings = await api('/api/admin/settings');
      renderEvents(settings.events || []);
      renderEventsSyncStatus(settings.eventsSync || {});
    }
  } catch (err) {
    toast((err as Error).message, 'err');
  }
});

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

document.querySelectorAll('[data-save]').forEach((btnEl) => {
  const btn = btnEl as HTMLElement;
  btn.addEventListener('click', async () => {
    const section = btn.dataset.save;
    const patch = buildPatch(section);
    try {
      const updated = await api('/api/admin/settings', { method: 'PUT', body: patch });
      populateSettings(updated);
      toast(t('settingsSaved'));
      if (section === 'ffmpeg') {
        const res = await api('/api/admin/streams');
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
          headingFont: $('stHeadingFont').value,
          clockFormat: $('stClockFormat').value,
          showSeconds: $('stShowSeconds').checked,
          slideshowInterval: Number($('stSlideInterval').value),
          fridayKhutbahUntil: $('stFridayUntil').value,
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

$('pwSaveBtn').addEventListener('click', async () => {
  const current = $('pwCurrent').value;
  const next = $('pwNew').value;
  const confirm = $('pwConfirm').value;
  if (!current || !next) return toast(t('fillPasswords'), 'err');
  if (next.length < 6) return toast(t('pwTooShort'), 'err');
  if (next !== confirm) return toast(t('pwMismatch'), 'err');
  try {
    const data = await api('/api/admin/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
    if (data.token) {
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

// ------------------------------------------------------- auto-sync 10 saat

async function syncAdminData() {
  if (!state.token) return;
  if (state.role === 'superuser') return;
  const editing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  try {
    const [status, today, announcements] = await Promise.all([
      api('/api/admin/status'),
      api('/api/today'),
      api('/api/admin/announcements')
    ]);
    state.status = status;
    state.today = today;
    state.announcements = announcements;
    renderOverview();
    renderAnnouncements(announcements);
    renderTv();
    if (!editing && !settingsDirty) {
      const settings = await api('/api/admin/settings');
      state.settings = settings;
      populateSettings(settings);
    }
  } catch {
    // Senyap semasa sync latar (cth. sesi tamat)
  }
}

setInterval(syncAdminData, 10000);

// ------------------------------------------------------------- superuser

async function refreshTenants() {
  state.superTenants = await api('/api/super/tenants');
  renderTenants();
}

function renderTenants() {
  const list = $('tenantList');
  if (!state.superTenants?.length) {
    const noTenants = (I18N[adminLang] && I18N[adminLang].noTenants) || I18N.en.noTenants || I18N.en.emptyEvents;
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

// ----------------------------------------------------------------------- boot

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (state.token) {
  loadApp().then(() => resetIdleTimer()).catch(() => showLogin());
} else {
  showLogin();
}

applyLang();

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
    list.innerHTML = devices.map((d) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(196,220,248,0.12)">
        <div style="min-width:0">
          <strong>${escapeHtml(d.name || d.device_id)}</strong>
          <p class="sub" style="font-size:11px;word-break:break-all">${escapeHtml(d.device_id)} • ${
            d.last_seen ? new Date(Number(d.last_seen) || (d.last_seen as unknown as string)).toLocaleString() : '—'
          }</p>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn ghost sm" data-rename="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name || '')}">✏️ ${escapeHtml(t('tvRename'))}</button>
          <button class="btn ghost sm" data-unpair="${escapeHtml(d.id)}">${escapeHtml(t('tvUnpair'))}</button>
        </div>
      </div>`).join('');
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

// PWA — daftar service worker supaya admin boleh dipasang di telefon/tab.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
