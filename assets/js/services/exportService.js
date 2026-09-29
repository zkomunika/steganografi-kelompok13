// services/exportService.js
//
// Membuat tabel hasil batch dalam format XLSX (SheetJS) dan CSV (cadangan).
//
// SheetJS hanya dipakai untuk menulis berkas; algoritma inti (LSB, PRNG,
// enkripsi, metrik) tetap ditulis sendiri. Skrip SheetJS dimuat lewat <script>
// di index.html sehingga tersedia sebagai `window.XLSX`.
//
// Satu definisi kolom (BATCH_COLUMNS) dipakai oleh tabel di layar, XLSX, dan CSV,
// sehingga ketiganya berisi nilai yang sama persis.
//
// ── Interface ────────────────────────────────────────────────────────────────
//   BATCH_COLUMNS
//   cellValue(column, row)          → number | string   (nilai mentah untuk XLSX/CSV)
//   cellText(column, row)           → string            (teks tampilan untuk UI)
//   isXlsxAvailable()               → boolean
//   buildCsv(rows)                  → string            (BOM + CRLF)
//   exportXlsx(rows, meta?)         → string            (nama file)
//   exportCsv(rows, meta?)          → string            (nama file)

import { BATCH_CONFIG } from '../evaluation/batchRunner.js';
import { CONFIG } from '../config.js';

const D = BATCH_CONFIG.decimals;

const yesNo = (v) => (v ? 'Ya' : 'Tidak');

/**
 * type: 'text' | 'int' | 'float'
 * decimals: jumlah desimal tampilan (dan format angka di Excel) untuk 'float'
 * group: kelompok header pada tabel UI (opsional)
 */
export const BATCH_COLUMNS = Object.freeze([
  { key: 'no',           header: 'No',                 type: 'int',   get: (r) => r.no },
  { key: 'image',        header: 'Citra',              type: 'text',  get: (r) => r.imageName, width: 26 },
  { key: 'dim',          header: 'Dimensi (px)',       type: 'text',  get: (r) => `${r.width}×${r.height}`, width: 13 },
  { key: 'msgLabel',     header: 'Ukuran Pesan',       type: 'text',  get: (r) => r.messageLabel, width: 12 },
  { key: 'msgBytes',     header: 'Pesan (byte)',       type: 'int',   get: (r) => r.messageBytes },
  { key: 'capacity',     header: 'Kapasitas (bit)',    type: 'int',   get: (r) => r.capacityBits },
  { key: 'used',         header: 'Terpakai (bit)',     type: 'int',   get: (r) => r.usedBits },
  { key: 'usagePct',     header: 'Pemakaian (%)',      type: 'float', decimals: D.pct,  get: (r) => r.usagePct },
  { key: 'mse',          header: 'MSE',                type: 'float', decimals: D.mse,  get: (r) => r.mse },
  { key: 'psnr',         header: 'PSNR (dB)',          type: 'float', decimals: D.psnr, get: (r) => r.psnr },
  { key: 'psnrOk',       header: `PSNR ≥ ${CONFIG.psnrThresholdDb} dB`, type: 'text', get: (r) => yesNo(r.psnrOk), width: 12 },
  { key: 'chiCoverR',    header: 'R', group: 'χ² Cover', type: 'float', decimals: D.chi2, get: (r) => r.chiCover && r.chiCover.r, headerFull: 'χ² Cover R' },
  { key: 'chiCoverG',    header: 'G', group: 'χ² Cover', type: 'float', decimals: D.chi2, get: (r) => r.chiCover && r.chiCover.g, headerFull: 'χ² Cover G' },
  { key: 'chiCoverB',    header: 'B', group: 'χ² Cover', type: 'float', decimals: D.chi2, get: (r) => r.chiCover && r.chiCover.b, headerFull: 'χ² Cover B' },
  { key: 'chiStegoR',    header: 'R', group: 'χ² Stego', type: 'float', decimals: D.chi2, get: (r) => r.chiStego && r.chiStego.r, headerFull: 'χ² Stego R' },
  { key: 'chiStegoG',    header: 'G', group: 'χ² Stego', type: 'float', decimals: D.chi2, get: (r) => r.chiStego && r.chiStego.g, headerFull: 'χ² Stego G' },
  { key: 'chiStegoB',    header: 'B', group: 'χ² Stego', type: 'float', decimals: D.chi2, get: (r) => r.chiStego && r.chiStego.b, headerFull: 'χ² Stego B' },
  { key: 'status',       header: 'Status Ekstraksi',   type: 'text',  get: (r) => (r.extractionOk ? 'Berhasil' : 'Gagal'), width: 16 },
  { key: 'detail',       header: 'Keterangan',         type: 'text',  get: (r) => r.detail || '—', width: 40 },
]);

/** Nama kolom untuk XLSX/CSV (satu baris header, kolom χ² diberi nama lengkap). */
function _flatHeader(col) {
  return col.headerFull || col.header;
}

// ---------------------------------------------------------------------------
// Nilai sel
// ---------------------------------------------------------------------------
/** Nilai mentah: angka tetap angka; nilai tak terhingga/kosong menjadi teks. */
export function cellValue(col, row) {
  const v = col.get(row);
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number' && !Number.isFinite(v)) return '∞';
  return v;
}

/** Teks tampilan di UI; angka desimal memakai jumlah desimal yang sama dengan format Excel. */
export function cellText(col, row) {
  const v = cellValue(col, row);
  if (col.type === 'float' && typeof v === 'number') return v.toFixed(col.decimals);
  if (col.type === 'int' && typeof v === 'number') return String(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// Unduh
// ---------------------------------------------------------------------------
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function _stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function _csvField(v) {
  const s = String(v);
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV UTF-8 dengan BOM (agar χ² dan tanda ≥ terbaca di Excel), pemisah koma,
 * desimal titik, akhir baris CRLF.
 */
export function buildCsv(rows) {
  const lines = [BATCH_COLUMNS.map((c) => _csvField(_flatHeader(c))).join(',')];
  for (const row of rows) {
    lines.push(BATCH_COLUMNS.map((c) => _csvField(cellValue(c, row))).join(','));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

export function exportCsv(rows, { date = new Date() } = {}) {
  const filename = `hasil-batch-lsb-${_stamp(date)}.csv`;
  _downloadBlob(new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename);
  return filename;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------
export function isXlsxAvailable() {
  return typeof globalThis.XLSX !== 'undefined' &&
    typeof globalThis.XLSX.utils?.aoa_to_sheet === 'function';
}

/**
 * Tulis XLSX dua lembar: "Hasil Batch" (header + 15 baris) dan "Parameter".
 * @throws {Error} bila SheetJS belum termuat (mis. CDN tidak terjangkau)
 */
export function exportXlsx(rows, { date = new Date() } = {}) {
  if (!isXlsxAvailable()) {
    throw new Error('Pustaka SheetJS belum termuat (periksa koneksi internet). Gunakan ekspor CSV.');
  }
  const XLSX = globalThis.XLSX;

  // ── Lembar 1: hasil ──
  const aoa = [BATCH_COLUMNS.map(_flatHeader)];
  for (const row of rows) aoa.push(BATCH_COLUMNS.map((c) => cellValue(c, row)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!cols'] = BATCH_COLUMNS.map((c) => ({ wch: c.width || Math.max(10, _flatHeader(c).length + 2) }));
  BATCH_COLUMNS.forEach((c, colIdx) => {
    if (c.type !== 'float') return;
    const zeros = c.decimals > 0 ? '.' + '0'.repeat(c.decimals) : '';
    for (let r = 1; r <= rows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: colIdx })];
      if (cell && cell.t === 'n') cell.z = '0' + zeros;
    }
  });

  // ── Lembar 2: parameter (tanpa kunci apa pun) ──
  const messageBytes = new Map();
  rows.forEach((r) => messageBytes.set(r.messageLabel, r.messageBytes));
  const params = [
    ['Parameter', 'Nilai'],
    ['Aplikasi', `${CONFIG.appName} ${CONFIG.version}`],
    ['Jumlah baris', rows.length],
    ['Jumlah citra', new Set(rows.map((r) => r.imageName)).size],
    ['Metode', 'LSB 1-bit, posisi acak (PRNG Xorshift32 dari Stego-Key), pesan dienkripsi AES-256-GCM'],
    ['Format stego', 'PNG (encode lalu decode sebelum ekstraksi)'],
    ['Ambang PSNR (dB)', CONFIG.psnrThresholdDb],
    ['Uji χ²', 'Westfeld–Pfitzmann, pasangan nilai (2k, 2k+1), per kanal'],
    ...[...messageBytes].map(([label, bytes]) => [`Isi pesan ${label} (byte)`, bytes]),
    ['Diekspor pada', date.toISOString()],
  ];
  const wsParam = XLSX.utils.aoa_to_sheet(params);
  wsParam['!cols'] = [{ wch: 28 }, { wch: 80 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hasil Batch');
  XLSX.utils.book_append_sheet(wb, wsParam, 'Parameter');

  const filename = `hasil-batch-lsb-${_stamp(date)}.xlsx`;
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  _downloadBlob(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename
  );
  return filename;
}
