// config.js
// Static, environment-level configuration values.
// Nothing here depends on runtime state — see state.js for that.

export const CONFIG = {
  appName: 'LSB Steganography',
  version: 'v0.1',
  supportedImageFormats: ['image/png', 'image/bmp'],
  defaultStegoKey: 'skripsi-2026-key',
  jpegTest: {
    minQuality: 10,
    maxQuality: 100,
    defaultQuality: 70,
  },
};
