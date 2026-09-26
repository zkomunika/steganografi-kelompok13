// state.js
// Single source of truth for data shared between controllers and the
// presentation layer. Controllers read/write state here instead of
// controllers reaching into each other, and instead of core/evaluation
// modules touching the DOM directly.
//
// This checkpoint pre-fills state with the same demo values already
// present in the prototype markup, so the UI keeps rendering exactly
// as before while the real computation is still a stub (see
// assets/js/core and assets/js/evaluation).

import { CONFIG } from './config.js';
import { PAGES } from './constants.js';

const state = {
  navigation: {
    currentPage: PAGES.DASHBOARD,
  },

  embedding: {
    coverImage: null, // { name, size, width, height, dataUrl } once a real file is picked
    secretMessage: 'Ujian tengah semester dimulai tanggal 14 Oktober.',
    stegoKey: CONFIG.defaultStegoKey,
    stegoImage: null, // result of the embedding pipeline
    evaluation: null, // { mse, psnr, fileSizeDeltaKb }
  },

  extraction: {
    stegoImage: null,
    stegoKey: CONFIG.defaultStegoKey,
    extractedMessage: null,
    status: null, // STATUS.OK | STATUS.FAIL
  },

  analysis: {
    coverImage: null,
    stegoImage: null,
    metrics: null, // { mse, psnr, fileSizeDeltaKb }
  },

  jpegTest: {
    stegoImage: null,
    stegoKey: CONFIG.defaultStegoKey,
    qualityFactor: CONFIG.jpegTest.defaultQuality,
    result: null, // { jpegImage, extractedMessage, bitAccuracyBefore, bitAccuracyAfter }
    history: [], // rows for the "Berbagai Quality Factor" table
  },
};

const listeners = new Set();

/** Read-only access to the whole state tree. */
export function getState() {
  return state;
}

/**
 * Set a value by dotted path (e.g. "embedding.stegoKey") and notify
 * subscribers. Kept intentionally simple — no reducers/actions layer,
 * this is a static-site foundation, not a framework.
 */
export function setState(path, value) {
  const keys = path.split('.');
  let obj = state;
  while (keys.length > 1) {
    const key = keys.shift();
    obj = obj[key];
  }
  obj[keys[0]] = value;
  listeners.forEach((fn) => fn(state, path));
}

/** Subscribe to any state change. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
