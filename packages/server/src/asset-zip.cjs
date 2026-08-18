// Pembaca ZIP minimum (STORE + DEFLATE) tanpa dependency — untuk aset
// frontend maya dalam binari SEA. Cukup untuk zip yang dibina oleh
// build-exe.mjs (skrip sendiri menulis entri STORE sahaja, tetapi DEFLATE
// disokong untuk kes zip dikompress semula oleh alat lain).
// CommonJS supaya boleh di-require dari bundle SEA tanpa resolusi ESM.

function readZip(buf) {
  // Cari End of Central Directory (signature 0x06054b50, imbas dari hujung).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP EOCD tidak dijumpai');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('ZIP central directory rosak');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, { method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }

  function readEntry(name) {
    const e = entries.get(name);
    if (!e) return null;
    const lo = e.localOff;
    if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('ZIP local header rosak');
    const lnameLen = buf.readUInt16LE(lo + 26);
    const lextraLen = buf.readUInt16LE(lo + 28);
    const start = lo + 30 + lnameLen + lextraLen;
    const comp = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return Buffer.from(comp); // STORE
    if (e.method === 8) {
      // DEFLATE — zlib.inflateRawSync tersedia dalam node:zlib.
      const zlib = require('node:zlib');
      return zlib.inflateRawSync(comp);
    }
    throw new Error('Kaedah zip tidak disokong: ' + e.method);
  }

  return {
    get: (file) => {
      const norm = String(file || '').replace(/\\/g, '/').replace(/^\//, '');
      return readEntry(norm);
    },
    list: () => [...entries.keys()]
  };
}

module.exports = { readZip };
