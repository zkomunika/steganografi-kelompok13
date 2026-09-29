// evaluation/histogramCalculator.js
//
// Histogram intensitas per kanal (R, G, B; 256 bin) dan pembandingan dua histogram.
// Fungsi murni: hanya membaca { width, height, data } (ImageData atau objek
// setara), tidak menyentuh DOM, dan tidak memutasi masukan.
//
// Invarian:
//   • Σ bin per kanal = width × height (setiap piksel jatuh tepat ke satu bin).
//   • Dua citra identik → selisih 0 di semua bin.
// Kanal alpha diabaikan (tidak dimodifikasi oleh embedding).

export const CHANNEL_KEYS = ['r', 'g', 'b'];
export const BIN_COUNT = 256;

function assertImage(image, name) {
  if (!image || !image.data || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new Error(`[histogramCalculator] ${name} tidak valid (butuh width, height, data).`);
  }
  if (image.data.length < image.width * image.height * 4) {
    throw new Error(`[histogramCalculator] ${name}: ukuran buffer lebih kecil dari width×height×4.`);
  }
}

/**
 * Hitung histogram R, G, B.
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} image  RGBA
 * @returns {{width:number,height:number,pixelCount:number,r:Uint32Array,g:Uint32Array,b:Uint32Array}}
 */
export function computeHistogram(image) {
  assertImage(image, 'image');
  const { width, height, data } = image;
  const pixelCount = width * height;
  const r = new Uint32Array(BIN_COUNT);
  const g = new Uint32Array(BIN_COUNT);
  const b = new Uint32Array(BIN_COUNT);

  for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
  }
  return { width, height, pixelCount, r, g, b };
}

/** Jumlah seluruh bin satu kanal (harus sama dengan width × height). */
export function histogramTotal(bins) {
  let s = 0;
  for (let i = 0; i < bins.length; i++) s += bins[i];
  return s;
}

/**
 * Bandingkan dua histogram (cover vs stego).
 * diff[i] = stego[i] − cover[i].
 *
 * @returns {{
 *   r: ChannelDiff, g: ChannelDiff, b: ChannelDiff,
 *   totalChangedBins: number, totalBins: number
 * }}
 *   ChannelDiff = { changedBins, maxAbsDiff, totalAbsDiff, diff: Int32Array }
 */
export function compareHistograms(cover, stego) {
  if (cover.pixelCount !== stego.pixelCount ||
      cover.width !== stego.width || cover.height !== stego.height) {
    throw new Error('[histogramCalculator] Dimensi cover dan stego harus sama.');
  }
  const out = { totalChangedBins: 0, totalBins: BIN_COUNT * CHANNEL_KEYS.length };
  for (const ch of CHANNEL_KEYS) {
    const diff = new Int32Array(BIN_COUNT);
    let changedBins = 0, maxAbsDiff = 0, totalAbsDiff = 0;
    for (let i = 0; i < BIN_COUNT; i++) {
      const d = stego[ch][i] - cover[ch][i];
      diff[i] = d;
      const a = Math.abs(d);
      if (a !== 0) changedBins++;
      if (a > maxAbsDiff) maxAbsDiff = a;
      totalAbsDiff += a;
    }
    out[ch] = { changedBins, maxAbsDiff, totalAbsDiff, diff };
    out.totalChangedBins += changedBins;
  }
  return out;
}
