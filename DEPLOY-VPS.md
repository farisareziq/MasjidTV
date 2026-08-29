# MasjidTV — VPS Deployment Guide

Migrate the cloud app from Vercel (serverless + Blob + Turso) to a self-hosted
VPS (long-running Node + local filesystem + Turso or local SQLite).

## What changed

| Aspect | Vercel | VPS |
|---|---|---|
| Entry point | `api/index.ts` (serverless handler) | `src/server.ts` (standalone) |
| Static assets | Vercel CDN (`.vercel/output/static/`) | Fastify serves from `dist/public/` |
| File uploads | Vercel Blob (`@vercel/blob`) | Local filesystem (`MASJIDTV_UPLOADS_DIR`) |
| SSE (instant sync) | Degraded (serverless limits) | Full (long-running process) |
| Body limit | 1MB (serverless) | 50MB (configurable) |
| Build | `vercel-build` (Build Output API) | `build:vps` (tsc + copy assets) |
| Database | Turso (libsql://) | Turso OR local SQLite (`file:`) |

## Files added / modified

**New files:**
- `packages/cloud/src/storage.ts` — storage abstraction (Blob or local fs)
- `packages/cloud/src/server.ts` — standalone VPS server entry point
- `packages/cloud/scripts/build-vps.mjs` — VPS build script
- `packages/cloud/.env.vps.example` — environment template
- `deploy/nginx.conf` — nginx reverse proxy config
- `deploy/masjidtv.service` — systemd service file

**Modified files:**
- `packages/cloud/src/app.ts` — static file serving, uploads route, configurable bodyLimit
- `packages/cloud/src/routes/admin.ts` — storage adapter replaces `@vercel/blob`
- `packages/cloud/package.json` — added `start`, `build:vps`, fixed `dev` script

## Prerequisites

- Node.js >= 20
- pnpm >= 11 (or let `corepack` handle it)
- nginx (or any reverse proxy) for TLS termination
- (Optional) Turso account — or use local SQLite (zero cost)

## Step 1: Install & build

```bash
# From repo root
pnpm install
pnpm --filter @masjidtv/cloud run build:vps
```

This produces `packages/cloud/dist/`:
- `server.js` — entry point
- `app.js` + routes — compiled app
- `public/` — static assets (CSS/JS/images/vendor/manifest)

## Step 2: Configure environment

```bash
cd packages/cloud
cp .env.vps.example .env
# Edit .env — set JWT_SECRET, TURSO_URL, LICENSE_PUBLIC_KEY, MASJIDTV_UPLOADS_DIR
```

### Database options

**Option A — Turso (cloud DB, same as Vercel):**
```
TURSO_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=eyJ...
```

**Option B — Local SQLite (no external dependency):**
```
TURSO_URL=file:./cloud-data/masjidtv.db
TURSO_AUTH_TOKEN=
```

Local SQLite is zero-cost and works well for a single VPS. Back up the
`cloud-data/` directory regularly.

### File uploads

```
MASJIDTV_UPLOADS_DIR=/var/masjidtv/uploads
```

Uploaded media (images, videos, audio) are stored as files on the VPS and
served via the `/uploads/*` route. No Vercel Blob needed.

## Step 3: Run

```bash
# Direct (from packages/cloud)
node dist/server.js

# Or from repo root
pnpm --filter @masjidtv/cloud start
```

The server listens on `0.0.0.0:3000` by default. Override with `PORT` and
`HOST` env vars.

## Step 4: systemd service (auto-start + restart)

```bash
sudo cp deploy/masjidtv.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now masjidtv
```

Edit the `.service` file to match your paths (User, WorkingDirectory, etc.).

## Step 5: nginx reverse proxy + TLS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/masjidtv
sudo ln -s /etc/nginx/sites-available/masjidtv /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS via Let's Encrypt
sudo certbot --nginx -d masjidtv.example.com
```

## Verification

```bash
# Health check
curl http://localhost:3000/api/health

# Admin page
curl -I http://localhost:3000/admin

# Static asset
curl -I http://localhost:3000/css/display.css

# Uploaded file
curl -I http://localhost:3000/uploads/media/abc/test.mp4
```

## Notes

- **SSE works fully on VPS** — instant (<2s) admin-to-display sync. Leave
  `MASJIDTV_DISABLE_SSE` unset. The 30s poll fallback remains as backup.
- **Large uploads** — body limit defaults to 50MB. Override with
  `MASJIDTV_BODY_LIMIT` (bytes).
- **Backwards compatible** — the Vercel build (`vercel-build`) is untouched.
  Deploying to Vercel still works exactly as before.
- **Superuser PIN** — on first start, a random PIN is generated and written to
  the OS temp dir (or `MASJIDTV_SUPERUSER_PIN_FILE`). Change it immediately
  via `POST /api/auth/superuser/pin` or `https://<host>/super`.
- **Preflight** — run `node scripts/preflight.mjs --url https://<host>` to
  verify env, JWT strength, license key, health, security headers, auth.
