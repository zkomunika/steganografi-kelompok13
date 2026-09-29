// scripts/generate-test-messages.mjs
//
// Menulis tiga pesan uji (≈10%, 50%, 90% kapasitas citra terkecil) ke test-data/messages/.
// Isinya dibuat oleh fungsi yang sama dengan runner batch (buildTestMessage), jadi berkas
// ini identik dengan pesan yang dipakai halaman "Pengujian Batch" untuk ukuran citra tersebut.
//
// Pemakaian:
//   node scripts/generate-test-messages.mjs --width 512 --height 512
// Isi --width/--height dengan ukuran citra TERKECIL di antara 5 citra uji.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeMessageSizes, buildTestMessage } from '../assets/js/evaluation/batchRunner.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
}

const width  = arg('width', 512);
const height = arg('height', 512);
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
  console.error('--width dan --height harus bilangan bulat positif.');
  process.exit(1);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-data', 'messages');
mkdirSync(outDir, { recursive: true });

for (const spec of computeMessageSizes(width * height * 3)) {
  const file = join(outDir, `pesan-${Math.round(spec.ratio * 100)}persen.txt`);
  writeFileSync(file, buildTestMessage(spec.messageBytes), 'utf8');
  console.log(`${file}  (${spec.messageBytes} byte, target ${spec.label})`);
}
