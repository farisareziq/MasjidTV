// Pelapor ralat minimal tanpa dependency baru (PLAN.md C4) — @sentry/* akan
// membesarkan bundle serverless Vercel, jadi kita POST terus ke endpoint
// envelope HTTP Sentry/GlitchTip menggunakan fetch global (Node 18+).
//
// Gelagat ENV-GATED: tanpa SENTRY_DSN, `initErrorReporting` ialah no-op —
// tiada fetch, tiada hook, tiada overhead. Dengan DSN, ralat 5xx yang
// sampai ke setErrorHandler dihantar fire-and-forget (timeout 5sa) —
// TIDAK PERNAH melempar, TIDAK PERNAH menyekat/melambatkan balasan HTTP.
//
// Format DSN: https://<publicKey>@<host>/<projectId>
// Endpoint  : https://<host>/api/<projectId>/envelope/
// Payload   : satu item envelope "event" (JSON Sentry standard) — host,
//   mesej, stack, url permintaan & tag kecil. Tiada maklumat peribadi
//   (tenant/key/token) dilampirkan — mesej ralat Fastify sahaja.

import type { FastifyInstance, FastifyError } from 'fastify';
import crypto from 'node:crypto';

const REPORT_TIMEOUT_MS = 5_000; // fire-and-forget — jangan tunggu lama

interface DsnParts {
  endpoint: string; // URL envelope penuh
  authHeader: string; // X-Sentry-Auth ringkas
}

// Huraikan DSN Sentry/GlitchTip. Pulangkan null jika format tidak sah —
// DSN rosak TIDAK BOLEH mematikan app (log amaran sahaja).
function parseDsn(dsn: string): DsnParts | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/\/+$/, '').split('/').pop() || '';
    if (!publicKey || !projectId) return null;
    return {
      endpoint: `${u.origin}/api/${projectId}/envelope/`,
      authHeader: `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=masjidtv-min/1.1.0`
    };
  } catch {
    return null;
  }
}

function firstStackLine(stack: string | undefined): string {
  if (!stack) return '';
  const line = stack.split('\n').find((l) => /^\s*at\s/.test(l));
  return (line || stack.split('\n')[0] || '').trim().slice(0, 300);
}

// Hantar SATU peristiwa ralat ke endpoint envelope. Balutan mutlak:
// sebarang kegagalan rangkaian/parse ditelan (log sahaja) — pelapor ralat
// tidak pernah menjadi punca ralat baharu.
export async function reportError(
  dsn: DsnParts,
  err: FastifyError,
  reqInfo: { method: string; url: string }
): Promise<void> {
  try {
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const event = {
      event_id: eventId,
      timestamp: Math.floor(Date.now() / 1000),
      platform: 'node',
      level: 'error',
      logger: 'masjidtv-cloud',
      server_name: 'vercel-serverless',
      exception: {
        values: [{
          type: err.name || 'Error',
          value: String(err.message || err).slice(0, 500),
          stacktrace: firstStackLine(err.stack)
            ? { frames: [{ filename: firstStackLine(err.stack), function: '?' }] }
            : undefined
        }]
      },
      request: { method: reqInfo.method, url: reqInfo.url.slice(0, 200) },
      tags: { statusCode: String(err.statusCode || 500) }
    };
    // Envelope: header JSON + item header JSON + item payload JSON.
    const envelope = [
      JSON.stringify({ event_id: eventId }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event)
    ].join('\n');
    await fetch(dsn.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': dsn.authHeader
      },
      body: envelope,
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS)
    });
  } catch (postErr) {
    console.error('[reporting] gagal hantar ralat ke DSN (ditelan):',
      postErr instanceof Error ? postErr.message : postErr);
  }
}

// Pasang pelaporan ralat pada app Fastify — hanya jika SENTRY_DSN ditetapkan.
// Menggunakan onError hook (bukan menggantikan setErrorHandler sedia ada)
// supaya gelagat balasan asal kekal 100% sama.
export function initErrorReporting(app: FastifyInstance): void {
  const raw = process.env.SENTRY_DSN || '';
  if (!raw.trim()) {
    console.log('[reporting] SENTRY_DSN tidak ditetapkan — pelaporan ralat dilumpuhkan (no-op).');
    return;
  }
  const dsn = parseDsn(raw.trim());
  if (!dsn) {
    console.error('[reporting] SENTRY_DSN format tidak sah — pelaporan dilumpuhkan.');
    return;
  }
  app.addHook('onError', async (req, _reply, err) => {
    // Hanya ralat 5xx dilaporkan — 4xx ialah kesalahan pelanggan (bising).
    const status = Number(err.statusCode || 500);
    if (status < 500) return;
    // Fire-and-forget: void + balutan dalaman menelan semua kegagalan.
    void reportError(dsn, err, { method: req.method, url: req.url || '' });
  });
  console.log('[reporting] SENTRY_DSN dikesan — ralat 5xx dilaporkan ke endpoint envelope.');
}
