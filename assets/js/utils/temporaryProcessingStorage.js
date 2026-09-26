// utils/temporaryProcessingStorage.js
// Short-lived, in-memory scratch space for intermediate data a
// pipeline needs while it runs (e.g. a decoded pixel buffer shared
// between the embedding engine and the evaluation step) — separate
// from state.js, which holds data the presentation layer displays.
// Nothing here is persisted between page reloads.

const store = new Map();

export function put(key, value) {
  store.set(key, value);
}

export function get(key) {
  return store.get(key);
}

export function has(key) {
  return store.has(key);
}

export function clear() {
  store.clear();
}
