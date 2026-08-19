// Halaman HTML & aset statik (pariti dengan reference cloud/app.js).
// Aset terbenam dihantar oleh hook onRequest di app.ts SEBELUM laluan ini —
// di sini hanya halaman HTML & sw.js yang memerlukan suntikan/logik khas.

import type { FastifyInstance } from 'fastify';
import { ASSETS } from '../pages.generated.js';

function htmlPage(name: '/display.html' | '/admin.html'): string {
  return Buffer.from(ASSETS[name], 'base64').toString('utf8');
}

function displayDomainKey(host: string | undefined): string | null {
  try {
    const map = JSON.parse(process.env.DISPLAY_DOMAIN_KEYS || '{}') as Record<string, string>;
    const h = String(host || '');
    return map[h] || map[h.replace(/^www\./, '')] || null;
  } catch {
    return null;
  }
}

export function registerPageRoutes(app: FastifyInstance): void {
  app.get('/', async (req, reply) => {
    const mapped = displayDomainKey(req.hostname);
    if (mapped) return reply.redirect('/display?key=' + encodeURIComponent(mapped), 302);
    reply.redirect('/admin');
  });

  app.get('/display', async (req, reply) => {
    const page = htmlPage('/display.html');
    const q = req.query as { key?: string; token?: string };
    if (!q.key && !q.token) {
      const mapped = displayDomainKey(req.hostname);
      if (mapped) {
        // No redirect: the display service worker swallows navigational
        // redirects. Inject the key via <meta> (CSP-safe); display.js reads
        // it and rewrites the URL via history.replaceState.
        const inject = `<meta name="tvm-key" content="${mapped.replace(/"/g, '&quot;')}">`;
        return reply.type('text/html').send(
          page.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${inject}`)
        );
      }
    }
    reply.type('text/html').send(page);
  });

  app.get('/admin', async (_req, reply) => {
    reply.type('text/html').send(htmlPage('/admin.html'));
  });

  // Convenience alias: the superuser console lives inside /admin (login as
  // user "admin") — the reference has no separate /super page.
  app.get('/super', async (_req, reply) => {
    reply.redirect('/admin');
  });

  app.get('/sw.js', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache, no-store');
    reply.type('application/javascript').send(Buffer.from(ASSETS['/sw.js'], 'base64').toString('utf8'));
  });
}
