// core/imageHandler.js
// Responsible for decoding an ImageMetadata object into a raw pixel buffer
// and re-encoding a pixel buffer back into an image.
//
// This module does NOT do file I/O — that responsibility belongs to
// services/fileService.js.  By the time data arrives here, the image has
// already been validated and decoded into an ImageData (RGBA Uint8ClampedArray).
//
// Functions:
//   decodeImage(imageMeta)            → DecodedImage  (working pixel buffer)
//   encodeImageToPng(decodedImage)    → Promise<string>  (PNG data URL)
//   getCapacityInfo(decodedImage, messageBits) → CapacityInfo

// ---------------------------------------------------------------------------
// decodeImage
// ---------------------------------------------------------------------------
/**
 * Extract a pixel-manipulation-ready buffer from an ImageMetadata object.
 * This is a thin adapter: fileService already decoded the pixels into
 * imageData — we just expose a clean interface to the rest of the pipeline.
 *
 * @param {ImageMetadata} imageMeta  – must have { imageData, width, height, channels }
 * @returns {DecodedImage}
 *   {
 *     width    : number,
 *     height   : number,
 *     channels : 3,                      – RGB (alpha is left unchanged)
 *     data     : Uint8ClampedArray,      – RGBA pixel buffer (from ImageData)
 *     imageData: ImageData               – original ImageData reference
 *   }
 */
export function decodeImage(imageMeta) {
  if (!imageMeta || !imageMeta.imageData) {
    throw new Error('[imageHandler] imageMeta tidak valid atau imageData belum tersedia.');
  }

  const { imageData, width, height } = imageMeta;

  if (imageData.width !== width || imageData.height !== height) {
    throw new Error('[imageHandler] Dimensi imageData tidak sesuai dengan metadata.');
  }

  return {
    width,
    height,
    channels: 3,       // RGB — alpha (index %4 === 3) is never modified
    data: imageData.data,
    imageData,
  };
}

// ---------------------------------------------------------------------------
// encodeImageToPng
// ---------------------------------------------------------------------------
/**
 * Encode a DecodedImage (or a raw Uint8ClampedArray + dimensions) back to a
 * PNG data URL using an off-screen canvas.
 *
 * @param {{ width: number, height: number, data: Uint8ClampedArray }|ImageData} source
 * @returns {Promise<string>}  PNG data URL  ("data:image/png;base64,…")
 */
export function encodeImageToPng(source) {
  return new Promise((resolve, reject) => {
    try {
      const { width, height } = source;
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');

      // Accept both raw Uint8ClampedArray and ImageData
      const imageData = source instanceof ImageData
        ? source
        : new ImageData(
            source.data instanceof Uint8ClampedArray
              ? source.data
              : new Uint8ClampedArray(source.data),
            width,
            height
          );

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    } catch (err) {
      reject(new Error(`[imageHandler] encodeImageToPng gagal: ${err.message}`));
    }
  });
}

// ---------------------------------------------------------------------------
// getCapacityInfo
// ---------------------------------------------------------------------------
/**
 * Calculate embedding capacity given an image and the current message bits.
 *
 * Capacity formula:
 *   totalBits = width × height × 3
 *   (1 bit per LSB, 3 RGB channels, alpha untouched)
 *
 * @param {DecodedImage|null}  decodedImage
 * @param {number[]|null}      messageBits   – current bit array (may be empty)
 * @returns {CapacityInfo}
 *   {
 *     totalBits  : number,
 *     usedBits   : number,
 *     pct        : number,   – 0–100, clamped
 *     valid      : boolean,
 *   }
 */
export function getCapacityInfo(decodedImage, messageBits) {
  const totalBits = decodedImage
    ? decodedImage.width * decodedImage.height * 3
    : 0;

  const usedBits = Array.isArray(messageBits) ? messageBits.length : 0;

  const pct = totalBits > 0
    ? Math.min(100, Math.round((usedBits / totalBits) * 100))
    : 0;

  return {
    totalBits,
    usedBits,
    pct,
    valid: totalBits > 0 && usedBits > 0 && usedBits <= totalBits,
  };
}
