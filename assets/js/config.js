// config.js
// Static, environment-level configuration values.
// Nothing here depends on runtime state — see state.js for that.
// No default stego-key or sample messages are provided here.

export const CONFIG = {
  appName:  'LSB Steganography',
  version:  'v0.2',

  supportedImageFormats: ['image/png', 'image/bmp', 'image/x-bmp', 'image/x-ms-bmp'],
  supportedExtensions:   ['png', 'bmp'],

  jpegTest: {
    minQuality:     10,
    maxQuality:     100,
    defaultQuality: 70,
  },

  // Capacity bar colours (percentage thresholds)
  capacityThresholds: {
    warn:  75,   // turn amber at 75 %
    danger: 90,  // turn red at 90 %
  },
};
