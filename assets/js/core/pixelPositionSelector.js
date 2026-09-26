// core/pixelPositionSelector.js
// Uses the PRNG (seeded by the Stego-Key) to generate the pseudo-random,
// non-repeating sequence of pixel positions used for embedding/extraction.
//
// NOT IMPLEMENTED YET.
//   generatePixelPositions(stegoKey, totalPixels, bitCount) -> number[]

import { createPRNGFromKey } from './prngStegoKeyGenerator.js';

export function generatePixelPositions(stegoKey, _totalPixels, _bitCount) {
  console.warn('[core/pixelPositionSelector] generatePixelPositions() is not implemented yet');
  createPRNGFromKey(stegoKey); // wired for future use
  return [];
}
