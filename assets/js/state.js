// state.js
// Single source of truth for all data shared between controllers and the
// presentation layer. State lives only in memory — it is cleared on page
// reload. No sensitive data (stego-key, message) is written to any
// persistent storage.

import { PAGES } from './constants.js';

// ---------------------------------------------------------------------------
// Shape definitions (for documentation / IDE hints)
//
// ImageMetadata: {
//   name      : string        – original filename
//   size      : number        – bytes on disk
//   width     : number        – pixels
//   height    : number        – pixels
//   format    : 'png'|'bmp'   – detected format
//   channels  : number        – always 3 (RGB; alpha not used for embedding)
//   dataUrl   : string        – data: URL for <img> preview
//   imageData : ImageData     – decoded pixel buffer (RGBA Uint8ClampedArray)
// }
//
// CapacityInfo: {
//   totalBits    : number   – width × height × 3 (RGB channels × 1 bit each)
//   usedBits     : number   – bits needed to embed current message (incl. 32-bit header
//                             and encryption overhead)
//   pct          : number   – 0–100
//   valid        : boolean  – usedBits <= totalBits
// }
// ---------------------------------------------------------------------------

const _state = {
  navigation: {
    currentPage: PAGES.DASHBOARD,
  },

  // ── Embedding ─────────────────────────────────────────────────────────────
  coverImage:     null,   // ImageMetadata | null
  stegoImage:     null,   // ImageMetadata | null  (output of embedding)

  secretMessage:  '',     // raw text; never pre-filled with demo data
  messageBitCount: 0,     // total bits to embed (header + encrypted payload)

  stegoKey:       '',     // string; held in memory only, never persisted
  encryptionKey:  '',     // string; held in memory only, never persisted

  capacity:       null,   // CapacityInfo | null – recomputed on image/message change

  // ── Extraction ────────────────────────────────────────────────────────────
  extractionImage:  null, // ImageMetadata | null (stego image uploaded for extraction)
  extractionKey:    '',   // separate key field on the extraction page
  extractionEncKey: '',   // Kunci Enkripsi on the extraction page (memory only)
  extractionResult: null, // { message: string, status: 'ok'|'fail' } | null

  // ── Extraction (for JPEG page) ────────────────────────────────────────────
  jpegStegoImage:  null,  // ImageMetadata | null
  jpegKey:         '',    // key on the JPEG test page
  qualityFactor:   70,
  jpegTestResult:  null,  // { jpegDataUrl, extractedMessage, bitAccuracyBefore, bitAccuracyAfter } | null
  jpegTestHistory: [],    // row[]

  // ── Analysis ──────────────────────────────────────────────────────────────
  analysisResult: null,   // { mse, psnr, fileSizeDeltaKb, summary } | null

  // ── Embedding result ──────────────────────────────────────────────────────
  embeddingResult: null,  // { success: bool, stegoImageData: ImageData, ... } | null
};

// ---------------------------------------------------------------------------
// Subscriber registry
// ---------------------------------------------------------------------------
const _listeners = new Set();

/** Read-only access to the whole state tree. */
export function getState() {
  return _state;
}

/**
 * Set a nested value by dotted path (e.g. "stegoKey") and notify
 * all subscribers synchronously.
 *
 * @param {string} path  – dotted key path into _state
 * @param {*}      value – new value
 */
export function setState(path, value) {
  const keys = path.split('.');
  let obj = _state;
  while (keys.length > 1) {
    const k = keys.shift();
    if (!(k in obj)) throw new Error(`[state] Unknown path segment: "${k}"`);
    obj = obj[k];
  }
  obj[keys[0]] = value;
  _listeners.forEach((fn) => fn(_state, path));
}

/**
 * Subscribe to any state change.
 * @param {function} fn  – called with (state, changedPath) on every setState
 * @returns {function}   – call to unsubscribe
 */
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Convenience: update multiple fields atomically (one notify per batch).
 * @param {Object} patch – plain object of { "path": value } entries
 */
export function batchSetState(patch) {
  Object.entries(patch).forEach(([path, value]) => {
    const keys = path.split('.');
    let obj = _state;
    while (keys.length > 1) obj = obj[keys.shift()];
    obj[keys[0]] = value;
  });
  _listeners.forEach((fn) => fn(_state, '_batch'));
}
