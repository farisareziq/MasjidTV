// MasjidTV license generator — runs OFFLINE on the vendor machine.
// The Ed25519 private key NEVER enters the repo (plan: license tooling is
// external). The cloud verifies codes with LICENSE_PUBLIC_KEY (env).
//
// Setup (once, on the vendor machine):
//   1. Generate a keypair:
//        node tools/license-gen.mjs keygen
//      -> prints the base64 SPKI public key (set as cloud env
//         LICENSE_PUBLIC_KEY) and saves masjidtv-license-ed25519.pem locally.
//   2. Keep the .pem private. Do NOT commit it.
//
// Issue a perpetual license for a tenant:
//   node tools/license-gen.mjs issue <tenantId> [path/to/masjidtv-license-ed25519.pem]
//
// Verify (offline sanity check):
//   node tools/license-gen.mjs verify <code> [publicKeyBase64]

import crypto from 'node:crypto';
import fs from 'node:fs';

const [,, cmd, ...rest] = process.argv;

function keygen() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync('masjidtv-license-ed25519.pem', pem, { mode: 0o600 });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  console.log('Private key saved: masjidtv-license-ed25519.pem (KEEP PRIVATE, never commit)');
  console.log('\nLICENSE_PUBLIC_KEY (set this on the cloud):\n' + spki);
}

function payloadFor(tenantId) {
  return Buffer.from(JSON.stringify({ t: tenantId, v: 1, k: 'perpetual' }), 'utf8');
}

function encodeLicense(tenantId, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const payload = payloadFor(tenantId);
  const sig = crypto.sign(null, payload, privateKey);
  const hex = payload.toString('hex') + sig.toString('hex');
  const grouped = hex.replace(/(.{5})/g, '$1-').replace(/-$/, '');
  return `TVM-${grouped}`;
}

function verifyLicense(code, publicKeyBase64) {
  if (!code.startsWith('TVM-')) return { ok: false, reason: 'format' };
  const hex = code.slice(4).replace(/-/g, '');
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length <= 130) return { ok: false, reason: 'format' };
  const sig = Buffer.from(hex.slice(-128), 'hex');
  const payload = Buffer.from(hex.slice(0, -128), 'hex');
  const pub = crypto.createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
  if (!crypto.verify(null, payload, pub, sig)) return { ok: false, reason: 'signature' };
  return { ok: true, data: JSON.parse(payload.toString('utf8')) };
}

switch (cmd) {
  case 'keygen':
    keygen();
    break;
  case 'issue': {
    const [tenantId, pemPath = 'masjidtv-license-ed25519.pem'] = rest;
    if (!tenantId) {
      console.error('Usage: node tools/license-gen.mjs issue <tenantId> [pem]');
      process.exit(1);
    }
    if (!fs.existsSync(pemPath)) {
      console.error(`Private key not found: ${pemPath}. Run keygen first (on the vendor machine).`);
      process.exit(1);
    }
    console.log(encodeLicense(tenantId, fs.readFileSync(pemPath, 'utf8')));
    break;
  }
  case 'verify': {
    const [code, pub] = rest;
    if (!code || !pub) {
      console.error('Usage: node tools/license-gen.mjs verify <code> <publicKeyBase64>');
      process.exit(1);
    }
    console.log(JSON.stringify(verifyLicense(code, pub), null, 2));
    break;
  }
  default:
    console.log('Usage:\n  node tools/license-gen.mjs keygen\n  node tools/license-gen.mjs issue <tenantId> [pem]\n  node tools/license-gen.mjs verify <code> <publicKeyBase64>');
}
