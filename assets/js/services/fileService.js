// services/fileService.js
// Responsible for: (1) opening the OS file picker, (2) validating the
// selected file (PNG/BMP only), and (3) reading the file into a DataURL
// plus decoded ImageData via an off-screen <canvas>.
//
// BMP note: most browsers can display BMP via <img>, so we rely on the
// browser's native decoder (drawImage → getImageData). If the browser
// cannot decode the BMP (img.onerror fires) we fall back to a minimal
// client-side BMP decoder that handles the most common uncompressed
// 24-bit and 32-bit variants. No fake/dummy data is ever returned.

import { CONFIG } from '../config.js';

// ---------------------------------------------------------------------------
// pickImageFile
// ---------------------------------------------------------------------------
/**
 * Opens the system file picker, restricted to PNG and BMP.
 * Resolves with the raw File object; rejects if the user cancels.
 */
export function pickImageFile({ accept = 'image/png,image/bmp,.png,.bmp' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;

    // 'change' fires only when a file is actually chosen
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        reject(new Error('Tidak ada file yang dipilih.'));
        return;
      }
      resolve(file);
    }, { once: true });

    // If the user closes the picker without choosing, no event fires —
    // we detect this by listening to window focus returning after click.
    const onFocus = () => {
      // Give the change event a chance to fire first
      setTimeout(() => {
        if (!input.files || input.files.length === 0) {
          reject(new Error('File picker dibatalkan.'));
        }
        window.removeEventListener('focus', onFocus);
      }, 400);
    };
    window.addEventListener('focus', onFocus);

    input.click();
  });
}

// ---------------------------------------------------------------------------
// validateImageFile
// ---------------------------------------------------------------------------
/**
 * Validates that the file is a supported image format.
 * Checks both MIME type and file extension.
 *
 * @param {File} file
 * @throws {Error} with a user-readable message if validation fails
 */
export function validateImageFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const supportedMime = ['image/png', 'image/bmp', 'image/x-bmp', 'image/x-ms-bmp'];
  const supportedExt  = ['png', 'bmp'];

  const mimeOk = supportedMime.includes(file.type);
  const extOk  = supportedExt.includes(ext);

  if (!mimeOk && !extOk) {
    throw new Error(
      `Format file tidak didukung: "${file.name}". ` +
      `Hanya file PNG dan BMP yang diizinkan.`
    );
  }
}

// ---------------------------------------------------------------------------
// readImageFile  (main export used by controllers)
// ---------------------------------------------------------------------------
/**
 * Full pipeline: validate → read bytes → decode pixels → return metadata.
 *
 * Returns an ImageMetadata object:
 *   { name, size, width, height, format, channels, dataUrl, imageData }
 *
 * `imageData` is a standard ImageData (RGBA Uint8ClampedArray) decoded
 * via an off-screen canvas — suitable for direct pixel manipulation.
 *
 * @param {File} file
 * @returns {Promise<ImageMetadata>}
 */
export async function readImageFile(file) {
  // 1. Format guard
  validateImageFile(file);

  // 2. Read raw bytes → DataURL
  const dataUrl = await _readAsDataURL(file);

  // 3. Detect format
  const ext    = file.name.split('.').pop().toLowerCase();
  const format = ext === 'bmp' ? 'bmp' : 'png';

  // 4. Decode pixels via canvas (with BMP fallback)
  const imageData = await _decodeToImageData(dataUrl, file);

  // 5. Assemble metadata
  const metadata = {
    name:      file.name,
    size:      file.size,
    width:     imageData.width,
    height:    imageData.height,
    format,
    channels:  3,         // RGB only; alpha is not used for embedding
    dataUrl,
    imageData,
  };

  return metadata;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Wrap FileReader in a Promise. */
function _readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Gagal membaca file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Decode a DataURL image into an ImageData using an off-screen canvas.
 * If the browser cannot decode the DataURL (e.g. some BMP sub-types),
 * falls back to the pure-JS BMP decoder.
 *
 * @param {string} dataUrl
 * @param {File}   file      – kept for fallback (raw ArrayBuffer read)
 * @returns {Promise<ImageData>}
 */
async function _decodeToImageData(dataUrl, file) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      if (img.width === 0 || img.height === 0) {
        reject(new Error('Image berukuran 0 pixel — file mungkin rusak atau tidak valid.'));
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      try {
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        resolve(imageData);
      } catch (e) {
        reject(new Error('Gagal membaca pixel image (CORS atau format tidak didukung).'));
      }
    };

    img.onerror = async () => {
      // Browser could not decode the image natively — try BMP fallback
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'bmp') {
        try {
          const imageData = await _decodeBmpFromFile(file);
          resolve(imageData);
        } catch (bmpErr) {
          reject(new Error(`BMP tidak dapat di-decode: ${bmpErr.message}`));
        }
      } else {
        reject(new Error('File image tidak dapat dibaca oleh browser. Pastikan file tidak rusak.'));
      }
    };

    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// Client-side BMP decoder
// Supports: Windows DIB (BITMAPINFOHEADER), 24-bit and 32-bit uncompressed.
// Reference: https://en.wikipedia.org/wiki/BMP_file_format
// ---------------------------------------------------------------------------

/**
 * Decode a BMP file into an ImageData.
 * @param {File} file
 * @returns {Promise<ImageData>}
 */
async function _decodeBmpFromFile(file) {
  const buffer = await _readAsArrayBuffer(file);
  return _parseBmp(buffer);
}

function _readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Gagal membaca byte file: ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Parse a BMP ArrayBuffer and return an ImageData.
 * Throws with a descriptive message for unsupported BMP types.
 */
function _parseBmp(buffer) {
  const view = new DataView(buffer);

  // ── File header (14 bytes) ──────────────────────────────────────────────
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1));
  if (magic !== 'BM') {
    throw new Error('Bukan file BMP yang valid (magic bytes tidak cocok).');
  }

  const pixelOffset  = view.getUint32(10, true);

  // ── DIB header ────────────────────────────────────────────────────────
  const dibSize      = view.getUint32(14, true);
  if (dibSize < 40) {
    throw new Error(`BMP dengan DIB header ${dibSize} byte tidak didukung (dibutuhkan BITMAPINFOHEADER ≥ 40).`);
  }

  const width        = view.getInt32(18, true);
  const heightRaw    = view.getInt32(22, true);
  const height       = Math.abs(heightRaw);
  const bottomUp     = heightRaw > 0;        // positive = bottom-to-top scan
  const bpp          = view.getUint16(28, true);
  const compression  = view.getUint32(30, true);

  if (compression !== 0 && compression !== 3) {
    throw new Error(`BMP dengan kompresi tipe ${compression} tidak didukung. Gunakan BMP uncompressed (tipe 0).`);
  }
  if (bpp !== 24 && bpp !== 32) {
    throw new Error(`BMP ${bpp}-bit tidak didukung. Gunakan 24-bit atau 32-bit BMP.`);
  }

  // ── Pixel data ────────────────────────────────────────────────────────
  const bytesPerPixel = bpp / 8;
  const rowBytes      = Math.floor((bpp * width + 31) / 32) * 4; // padded to 4-byte boundary

  const out = new Uint8ClampedArray(width * height * 4);

  for (let row = 0; row < height; row++) {
    // BMP rows are stored bottom-to-top (unless top-down DIB)
    const srcRow   = bottomUp ? (height - 1 - row) : row;
    const rowStart = pixelOffset + srcRow * rowBytes;

    for (let col = 0; col < width; col++) {
      const srcIdx = rowStart + col * bytesPerPixel;
      const dstIdx = (row * width + col) * 4;

      // BMP stores BGR(A)
      out[dstIdx]     = view.getUint8(srcIdx + 2); // R
      out[dstIdx + 1] = view.getUint8(srcIdx + 1); // G
      out[dstIdx + 2] = view.getUint8(srcIdx + 0); // B
      out[dstIdx + 3] = (bpp === 32)
        ? view.getUint8(srcIdx + 3)                // A from file
        : 255;                                      // opaque
    }
  }

  return new ImageData(out, width, height);
}
