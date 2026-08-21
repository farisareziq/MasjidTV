// Deployment preflight — validate cloud config BEFORE going live.
// Usage:
//   node scripts/preflight.mjs                    # local env / config check
//   node scripts/preflight.mjs --url https://...  # + live production checks
//   node scripts/preflight.mjs --pem path/to/masjidtv-license-ed25519.pem
//
// Exit code 1 if any REQUIRED check fails; 2 if only warnings failed.
import crypto from 'node:crypto';
import fs from 'node:fs';

const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

const liveUrl = (argVal('--url') || process.env.PREFLIGHT_URL || '').replace(/\/+$/, '');
const pemPath = argVal('--pem') || process.env.PREFLIGHT_PEM;
const env = process.env;

// `vercel env pull` menulis nilai placeholder "[SENSITIVE***" untuk secret —
// nilai tempatan BUKAN nilai sebenar. Sebarang semakan kandungan (kekuatan
// JWT, padanan keystore lesen) ke atas nilai bertopeng adalah tidak sah:
// jangan PASS palsu (nilai hadir) atau FAIL palsu (nampak pendek/salah).
const isMasked = (v) => typeof v === 'string' && v.startsWith('[SENSITIVE');

const results = [];
function check(name, { required = true, ok, detail = '' }) {
  results.push({ name, required, ok: !!ok, detail });
}

// --- 1. Cloud env vars (TURSO_URL, TURSO_AUTH_TOKEN, JWT_SECRET,
//        LICENSE_PUBLIC_KEY, VERCEL_BLOB_READ_WRITE_TOKEN) ---------------
// Skip with PREFLIGHT_SKIP_ENV=1 (e.g. CI smoke runs: env lives in Vercel,
// not on the runner — live checks below still validate production).
if (process.env.PREFLIGHT_SKIP_ENV === '1') {
  check('env checks skipped (PREFLIGHT_SKIP_ENV=1)', { required: false, ok: true });
} else {
const requiredEnv = ['TURSO_URL', 'TURSO_AUTH_TOKEN', 'JWT_SECRET', 'LICENSE_PUBLIC_KEY'];
for (const key of requiredEnv) {
  const v = env[key];
  // Bertopeng = variabel ADA dalam Vercel (CLI hanya menopeng nilai yang
  // ditetapkan) — kehadiran sah, kandungan tidak boleh disemak.
  check(`env ${key}`, {
    ok: !!v,
    detail: isMasked(v)
      ? 'hadir (nilai bertopeng [SENSITIVE*** oleh vercel env pull — semakan kandungan perlu env sebenar)'
      : v ? undefined : 'missing (set in Vercel → Settings → Environment Variables)'
  });
}
// Vercel Blob — kod cloud (admin.ts) fallback kedua-dua nama; preflight
// selari supaya tidak false-fail pada projek yang menamakan tanpa prefix.
const blobToken = env.VERCEL_BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN;
check('env VERCEL_BLOB_READ_WRITE_TOKEN', {
  ok: !!blobToken,
  detail: isMasked(blobToken)
    ? 'hadir (nilai bertopeng [SENSITIVE***)'
    : blobToken ? undefined : 'missing (Vercel → Settings → Environment Variables; juga terima BLOB_READ_WRITE_TOKEN)'
});
check('TURSO_URL is remote libsql', {
  required: false,
  ok: !env.TURSO_URL || isMasked(env.TURSO_URL) || env.TURSO_URL.startsWith('libsql://'),
  detail: isMasked(env.TURSO_URL) || env.TURSO_URL?.startsWith('libsql://') ? undefined : 'production should use libsql:// (Turso), not a local file'
});
}

// --- 2. JWT secret strength ----------------------------------------------
// Nilai bertopeng [SENSITIVE*** tidak boleh dinilai — WARN (unknown), bukan
// PASS palsu atau FAIL palsu.
if (isMasked(env.JWT_SECRET)) {
  check('JWT_SECRET strength (>=32 chars, non-obvious)', {
    required: false,
    ok: false,
    detail: 'nilai bertopeng [SENSITIVE*** — tidak boleh dinilai secara tempatan; sahkan pada mesin dengan env sebenar'
  });
} else if (env.JWT_SECRET) {
  const weak = env.JWT_SECRET.length < 32 || /^(change|dev|test|secret|password)/i.test(env.JWT_SECRET);
  check('JWT_SECRET strength (>=32 chars, non-obvious)', {
    ok: !weak,
    detail: weak ? 'use: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' : undefined
  });
}

// --- 2b. Env produksi pilihan (C4 + public URL) — WARN sahaja, bukan blocker.
// Tanpa ini ciri beroperasi tetapi kehilangan pemantauan ralat / URL skrin
// yang stabil / alert smoke.
if (process.env.PREFLIGHT_SKIP_ENV !== '1') {
  check('SENTRY_DSN (C4: pemantauan ralat 5xx)', {
    required: false,
    ok: !!env.SENTRY_DSN,
    detail: 'disyorkan — tanpa ini ralat 5xx cloud tidak dilaporkan (no-op selamat)'
  });
  check('MASJIDTV_PUBLIC_URL (URL skrin stabil)', {
    required: false,
    ok: !!env.MASJIDTV_PUBLIC_URL,
    detail: 'disyorkan — tanpa ini URL skrin diterbit daripada Host header (pecah pada preview/custom domain)'
  });
  const hasAlertHook = !!(env.DISCORD_WEBHOOK_URL || env.SLACK_WEBHOOK_URL);
  check('Alert webhook smoke (DISCORD/SLACK_WEBHOOK_URL)', {
    required: false,
    ok: hasAlertHook,
    detail: 'disyorkan — tanpa ini kegagalan smoke 6-jam tidak menghantar alert (secret GitHub, bukan Vercel)'
  });
}

// --- 3. License keypair match ---------------------------------------------
// Derive the public key from the vendor private key and compare with the
// cloud LICENSE_PUBLIC_KEY — mismatch = every activation fails with
// "Kod lesen tidak sah".
if (pemPath && fs.existsSync(pemPath)) {
  if (isMasked(env.LICENSE_PUBLIC_KEY)) {
    // Nilai tempatan bertopeng — perbandingan tidak sah. WAJIB gagal:
    // go-live dengan keystore tidak sepadan mematikan SEMUA pengaktifan
    // lesen pelanggan. (Jangan PASS palsu hanya kerana nilai hadir.)
    check('license keypair matches LICENSE_PUBLIC_KEY', {
      ok: false,
      detail: 'LICENSE_PUBLIC_KEY tempatan bertopeng [SENSITIVE*** — jalankan preflight ini dengan env sebenar (bukan vercel env pull) untuk mengesahkan padanan keystore'
    });
  } else {
    try {
      const priv = crypto.createPrivateKey(fs.readFileSync(pemPath, 'utf8'));
      const pub = crypto.createPublicKey(priv);
      const spki = pub.export({ type: 'spki', format: 'der' }).toString('base64');
      const cloudKey = env.LICENSE_PUBLIC_KEY;
      const same = !!cloudKey && cloudKey.length === spki.length
        && crypto.timingSafeEqual(Buffer.from(spki), Buffer.from(String(cloudKey)));
      check('license keypair matches LICENSE_PUBLIC_KEY', {
        ok: same,
        detail: same || !cloudKey ? (cloudKey ? undefined : 'LICENSE_PUBLIC_KEY not set; cannot compare') : 'cloud key differs from the PEM — activations will fail with "Kod lesen tidak sah"'
      });
    } catch (err) {
      check('license keypair matches LICENSE_PUBLIC_KEY', { ok: false, detail: `cannot load PEM: ${err.message}` });
    }
  }
} else if (env.LICENSE_PUBLIC_KEY) {
  if (isMasked(env.LICENSE_PUBLIC_KEY)) {
    check('LICENSE_PUBLIC_KEY is a valid Ed25519 SPKI key', {
      required: false,
      ok: false,
      detail: 'nilai bertopeng [SENSITIVE*** — tidak boleh disahkan secara tempatan'
    });
  } else {
    try {
      crypto.createPublicKey({ key: Buffer.from(env.LICENSE_PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });
      check('LICENSE_PUBLIC_KEY is a valid Ed25519 SPKI key', { ok: true });
    } catch {
      check('LICENSE_PUBLIC_KEY is a valid Ed25519 SPKI key', { ok: false, detail: 'run: node tools/license-gen.mjs keygen' });
    }
    if (!pemPath) {
      check('license private key provided for match test (--pem)', {
        required: false,
        ok: false,
        detail: 'optional but recommended pre-go-live: preflight --pem masjidtv-license-ed25519.pem'
      });
    }
  }
}

// --- 4. Live production checks ---------------------------------------------
if (liveUrl) {
  const { setTimeout: sleep } = await import('node:timers/promises');

  // Health endpoint
  try {
    const res = await fetch(`${liveUrl}/api/health`);
    const body = await res.json().catch(() => ({}));
    check(`GET ${liveUrl}/api/health → 200`, { ok: res.status === 200 && body.ok === true });
  } catch (err) {
    check(`GET ${liveUrl}/api/health → 200`, { ok: false, detail: err.message });
  }

  // Unauthenticated tenant API must be rejected (auth wired correctly).
  try {
    const res = await fetch(`${liveUrl}/api/settings`);
    check('unauthenticated /api/settings rejected (401/403)', { ok: res.status === 401 || res.status === 403, detail: `got ${res.status}` });
  } catch (err) {
    check('unauthenticated /api/settings rejected (401/403)', { ok: false, detail: err.message });
  }

  // Security headers present.
  try {
    const res = await fetch(liveUrl);
    const h = res.headers;
    check('security headers (content-security-policy, x-content-type-options)', {
      ok: !!h.get('content-security-policy') && !!h.get('x-content-type-options')
    });
  } catch (err) {
    check('security headers (content-security-policy, x-content-type-options)', { ok: false, detail: err.message });
  }

  // Superuser PIN must have been changed from bootstrap value — check by
  // probing: bootstrap PINs are 8 chars base64url; login must NOT succeed
  // with an empty/guessable PIN. (True validation is mustChangePin server-
  // side; here we just confirm login rejects a bad PIN quickly.)
  try {
    const res = await fetch(`${liveUrl}/api/auth/superuser/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '00000000' })
    });
    check('superuser login rejects bad PIN', { ok: [401, 400, 429].includes(res.status), detail: `got ${res.status}` });
  } catch (err) {
    check('superuser login rejects bad PIN', { ok: false, detail: err.message });
  }

  // Cold-start latency sanity (serverless): 3 probes, warn if p3 > 3s.
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try { await fetch(`${liveUrl}/api/health`); } catch { /* counted as slow */ }
    samples.push(Date.now() - t0);
    await sleep(300);
  }
  const worst = Math.max(...samples);
  check(`health latency worst-of-3 (${worst}ms)`, { required: false, ok: worst < 3000, detail: worst < 3000 ? undefined : 'consider checking Vercel region / Turso latency' });
} else {
  check('live URL checks (--url https://your-app.vercel.app)', {
    required: false,
    ok: false,
    detail: 'skipped — pass --url after first deploy'
  });
}

// --- report ----------------------------------------------------------------
let failedRequired = 0;
let failedWarn = 0;
console.log('\nMasjidTV deployment preflight\n=============================');
for (const r of results) {
  const tag = r.ok ? 'PASS' : r.required ? 'FAIL' : 'WARN';
  if (!r.ok && r.required) failedRequired++;
  if (!r.ok && !r.required) failedWarn++;
  console.log(`  [${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log('');
if (failedRequired) {
  console.error(`preflight FAILED: ${failedRequired} required check(s) did not pass.`);
  process.exit(1);
}
if (failedWarn) {
  console.warn(`preflight passed with ${failedWarn} warning(s).`);
  process.exit(0);
}
console.log('preflight OK — ready for go-live.');
