// Aset awam maya untuk binari SEA — singleton dibaca sekali dari blob
// 'frontend.zip' (lihat build-exe.mjs). CommonJS supaya boleh di-require
// dari bundle CJS tanpa resolusi ESM.

let cached = null;

function getPublicAssets() {
  if (cached !== null) return cached;
  try {
    const { getAsset } = require('node:sea');
    // getAsset() pulangkan ArrayBuffer dalam Node 24 — bungkus sebagai
    // Buffer supaya parser zip (readUInt32LE dsb.) berfungsi.
    const raw = getAsset('frontend.zip');
    const zipBuf = Buffer.from(raw);
    const { readZip } = require('./asset-zip.cjs');
    cached = readZip(zipBuf);
  } catch {
    cached = null; // bukan runtime SEA
  }
  return cached;
}

module.exports = { getPublicAssets };
