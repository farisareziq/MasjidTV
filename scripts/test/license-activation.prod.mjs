// Real production license activation test (F1) — end-to-end against masjidtv.vercel.app
// Flow: superuser login → create throwaway tenant → issue license OFFLINE with
//       vendor private key → activate on PROD → verify status 'licensed'.
// Cleanup: tenant deleted in finally. Never prints PIN/license codes in full.
//
// Usage: F1_SUPERUSER_PIN=<pin prod semasa> node scripts/test/license-activation.prod.mjs
// (Tanpa env: cuba fail bootstrap temp — PIN PROD tidak pernah sampai ke mesin ini;
//  fail temp ditulis oleh boot cloud LOKAL (pentest/e2e), bukan prod.)
//
// LULUS = padanan keystore terbukti secara fungsi: tandatangan Ed25519 kunci
// peribadi vendor disahkan oleh LICENSE_PUBLIC_KEY prod — melengkapkan semakan
// 'license keypair matches' preflight yang tidak boleh dibuat atas nilai bertopeng.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PROD = process.env.F1_PROD_URL || 'https://masjidtv.vercel.app';
const PEM = process.env.F1_PEM || 'tools/license-gen-cli/masjidtv-license-ed25519.pem';

const pin = process.env.F1_SUPERUSER_PIN
  || (() => {
    try {
      const txt = fs.readFileSync(path.join(os.tmpdir(), 'MASJIDTV_SUPERUSER_PIN.txt'), 'utf8');
      const line = txt.split('\n').map((l) => l.trim()).find((l) => l.startsWith('admin / '));
      return line?.replace(/^admin \/ /, '');
    } catch { return undefined; }
  })();
if (!pin) {
  console.error('F1: PIN tiada — set F1_SUPERUSER_PIN=<PIN prod semasa> (atau regen fail bootstrap temp).');
  process.exit(1);
}
if (!fs.existsSync(PEM)) {
  console.error(`F1: kunci peribadi vendor tiada — ${PEM} (alat lesen di mesin vendor).`);
  process.exit(1);
}

const j = async (url, init = {}) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  let json = null; try { json = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, json };
};

// 1. Login superuser
const login = await j(`${PROD}/api/auth/superuser/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', pin })
});
if (login.status !== 200) {
  console.error(`F1 FAIL: superuser login → ${login.status} (PIN salah/dikunci rate-limit — 429 = tunggu 15min).`);
  process.exit(1);
}
const token = login.json.token;
console.log(`1. superuser login: OK (mustChangePin=${login.json.mustChangePin})`);

// 2. Tenant sekali-guna
const mk = await j(`${PROD}/api/super/tenants`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: 'F1 Audit Verify', username: `f1audit${Date.now() % 100000}`, password: 'f1auditpass123' })
});
if (mk.status !== 201 && mk.status !== 200) { console.error(`F1 FAIL: create tenant → ${mk.status}`, JSON.stringify(mk.json).slice(0, 200)); process.exit(1); }
const tenantId = mk.json.id;
console.log(`2. tenant dibuat: ${tenantId} (status=${mk.json.status})`);

try {
  // 3. Jana lesen OFFLINE (kunci peribadi vendor — tidak pernah keluar mesin ini)
  const priv = crypto.createPrivateKey(fs.readFileSync(PEM, 'utf8'));
  const payload = Buffer.from(JSON.stringify({ t: tenantId, v: 1, k: 'perpetual' }), 'utf8');
  const sig = crypto.sign(null, payload, priv);
  const hex = payload.toString('hex') + sig.toString('hex');
  const code = `TVM-${hex.replace(/(.{5})/g, '$1-').replace(/-$/, '')}`;
  console.log(`3. lesen dijana OFFLINE (TVM-…${code.slice(-6)}, ${code.length} aksara)`);

  // 4. Ujian negatif dahulu: kod sampah mesti ditolak 'Kod lesen tidak sah'
  const bad = await j(`${PROD}/api/super/tenants/${tenantId}/license`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: `TVM-${'a'.repeat(200)}` })
  });
  console.log(`4. kod sampah ditolak: ${bad.status === 400 ? 'PASS' : 'FAIL'} (${bad.json?.error || bad.status})`);
  if (bad.status !== 400) process.exit(1);

  // 5. Pengaktifan SEBENAR dengan kod bertandatangan betul
  const act = await j(`${PROD}/api/super/tenants/${tenantId}/license`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ code })
  });
  const licensed = act.status === 200 && act.json.status === 'licensed' && act.json.license?.status === 'licensed';
  console.log(`5. pengaktifan lesen SEBENAR di prod: ${act.status === 200 ? 'PASS' : 'FAIL'} (status=${act.json?.status}, license=${act.json?.license?.status}, verifiedAt=${act.json?.license?.verifiedAt ? 'set' : 'TIADA'})`);
  if (!licensed) { console.error('   balasan:', JSON.stringify(act.json).slice(0, 300)); process.exit(1); }

  // 6. Padanan keystore terbukti secara fungsi (Ed25519 verify oleh kunci awam prod)
  console.log('6. padanan keystore terbukti secara fungsi — LICENSE_PUBLIC_KEY prod mengesahkan tandatangan kunci vendor.');

  console.log('\nF1: UJI PENGAKTIFAN LESEN — LULUS. Keystore vendor sepadan dengan kunci awam prod.');
} finally {
  // 7. Bersih
  const del = await j(`${PROD}/api/super/tenants/${tenantId}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${token}` }
  });
  console.log(`7. cleanup tenant ujian: ${del.status === 200 ? 'dibuang' : `AMARAN ${del.status} — buang manual (${tenantId})`}`);
}
