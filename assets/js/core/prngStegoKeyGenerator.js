// core/prngStegoKeyGenerator.js
// Turns a Stego-Key string into a seeded, deterministic Pseudo-Random
// Number Generator that pixelPositionSelector.js can draw positions
// from. Same key must always reproduce the same sequence.
//
// NOT IMPLEMENTED YET.
//   createPRNGFromKey(stegoKey) -> () => number   (a "next()" function)

export function createPRNGFromKey(_stegoKey) {
  console.warn('[core/prngStegoKeyGenerator] createPRNGFromKey() is not implemented yet');
  return null;
}
