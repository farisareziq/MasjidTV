// MasjidTV license generator — portable CLI entry.
// Bundled to a single file by esbuild, then compiled to a standalone .exe
// via Node SEA. Zero runtime deps: only node:crypto / node:fs / readline.
//
// Commands:
//   masjidtv-license.exe keygen                  -> new Ed25519 keypair
//   masjidtv-license.exe issue <tenantId> [pem]  -> print license code
//   masjidtv-license.exe verify <code> [pubKey]  -> offline check
//   (no args) -> interactive menu (loops until 'q')
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const PEM_NAME = 'masjidtv-license-ed25519.pem';

function here() {
  // In a Node SEA executable, import.meta/__dirname point inside the bundle —
  // resolve to the exe's own directory instead (next to masjidtv-license.exe).
  const exeBase = path.basename(process.execPath).toLowerCase();
  const isSea = exeBase.startsWith('node') === false;
  if (isSea) return path.dirname(process.execPath);
  // Bundled as CJS: use the bundler-injected __dirname; plain node fallback.
  return typeof globalThis.__dirname === 'string' ? globalThis.__dirname : process.cwd();
}

function defaultPem() {
  return path.join(here(), PEM_NAME);
}

function keygen(pemPath) {
  if (fs.existsSync(pemPath)) {
    throw new Error(`Refusing to overwrite existing key: ${pemPath}\nDelete it first (or pass another path) if you really want a new keypair.`);
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(pemPath, pem, { mode: 0o600 });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  console.log('Keypair generated (Ed25519).');
  console.log(`Private key saved: ${pemPath}`);
  console.log('  KEEP IT PRIVATE — never commit, never ship with the exe.');
  console.log(`\nLICENSE_PUBLIC_KEY (set this as cloud env / --pem preflight):\n${spki}`);
  return spki;
}

function encodeLicense(tenantId, privateKeyPem) {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, v: 1, k: 'perpetual' }), 'utf8');
  const sig = crypto.sign(null, payload, crypto.createPrivateKey(privateKeyPem));
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
  let pub;
  try {
    pub = crypto.createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return { ok: false, reason: 'invalid-public-key' };
  }
  if (!crypto.verify(null, payload, pub, sig)) return { ok: false, reason: 'signature' };
  return { ok: true, data: JSON.parse(payload.toString('utf8')) };
}

// Also persist each issued license to disk — if the window closes or the
// terminal history is lost, the code is still recoverable.
function issue(tenantId, pemPath) {
  if (!fs.existsSync(pemPath)) {
    throw new Error(`Private key not found: ${pemPath}\nRun keygen first on this (vendor) machine.`);
  }
  const code = encodeLicense(tenantId, fs.readFileSync(pemPath, 'utf8'));
  console.log(`\nLicense for tenant ${tenantId}:\n\n${code}\n`);
  console.log('Activate: POST /api/super/tenants/<id>/license {"code": "..."}');
  try {
    const dir = path.join(here(), 'licenses');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${tenantId.replace(/[^\w.-]+/g, '_')}.txt`);
    fs.writeFileSync(file, `${code}\n`);
    console.log(`Saved to: ${file}`);
  } catch {
    console.log('(could not save license file — copy the code above)');
  }
  return code;
}

const [cmd, a, b] = process.argv.slice(2);

async function cliMode() {
  switch (cmd) {
    case 'keygen':
      keygen(b || defaultPem());
      break;
    case 'issue':
      if (!a) { console.error('Usage: masjidtv-license.exe issue <tenantId> [pem]'); process.exit(1); }
      issue(a, b || defaultPem());
      break;
    case 'verify': {
      if (!a || !b) { console.error('Usage: masjidtv-license.exe verify <code> <publicKeyBase64>'); process.exit(1); }
      console.log(JSON.stringify(verifyLicense(a, b), null, 2));
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      console.log('Usage:\n  masjidtv-license.exe keygen [pem]\n  masjidtv-license.exe issue <tenantId> [pem]\n  masjidtv-license.exe verify <code> <publicKeyBase64>\n  masjidtv-license.exe            (interactive menu)');
      break;
    default:
      return false; // not a CLI command -> interactive
  }
  return true;
}

// Interactive menu: LOOP forever until the user quits. Errors are shown and
// the menu returns — the window never just flashes closed.
// Input handling uses a line QUEUE: rl.question drops lines that arrive while
// no question is pending (piped/pasted multi-line input), which froze the
// second prompt. Queuing 'line' events works for both TTY and pipes.
function interactiveMode() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const queued = [];
    const waiters = [];
    let closed = false;
    rl.on('line', (line) => {
      const t = line.trim();
      if (waiters.length) waiters.shift()(t);
      else queued.push(t);
    });
    rl.on('close', () => {
      closed = true;
      while (waiters.length) waiters.shift()('');
    });
    const question = (prompt) => {
      process.stdout.write(prompt);
      if (queued.length) return Promise.resolve(queued.shift());
      if (closed) return Promise.resolve('');
      return new Promise((res) => waiters.push(res));
    };

    (async () => {
      console.log('MasjidTV License Generator');
      console.log('==========================');
      const pem = defaultPem();
      console.log(`Private key: ${pem} ${fs.existsSync(pem) ? '(found)' : '(NOT FOUND — run keygen)'}`);

      for (;;) {
        console.log('\n  1) keygen — generate keypair (once, vendor machine)');
        console.log('  2) issue  — issue a license for a tenant');
        console.log('  3) verify — check a license code offline');
        console.log('  q) quit');
        const c = await question('\nChoose [1-3/q]: ');
        if (closed) break;
        try {
          if (c === 'q' || c === 'Q' || c === 'exit') break;
          if (c === '1') {
            keygen(pem);
          } else if (c === '2') {
            const tenantId = await question('Tenant ID (paste, then Enter): ');
            if (closed) break;
            if (!tenantId) { console.log('Tenant ID is required — nothing issued.'); continue; }
            let pemPath = pem;
            if (!fs.existsSync(pemPath)) {
              const alt = await question(`Private key not found at default path.\nPEM path [${pem}]: `);
              pemPath = alt || pem;
            }
            issue(tenantId, pemPath);
          } else if (c === '3') {
            const code = await question('License code (TVM-...): ');
            const pub = await question('LICENSE_PUBLIC_KEY (base64): ');
            if (closed) break;
            console.log(JSON.stringify(verifyLicense(code, pub), null, 2));
          } else {
            console.log('Invalid choice — enter 1, 2, 3 or q.');
          }
        } catch (err) {
          console.error(`\nERROR: ${err.message || err}`);
          console.log('(returning to menu)');
        }
      }
      try { rl.close(); } catch { /* already closed */ }
      console.log('Bye.');
      resolve();
    })();
  });
}

async function entry() {
  try {
    const handled = await cliMode();
    if (!handled) await interactiveMode();
    // Keep the window open briefly on Windows double-click so "Bye." /
    // errors are readable even if launched from Explorer. No-op in terminals.
    if (process.platform === 'win32' && !process.stdin.isTTY) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (err) {
    console.error(`\nERROR: ${err.message || err}`);
    process.exitCode = 1;
  }
}

entry();
