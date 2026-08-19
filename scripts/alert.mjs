// Alert kegagalan workflow (PLAN.md C4) — POST ringkas ke Discord ATAU Slack
// incoming-webhook, bergantung secret mana ditetapkan:
//   DISCORD_WEBHOOK_URL  → payload Discord ({content})
//   SLACK_WEBHOOK_URL    → payload Slack ({text})
// Jika kedua-duanya ditetapkan, hantar ke DUA-DUA. Jika tiada satu pun,
// cetak apa yang akan dilakukan (dry-run) dan keluar 0 — skrip ini TIDAK
// PERNAH gagal (workflow mesti kekal hijau walaupun alert rosak).
//
// Penggunaan:
//   node scripts/alert.mjs                          # dry-run / baca env
//   node scripts/alert.mjs --status failure         # paksa status
//   node scripts/alert.mjs --step "Run preflight"   # nama step gagal
//   node scripts/alert.mjs --help
//
// Env GitHub Actions dibaca automatik: GITHUB_WORKFLOW, GITHUB_RUN_ID,
// GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_JOB, GITHUB_REF_NAME.

const args = process.argv.slice(2);

function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`alert.mjs — hantar notifikasi kegagalan workflow ke Discord/Slack webhook.

Penggunaan:
  node scripts/alert.mjs [--status failure] [--step "nama step"] [--message "mesej"]

Env:
  DISCORD_WEBHOOK_URL   URL incoming-webhook Discord (pilihan)
  SLACK_WEBHOOK_URL     URL incoming-webhook Slack (pilihan)

Sekurang-kurangnya satu webhook diperlukan untuk benar-benar menghantar;
tanpa webhook, skrip cetak dry-run dan keluar 0. Sentiasa exit 0.`);
  process.exit(0);
}

const status = argVal('--status') || process.env.ALERT_STATUS || 'failure';
const step = argVal('--step') || process.env.ALERT_STEP || '';
const customMessage = argVal('--message') || '';

const workflow = process.env.GITHUB_WORKFLOW || 'workflow';
const repo = process.env.GITHUB_REPOSITORY || '';
const runId = process.env.GITHUB_RUN_ID || '';
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const branch = process.env.GITHUB_REF_NAME || '';
const runUrl = repo && runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : '(tiada URL larian)';

const lines = [`🚨 MasjidTV ${workflow}: ${status.toUpperCase()}`];
if (repo) lines.push(`Repo: ${repo}${branch ? ` (${branch})` : ''}`);
if (step) lines.push(`Step gagal: ${step}`);
if (customMessage) lines.push(customMessage);
lines.push(`Larian: ${runUrl}`);
const text = lines.join('\n');

const discordUrl = process.env.DISCORD_WEBHOOK_URL || '';
const slackUrl = process.env.SLACK_WEBHOOK_URL || '';

async function post(url, payload, label) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });
    if (res.ok) console.log(`[alert] ${label}: dihantar (HTTP ${res.status}).`);
    else console.error(`[alert] ${label}: HTTP ${res.status} — ${await res.text().catch(() => '')}`.slice(0, 300));
  } catch (err) {
    // Telan SEMUA ralat — alert tidak boleh menggagalkan workflow.
    console.error(`[alert] ${label}: gagal hantar (ditelan):`, err instanceof Error ? err.message : err);
  }
}

if (!discordUrl && !slackUrl) {
  console.log('[alert] Tiada DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL — dry-run sahaja.');
  console.log('[alert] Mesej yang akan dihantar:');
  console.log('---');
  console.log(text);
  console.log('---');
  process.exit(0);
}

if (discordUrl) await post(discordUrl, { content: text }, 'Discord');
if (slackUrl) await post(slackUrl, { text }, 'Slack');

// Sentiasa exit 0 — langkah alert mesti tidak mengubah hasil workflow.
process.exit(0);
