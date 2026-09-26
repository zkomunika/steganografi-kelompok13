// core/imageHandler.js
// Responsible for decoding an image file into a raw pixel buffer and
// re-encoding a pixel buffer back into an image file (PNG/BMP).
//
// NOT IMPLEMENTED YET — this checkpoint only wires the architecture.
// Expected shape once implemented:
//   decodeImage(imageMeta) -> { width, height, pixels: Uint8ClampedArray }
//   encodeImage(pixelBuffer, format) -> Blob | dataUrl

export function decodeImage(_imageMeta) {
  console.warn('[core/imageHandler] decodeImage() is not implemented yet');
  return null;
}

export function encodeImage(_pixelBuffer, _format = 'png') {
  console.warn('[core/imageHandler] encodeImage() is not implemented yet');
  return null;
}
