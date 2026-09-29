// core/lsbPlaneExtractor.js
//
// Bidang LSB (bit-plane 0) per kanal dan gabungan RGB, plus pemetaan kontras
// untuk ditampilkan. Fungsi murni: hanya membaca { width, height, data }.
//
// Pemetaan tampilan: bit 0 → hitam (0), bit 1 → putih (255).
//   • Kanal tunggal ('r' | 'g' | 'b'): abu-abu 0/255.
//   • 'rgb' (gabungan): komponen R,G,B piksel = 255 bila LSB kanal tsb = 1,
//     sehingga tiap piksel salah satu dari 8 warna.
// Peta perbedaan memakai aturan sama: komponen menyala bila bit LSB cover ≠ stego.

const CH_INDEX = { r: 0, g: 1, b: 2 };
export const LSB_CHANNELS = ['r', 'g', 'b', 'rgb'];

function assertImage(image, name) {
  if (!image || !image.data || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new Error(`[lsbPlaneExtractor] ${name} tidak valid.`);
  }
}
function assertPair(a, b) {
  assertImage(a, 'cover'); assertImage(b, 'stego');
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error('[lsbPlaneExtractor] Dimensi cover dan stego harus sama.');
  }
}
function assertChannel(channel) {
  if (!LSB_CHANNELS.includes(channel)) {
    throw new Error(`[lsbPlaneExtractor] Kanal tidak dikenal: ${channel}`);
  }
}

/**
 * Bit LSB mentah.
 * 'r'|'g'|'b' → Uint8Array panjang W×H; 'rgb' → panjang W×H×3 (urutan R,G,B per piksel).
 */
export function extractLsbPlane(image, channel) {
  assertImage(image, 'image'); assertChannel(channel);
  const n = image.width * image.height;
  const d = image.data;
  if (channel === 'rgb') {
    const bits = new Uint8Array(n * 3);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      bits[p * 3]     = d[i] & 1;
      bits[p * 3 + 1] = d[i + 1] & 1;
      bits[p * 3 + 2] = d[i + 2] & 1;
    }
    return bits;
  }
  const off = CH_INDEX[channel];
  const bits = new Uint8Array(n);
  for (let p = 0; p < n; p++) bits[p] = d[p * 4 + off] & 1;
  return bits;
}

/**
 * Bidang LSB sebagai citra RGBA siap gambar (0 → hitam, 1 → putih).
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function lsbPlaneToImage(image, channel) {
  assertImage(image, 'image'); assertChannel(channel);
  const n = image.width * image.height;
  const d = image.data;
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const o = p * 4, s = p * 4;
    if (channel === 'rgb') {
      out[o]     = (d[s]     & 1) * 255;
      out[o + 1] = (d[s + 1] & 1) * 255;
      out[o + 2] = (d[s + 2] & 1) * 255;
    } else {
      const v = (d[s + CH_INDEX[channel]] & 1) * 255;
      out[o] = out[o + 1] = out[o + 2] = v;
    }
    out[o + 3] = 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/**
 * Peta bit LSB yang berubah (hitam = sama, terang = berubah).
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function lsbDiffToImage(cover, stego, channel) {
  assertPair(cover, stego); assertChannel(channel);
  const n = cover.width * cover.height;
  const a = cover.data, b = stego.data;
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const s = p * 4;
    if (channel === 'rgb') {
      out[s]     = ((a[s]     ^ b[s])     & 1) * 255;
      out[s + 1] = ((a[s + 1] ^ b[s + 1]) & 1) * 255;
      out[s + 2] = ((a[s + 2] ^ b[s + 2]) & 1) * 255;
    } else {
      const off = CH_INDEX[channel];
      const v = ((a[s + off] ^ b[s + off]) & 1) * 255;
      out[s] = out[s + 1] = out[s + 2] = v;
    }
    out[s + 3] = 255;
  }
  return { width: cover.width, height: cover.height, data: out };
}

/**
 * Hitung LSB yang berubah.
 *   perChannel.{r,g,b} = { changed, total: W×H, pct }
 *   selected           = ringkasan untuk kanal terpilih
 *                        ('rgb' → total = W×H×3)
 *   grid               = sebaran perubahan pada blok gridSize×gridSize
 *                        (counts[row*gridSize+col]; nonEmptyCells)
 *
 * Sebaran dihitung untuk kanal terpilih (untuk 'rgb': piksel dengan ≥1 kanal berubah).
 */
export function compareLsbPlanes(cover, stego, channel, gridSize = 4) {
  assertPair(cover, stego); assertChannel(channel);
  const { width, height } = cover;
  const n = width * height;
  const a = cover.data, b = stego.data;

  const changed = { r: 0, g: 0, b: 0 };
  const counts = new Uint32Array(gridSize * gridSize);

  for (let y = 0; y < height; y++) {
    const gy = Math.min(gridSize - 1, Math.floor((y * gridSize) / height));
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const dr = (a[s] ^ b[s]) & 1;
      const dg = (a[s + 1] ^ b[s + 1]) & 1;
      const db = (a[s + 2] ^ b[s + 2]) & 1;
      changed.r += dr; changed.g += dg; changed.b += db;

      const hit = channel === 'r' ? dr : channel === 'g' ? dg : channel === 'b' ? db : (dr | dg | db);
      if (hit) {
        const gx = Math.min(gridSize - 1, Math.floor((x * gridSize) / width));
        counts[gy * gridSize + gx]++;
      }
    }
  }

  const perChannel = {};
  for (const ch of ['r', 'g', 'b']) {
    perChannel[ch] = { changed: changed[ch], total: n, pct: n ? (changed[ch] / n) * 100 : 0 };
  }
  const selChanged = channel === 'rgb' ? changed.r + changed.g + changed.b : changed[channel];
  const selTotal   = channel === 'rgb' ? n * 3 : n;

  let nonEmptyCells = 0;
  for (const c of counts) if (c > 0) nonEmptyCells++;

  return {
    perChannel,
    selected: { changed: selChanged, total: selTotal, pct: selTotal ? (selChanged / selTotal) * 100 : 0 },
    grid: { size: gridSize, counts, nonEmptyCells, totalCells: gridSize * gridSize },
  };
}
