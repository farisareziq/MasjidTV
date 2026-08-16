// Cloud auth: JWT + bcrypt + rate limiting (port of reference cloud/auth.js).

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { loginAttempts, eq, type CloudDatabase } from '@masjidtv/db';

// Predikat produksi MESTI sepadan dengan app.ts — di Vercel, NODE_ENV
// sentiasa 'production', tetapi jangan benarkan rahsia dev jika hanya
// salah satu ditetapkan (cth. vercel dev dengan VERCEL=1).
const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const JWT_SECRET: string = process.env.JWT_SECRET || (isProd ? '' : 'dev-secret-ganti-sebelum-produksi');
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET diperlukan — tetapkan pemboleh ubah persekitaran JWT_SECRET sebelum deploy produksi');
}
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface TokenPayload {
  uid: string;
  tid: string | null;
  role: string;
  v: number;
}

export function signToken({ userId, tenantId, role, version = 0 }: {
  userId: string;
  tenantId: string | null;
  role: string;
  version?: number;
}): string {
  return jwt.sign({ uid: userId, tid: tenantId || null, role, v: version }, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as unknown as TokenPayload;
  } catch {
    return null;
  }
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(String(pw), 10);
}

export function comparePassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(String(pw), hash);
}

function now(): number {
  return Date.now();
}

export async function checkRateLimit(db: CloudDatabase, key: string): Promise<{ locked: boolean; until: number }> {
  const rows = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).all();
  const lockedUntil = Number(rows[0]?.lockedUntil || 0);
  if (lockedUntil > now()) return { locked: true, until: lockedUntil };
  return { locked: false, until: 0 };
}

export async function recordFailure(
  db: CloudDatabase,
  key: string,
  maxAttempts = MAX_ATTEMPTS,
  lockMs = LOCK_MS
): Promise<{ count: number; locked: boolean; until: number }> {
  const rows = await db.select().from(loginAttempts).where(eq(loginAttempts.key, key)).all();
  const prev = rows[0];
  const prevUntil = Number(prev?.lockedUntil || 0);
  // Selepas kunci tamat tempoh, mula kiraan baharu — jika tidak, satu
  // kegagalan sahaja cukup untuk mengunci semula selama-lamanya.
  const expired = prevUntil > 0 && prevUntil <= now();
  const count = (expired ? 0 : Number(prev?.count || 0)) + 1;
  const lockedUntil = count >= maxAttempts ? now() + lockMs : 0;
  await db.insert(loginAttempts)
    .values({ key, count, lockedUntil })
    .onConflictDoUpdate({ target: loginAttempts.key, set: { count, lockedUntil } })
    .run();
  return { count, locked: count >= maxAttempts, until: lockedUntil };
}

export async function clearFailures(db: CloudDatabase, key: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.key, key)).run();
}
