// test/jpegCompressionTest.test.js — jalankan dengan: npm test  (node --test)
//
// Menguji logika metrik uji JPEG (evaluation/jpegCompressionTest.js) di Node.
// Kompresi JPEG sungguhan memakai canvas browser dan TIDAK diuji di sini:
// "citra JPEG" disimulasikan dengan mengubah bit LSB pada salinan stego.
// Perilaku compressToJPEG dan UI tetap harus dicek manual di browser.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readStegoHeader, prepareJpegReference, evaluateJpegImage, calcBitAccuracy, STATUS_NA,
} from '../assets/js/evaluation/jpegCompressionTest.js';
import { encryptMessage } from '../assets/js/core/cryptoService.js';
import { bytesToBits } from '../assets/js/core/messageBitConverter.js';
import { generateSlotSequence, slotToCoords } from '../assets/js/core/pixelPositionSelector.js';
import { embedBits } from '../assets/js/core/lsbEmbeddingEngine.js';

globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};

const STEGO_KEY = 'kunci-posisi-uji';
const ENC_KEY   = 'kunci-enkripsi-uji';
const MESSAGE   = 'Pesan rahasia untuk uji JPEG 64x64.';

// Cover acak deterministik (LCG) — alpha 255.
function makeCover(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = 12345;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    data[i] = i % 4 === 3 ? 255 : (s >>> 16) & 0xff;
  }
  return new ImageData(data, w, h);
}

async function makeStego(w = 64, h = 64) {
  const payload = await encryptMessage(MESSAGE, ENC_KEY);
  const bits    = bytesToBits(payload);
  const slots   = generateSlotSequence(STEGO_KEY, w * h * 3, bits.length);
  return { stego: embedBits(makeCover(w, h), bits, slots), slots, bitLen: bits.length };
}

const clone = (img) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);

function flipSlot(img, slot) {
  const { byteOffset } = slotToCoords(slot);
  img.data[byteOffset] ^= 1;
}

test('stego 64×64 valid: header dibaca dari citra yang diunggah, tanpa error kapasitas', async () => {
  const { stego, bitLen } = await makeStego();
  const header = readStegoHeader(stego, STEGO_KEY);
  assert.equal(header.valid, true);
  assert.equal(header.payloadBitLen, bitLen);

  const ref = await prepareJpegReference({ stegoImageData: stego, stegoKey: STEGO_KEY, encKey: '' });
  assert.equal(ref.headerValid, true);
  assert.equal(ref.payloadBitLen, bitLen);
  assert.equal(ref.bitAccBefore, 100);
});

test('JPEG tanpa kerusakan + Kunci Enkripsi benar: akurasi 100%, status ok, pesan kembali', async () => {
  const { stego } = await makeStego();
  const ref = await prepareJpegReference({ stegoImageData: stego, stegoKey: STEGO_KEY, encKey: ENC_KEY });
  const r = await evaluateJpegImage(ref, clone(stego), ENC_KEY);
  assert.equal(r.status, 'ok');
  assert.equal(r.bitAccAfter, 100);
  assert.equal(r.extractedMessage, MESSAGE);
});

test('1 bit payload rusak: status gagal (tag GCM tidak lolos), akurasi < 100', async () => {
  const { stego, slots } = await makeStego();
  const ref = await prepareJpegReference({ stegoImageData: stego, stegoKey: STEGO_KEY, encKey: ENC_KEY });
  const damaged = clone(stego);
  flipSlot(damaged, slots[200]);                 // slot payload (setelah 32 bit header)
  const r = await evaluateJpegImage(ref, damaged, ENC_KEY);
  assert.equal(r.status, 'fail');
  assert.equal(r.extractedMessage, null);
  assert.ok(r.bitAccAfter < 100 && r.bitAccAfter > 99);
  assert.equal(r.accMeaningful, true);
});

test('1 bit header rusak: status gagal seperti halaman Extraction', async () => {
  const { stego, slots } = await makeStego();
  const ref = await prepareJpegReference({ stegoImageData: stego, stegoKey: STEGO_KEY, encKey: ENC_KEY });
  const damaged = clone(stego);
  flipSlot(damaged, slots[31]);                  // bit terendah header
  const r = await evaluateJpegImage(ref, damaged, ENC_KEY);
  assert.equal(r.status, 'fail');
});

test('Stego-Key salah: status gagal dan bit accuracy tidak disajikan', async () => {
  const { stego } = await makeStego();
  const ref = await prepareJpegReference({ stegoImageData: stego, stegoKey: 'kunci-salah', encKey: ENC_KEY });
  assert.equal(ref.headerValid, false);
  const r = await evaluateJpegImage(ref, clone(stego), ENC_KEY);
  assert.equal(r.status, 'fail');
  assert.equal(r.accMeaningful, false);
  assert.equal(r.bitAccAfter, null);
  assert.equal(r.bitAccBefore, null);
  assert.match(r.failReason, /Stego-Key/);
});

test('Kunci Enkripsi kosong: status tidak dinilai, bit accuracy tetap ditampilkan', async () => {
  const { stego, slots } = await makeStego();
  const ref = await prepareJpegReference({ stegoImageData: stego, stegoKey: STEGO_KEY, encKey: '' });
  const damaged = clone(stego);
  flipSlot(damaged, slots[100]);
  const r = await evaluateJpegImage(ref, damaged, '');
  assert.equal(r.status, STATUS_NA);
  assert.equal(r.accMeaningful, true);
  assert.ok(r.bitAccAfter < 100);
});

test('Kunci Enkripsi salah: gagal, dengan sebab baseline (bukan JPEG)', async () => {
  const { stego } = await makeStego();
  const ref = await prepareJpegReference({ stegoImageData: stego, stegoKey: STEGO_KEY, encKey: 'bukan-kunci-yang-benar' });
  assert.equal(ref.baselineStatus, 'fail');
  const r = await evaluateJpegImage(ref, clone(stego), 'bukan-kunci-yang-benar');
  assert.equal(r.status, 'fail');
  assert.match(r.failReason, /bukan akibat kompresi JPEG/);
  assert.equal(r.accMeaningful, true);          // Stego-Key benar → akurasi tetap bermakna
});

test('kerusakan berat (≈50% LSB dibalik): akurasi ≈ 50% dan status gagal', async () => {
  const { stego, slots } = await makeStego();
  const ref = await prepareJpegReference({ stegoImageData: stego, stegoKey: STEGO_KEY, encKey: ENC_KEY });
  const noisy = clone(stego);
  for (let i = 0; i < slots.length; i += 2) flipSlot(noisy, slots[i]);
  const r = await evaluateJpegImage(ref, noisy, ENC_KEY);
  assert.equal(r.status, 'fail');
  assert.ok(Math.abs(r.bitAccAfter - 50) < 1);
});

test('panjang payload tidak bergantung pada state: dua stego berukuran beda dibaca masing-masing', async () => {
  const a = await makeStego(64, 64);
  const b = await makeStego(96, 96);
  const ra = await prepareJpegReference({ stegoImageData: a.stego, stegoKey: STEGO_KEY, encKey: '' });
  const rb = await prepareJpegReference({ stegoImageData: b.stego, stegoKey: STEGO_KEY, encKey: '' });
  assert.equal(ra.payloadBitLen, a.bitLen);
  assert.equal(rb.payloadBitLen, b.bitLen);
});

test('calcBitAccuracy: bit pembanding yang kurang dihitung salah', () => {
  assert.equal(calcBitAccuracy([1, 0, 1, 1], [1, 0, 1, 1]), 100);
  assert.equal(calcBitAccuracy([1, 0, 1, 1], [1, 0]), 50);
  assert.equal(calcBitAccuracy([], [1]), 0);
});
