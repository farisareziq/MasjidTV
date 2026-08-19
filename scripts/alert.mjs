// Alert kegagalan workflow (PLAN.md C4) — hantar notifikasi melalui:
//   1. GitHub Issue (lalai — GITHUB_TOKEN disediakan automatik oleh runner;
//      tiada konfigurasi tambahan diperlukan)
//   2. Discord  → DISCORD_WEBHOOK_URL  ({content})
//   3. Slack    → SLACK_WEBHOOK_URL    ({text})
//
// Lapisan 2/3 dihantar hanya jika secret ditetapkan. Jika TIADA satu pun
// saluran berfungsi (termasuk kegagalan rangkaian), skrip cetak dry-run dan
// keluar 0 — langkah alert tidak boleh menggagalkan workflow itu sendiri
// (rahsia gagal ≠ pipeline gagal).
//
// Penggunaan:
//   node scripts/alert.mjs                          # dry-run / baca env
//   node scripts/alert.mjs --status failure         # paksa status
//   node scripts/alert.mjs --step "Run preflight"   # nama step gagal
//   node scripts/alert.mjs --message "mesej"        # mesej tambahan
//   node scripts/alert.mjs --help
//
// Env GitHub Actions dibaca automatik: GITHUB_WORKFLOW, GITHUB_RUN_ID,
// GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_JOB, GITHUB_REF_NAME,
// GITHUB_ACTIONS, GITHUB_API_URL, GITHUB_TOKEN.

const args = process.argv.slice(2);

function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`alert.mjs — hantar notifikasi kegagalan workflow.

Penggunaan:
  node scripts/alert.mjs [--status failure] [--step "nama step"] [--message "mesej"]

Env:
  GITHUB_TOKEN          Fallback GitHub Issue (disediakan oleh runner; perlu
                        permissions: issues: write pada workflow)
  DISCORD_WEBHOOK_URL   URL incoming-webhook Discord (pilihan)
  SLACK_WEBHOOK_URL     URL incoming-webhook Slack (pilihan)

Susunan percubaan saluran: GitHub Issue → Discord → Slack. Sekurang-kurangnya
satu kejayaan = alert berfungsi; tiada kejayaan = dry-run cetak + exit 0.`);
  process.exit(0);
}

const status = argVal('--status') || process.env.ALERT_STATUS || 'failure';
const step = argVal('--step') || process.env.ALERT_STEP || '';
const customMessage = argVal('--message') || '';

const workflow = process.env.GITHUB_WORKFLOW || 'workflow';
const repo = process.env.GITHUB_REPOSITORY || '';
const runId = process.env.GITHUB_RUN_ID || '';
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
const branch = process.env.GITHUB_REF_NAME || '';
const runUrl = repo && runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : '(tiada URL larian)';
const inGithubActions = process.env.GITHUB_ACTIONS === 'true';

const lines = [`🚨 MasjidTV ${workflow}: ${status.toUpperCase()}`];
if (repo) lines.push(`Repo: ${repo}${branch ? ` (${branch})` : ''}`);
if (step) lines.push(`Step gagal: ${step}`);
if (customMessage) lines.push(customMessage);
lines.push(`Larian: ${runUrl}`);
const text = lines.join('\n');

const discordUrl = process.env.DISCORD_WEBHOOK_URL || '';
const slackUrl = process.env.SLACK_WEBHOOK_URL || '';

let delivered = 0; // bilangan saluran yang berjaya menerima alert

// ---------------------------------------------------------------- GitHub Issue
// Lalai tanpa konfigurasi: buka/cipta issue dalam repo itu sendiri. GITHUB_TOKEN
// disediakan oleh runner — hanya perlu permissions: issues: write pada workflow.
async function postGitHubIssue() {
  const token = process.env.GITHUB_TOKEN;
  if (!inGithubActions || !repo || !token) {
    console.log('[alert] GitHub Issue dilangkau — bukan larian runner atau tiada GITHUB_TOKEN.');
    return false;
  }
  const api = `${apiUrl}/repos/${repo}/issues`;
  try {
    // Dedup: cari issue terbuka dengan label `ci-alert` — tambah komen jika ada
    // (elak spam issue baru pada setiap smoke 6 jam yang gagal berulang).
    const dupRes = await fetch(`${api}?state=open&labels=ci-alert&per_page=1`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    });
    if (dupRes.ok) {
      const issues = await dupRes.json();
      const existing = Array.isArray(issues) && issues[0];
      if (existing?.number) {
        const commentRes = await fetch(`${api}/${existing.number}/comments`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
          body: JSON.stringify({ body: `${text}\n\n<!-- ci-alert: ${workflow} run ${runId} -->` }),
          signal: AbortSignal.timeout(10_000)
        });
        if (commentRes.ok) {
          console.log(`[alert] GitHub: komen pada issue #${existing.number} — ${existing.html_url}`);
          return true;
        }
        console.error(`[alert] GitHub: komen gagal HTTP ${commentRes.status} — cuba issue baru.`.slice(0, 300));
      }
    }
    // Tiada issue terbuka (atau komen gagal) — cipta baharu.
    const res = await fetch(api, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      body: JSON.stringify({
        title: `🚨 ${workflow} ${status.toUpperCase()}${branch ? ` (${branch})` : ''}`,
        body: `${text}\n\n<!-- ci-alert: ${workflow} run ${runId} -->`,
        labels: ['ci-alert']
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (res.ok) {
      const issue = await res.json();
      console.log(`[alert] GitHub: issue #${issue.number} dibuka — ${issue.html_url}`);
      return true;
    }
    console.error(`[alert] GitHub: HTTP ${res.status} — ${await res.text().catch(() => '')}`.slice(0, 300));
  } catch (err) {
    // Telan SEMUA ralat — alert tidak boleh menggagalkan workflow.
    console.error('[alert] GitHub: gagal (ditelan):', err instanceof Error ? err.message : err);
  }
  return false;
}

async function postWebhook(url, payload, label) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });
    if (res.ok) {
      console.log(`[alert] ${label}: dihantar (HTTP ${res.status}).`);
      return true;
    }
    console.error(`[alert] ${label}: HTTP ${res.status} — ${await res.text().catch(() => '')}`.slice(0, 300));
  } catch (err) {
    // Telan SEMUA ralat — alert tidak boleh menggagalkan workflow.
    console.error(`[alert] ${label}: gagal hantar (ditelan):`, err instanceof Error ? err.message : err);
  }
  return false;
}

// --- Main dispatch ------------------------------------------------------------
const channels = [];
if (inGithubActions) channels.push(['GitHub Issue', () => postGitHubIssue()]);
if (discordUrl) channels.push(['Discord', () => postWebhook(discordUrl, { content: text }, 'Discord')]);
if (slackUrl) channels.push(['Slack', () => postWebhook(slackUrl, { text }, 'Slack')]);

if (channels.length === 0) {
  console.log('[alert] Tiada saluran (bukan larian CI / tiada webhook) — dry-run sahaja.');
  console.log('[alert] Mesej yang akan dihantar:');
  console.log('---');
  console.log(text);
  console.log('---');
  process.exit(0);
}

for (const [label, send] of channels) {
  console.log(`[alert] Menghantar melalui ${label}...`);
  if (await send()) delivered++;
}

if (delivered > 0) {
  console.log(`[alert] ${delivered} saluran berjaya — alert berfungsi.`);
} else {
  console.log('[alert] SEMUA saluran gagal — workflow tetap tidak terjejas (alert tidak pernah gagal).');
  console.log('[alert] Mesej yang gagal dihantar:');
  console.log('---');
  console.log(text);
  console.log('---');
}
// Sentiasa exit 0 — langkah alert mesti tidak mengubah hasil workflow.
process.exit(0);
