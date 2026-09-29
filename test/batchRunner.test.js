// test/batchRunner.test.js — jalankan dengan: npm test  (node --test)
//
// Menguji logika runner batch di Node. Encode/decode PNG dilakukan sungguhan (zlib +
// CRC), tetapi bukan lewat canvas browser; perilaku canvas tetap harus dicek di browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';

import {
  BATCH_CONFIG, computeMessageSizes, buildTestMessage, runBatch, summarizeBatch,
} from '../assets/js/evaluation/batchRunner.js';
import { BATCH_COLUMNS, buildCsv, cellValue, cellText } from '../assets/js/services/exportService.js';

// ── polyfill ImageData (Node tidak punya) ────────────────────────────────────
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};

// ── PNG RGBA 8-bit, filter 0 (cukup untuk round-trip milik sendiri) ──────────
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;                       // 8 bit, RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function decodePng(buf) {
  let p = 8, width = 0, height = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4, out = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (stride + 1)], 0);
    raw.copy(out, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return new ImageData(out, width, height);
}
const pngRoundTrip = async (img) => decodePng(encodePng(img));

// ── citra sintetis (gradien + derau deterministik) ───────────────────────────
function makeImage(name, width, height, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i]     = (x * 255 / width + (rnd() % 24)) & 255;
    data[i + 1] = (y * 255 / height + (rnd() % 24)) & 255;
    data[i + 2] = ((x + y) * 128 / (width + height) + (rnd() % 24)) & 255;
    data[i + 3] = 255;
  }
  return { name, width, height, imageData: new ImageData(data, width, height) };
}
const images = () => [
  makeImage('foto1.png', 96, 128, 11), makeImage('foto2.png', 128, 96, 22),
  makeImage('foto3.png', 160, 120, 33), makeImage('foto4.png', 200, 150, 44),
  makeImage('foto5.png', 128, 128, 55),
];

// ── tes ──────────────────────────────────────────────────────────────────────
test('computeMessageSizes: total bit ≈ 10/50/90 % kapasitas', () => {
  const total = 96 * 128 * 3;
  for (const s of computeMessageSizes(total)) {
    assert.ok(s.targetBits <= s.ratio * total, `${s.label} melebihi target`);
    assert.ok(s.targetBits > s.ratio * total - 8, `${s.label} terlalu jauh di bawah target`);
  }
});

test('computeMessageSizes: citra terlalu kecil ditolak', () => {
  assert.throws(() => computeMessageSizes(64 * 64 * 3 / 4), /terlalu kecil/);
});

test('buildTestMessage: panjang tepat, ASCII, dan awalan konsisten', () => {
  const a = buildTestMessage(300), b = buildTestMessage(1000);
  assert.equal(new TextEncoder().encode(a).length, 300);
  assert.ok(/^[\x20-\x7e]+$/.test(b));
  assert.ok(b.startsWith(a));
  assert.equal(buildTestMessage(300), a);
});

test('berkas test-data/messages sama dengan buildTestMessage', () => {
  for (const s of computeMessageSizes(512 * 512 * 3)) {
    const f = readFileSync(new URL(`../test-data/messages/pesan-${Math.round(s.ratio * 100)}persen.txt`, import.meta.url), 'utf8');
    assert.equal(f, buildTestMessage(s.messageBytes));
  }
});

test('runBatch: 15 baris, semua ekstraksi berhasil, PSNR ≥ 30, dan hasil berulang', { timeout: 300_000 }, async () => {
  const progress = [];
  const rows1 = await runBatch({ images: images(), roundTripPng: pngRoundTrip, onProgress: (d) => progress.push(d) });
  const rows2 = await runBatch({ images: images(), roundTripPng: pngRoundTrip });

  assert.equal(rows1.length, 15);
  assert.deepEqual(progress, Array.from({ length: 15 }, (_, i) => i + 1));
  const sum = summarizeBatch(rows1);
  assert.ok(sum.allExtracted, JSON.stringify(rows1.filter((r) => !r.extractionOk).map((r) => r.detail)));
  assert.ok(sum.allPsnrOk);

  // Keterulangan: PSNR/MSE/χ² identik pada run kedua.
  assert.deepEqual(rows2, rows1);

  // Citra terkecil terisi ≈ 10/50/90 %; citra lain lebih longgar.
  const small = rows1.filter((r) => r.imageName === 'foto1.png').map((r) => r.usagePct);
  assert.ok(Math.abs(small[0] - 10) < 0.1 && Math.abs(small[1] - 50) < 0.1 && Math.abs(small[2] - 90) < 0.1, small.join());
  const big = rows1.filter((r) => r.imageName === 'foto4.png');
  assert.ok(big.every((r) => r.usagePct < small[big.indexOf(r)]));

  // CSV: header + 15 baris, dan tiap nilai sama dengan nilai sel yang dipakai XLSX.
  const csv = buildCsv(rows1).replace(/^\ufeff/, '').trim().split('\r\n');
  assert.equal(csv.length, 16);
  assert.equal(csv[0].split(',').length, BATCH_COLUMNS.length);
  const mseCol = BATCH_COLUMNS.find((c) => c.key === 'mse');
  assert.equal(cellText(mseCol, rows1[0]), rows1[0].mse.toFixed(BATCH_CONFIG.decimals.mse));
  assert.equal(cellValue(mseCol, rows1[0]), rows1[0].mse);
});

test('runBatch: kegagalan satu skenario tidak menghentikan yang lain', { timeout: 300_000 }, async () => {
  const corrupt = async (img) => {
    const out = decodePng(encodePng(img));
    if (img.width === 96) out.data[0] ^= 1;      // hanya citra foto1 (96×128) yang rusak
    return out;
  };
  const rows = await runBatch({ images: images(), roundTripPng: corrupt });
  const bad = rows.filter((r) => !r.extractionOk);
  assert.equal(rows.length, 15);
  assert.equal(bad.length, 3);
  assert.ok(bad.every((r) => r.imageName === 'foto1.png' && /lossless/.test(r.detail)));
});

test('runBatch: menolak jumlah citra selain 5', async () => {
  await assert.rejects(() => runBatch({ images: images().slice(0, 4), roundTripPng: pngRoundTrip }), /tepat 5/);
});
