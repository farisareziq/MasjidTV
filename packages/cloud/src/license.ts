// Sistem lesen: kod dijana oleh alat OFFLINE (kunci peribadi), disahkan di cloud
// dengan kunci awam (Ed25519). Lesen adalah PERPETUAL — tiada tarikh luput.
// Port of reference cloud/license.js.

import crypto from 'node:crypto';

const PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || '';

export interface TenantLike {
  trialUntil?: number;
  trial_until?: number;
  status?: string;
  licenseCode?: string;
  license_code?: string;
  licenseVerifiedAt?: number | null;
  license_verified_at?: number | null;
}

export function encodeLicense(tenantId: string, privateKey: string): string {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, v: 1, k: 'perpetual' }), 'utf8');
  const sig = crypto.sign(null, payload, privateKey);
  const hex = payload.toString('hex') + sig.toString('hex');
  const grouped = hex.replace(/(.{5})/g, '$1-').replace(/-$/, '');
  return `TVM-${grouped}`;
}

export function verifyLicense(code: string): { ok: boolean; reason?: string; tenantId?: string } {
  if (typeof code !== 'string' || !code.startsWith('TVM-')) return { ok: false, reason: 'format' };
  const hex = code.slice(4).replace(/-/g, '');
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length <= 130) return { ok: false, reason: 'format' };
  const sigHex = hex.slice(-128);
  const payloadHex = hex.slice(0, -128);
  const payload = Buffer.from(payloadHex, 'hex');
  const sig = Buffer.from(sigHex, 'hex');
  if (!PUBLIC_KEY) return { ok: false, reason: 'no-public-key' };
  let ok = false;
  try {
    const pub = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY, 'base64'), format: 'der', type: 'spki' });
    ok = crypto.verify(null, payload, pub, sig);
  } catch {
    return { ok: false, reason: 'key' };
  }
  if (!ok) return { ok: false, reason: 'signature' };
  let data: { v?: number; k?: string; t?: string } | null = null;
  try {
    data = JSON.parse(payload.toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload' };
  }
  if (data?.v !== 1 || data?.k !== 'perpetual' || typeof data?.t !== 'string') {
    return { ok: false, reason: 'type' };
  }
  return { ok: true, tenantId: data.t };
}

export interface LicenseStatus {
  status: 'licensed' | 'trial' | 'locked' | 'suspended';
  unlocked: boolean;
  verifiedAt?: number | null;
  trialUntil?: number;
  message?: string;
}

export function licenseStatus(tenant: TenantLike, t = Date.now()): LicenseStatus {
  const trialUntil = Number(tenant.trialUntil ?? tenant.trial_until ?? 0);
  if (tenant.status === 'suspended') {
    return { status: 'suspended', unlocked: false, message: 'Akaun digantung' };
  }
  if ((tenant.licenseCode ?? tenant.license_code) && (tenant.licenseVerifiedAt ?? tenant.license_verified_at)) {
    return { status: 'licensed', unlocked: true, verifiedAt: tenant.licenseVerifiedAt ?? tenant.license_verified_at };
  }
  if (t < trialUntil) {
    return { status: 'trial', unlocked: true, trialUntil };
  }
  return { status: 'locked', unlocked: false, message: 'Lesen diperlukan' };
}
