/**
 * Compress an ImageData pixel buffer into JPEG and decode it back
 * into ImageData.
 *
 * The JPEG Quality Factor follows the UI convention:
 * 10  = heavy compression
 * 100 = minimal compression
 *
 * @param {ImageData} pixelBuffer - Original image pixel data.
 * @param {number} qualityFactor - JPEG quality factor (10-100).
 * @returns {Promise<{
 *   dataUrl: string,
 *   imageData: ImageData,
 *   width: number,
 *   height: number
 * }>}
 */
export async function compressToJPEG(pixelBuffer, qualityFactor) {
  if (!(pixelBuffer instanceof ImageData)) {
    throw new TypeError("pixelBuffer must be an ImageData object.");
  }

  if (
    typeof qualityFactor !== "number" ||
    !Number.isFinite(qualityFactor)
  ) {
    throw new TypeError("qualityFactor must be a finite number.");
  }

  if (qualityFactor < 10 || qualityFactor > 100) {
    throw new RangeError("qualityFactor must be between 10 and 100.");
  }

  const canvas = document.createElement("canvas");

  canvas.width = pixelBuffer.width;
  canvas.height = pixelBuffer.height;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Unable to create 2D canvas context.");
  }

  // Put the original pixel data into the canvas.
  ctx.putImageData(pixelBuffer, 0, 0);

  // Canvas JPEG quality uses a value between 0 and 1.
  const jpegQuality = qualityFactor / 100;

  // Compress the image into JPEG.
  const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);

  // Decode the compressed JPEG back into an image.
  const image = await loadImage(dataUrl);

  // Create a new canvas for the decoded JPEG.
  const decodedCanvas = document.createElement("canvas");

  decodedCanvas.width = image.width;
  decodedCanvas.height = image.height;

  const decodedCtx = decodedCanvas.getContext("2d");

  if (!decodedCtx) {
    throw new Error("Unable to create decoded JPEG canvas context.");
  }

  decodedCtx.drawImage(image, 0, 0);

  // Get the actual pixel data AFTER JPEG compression.
  const compressedImageData = decodedCtx.getImageData(
    0,
    0,
    image.width,
    image.height
  );

  return {
    dataUrl,
    imageData: compressedImageData,
    width: image.width,
    height: image.height
  };
}

/**
 * Load an image from a data URL.
 *
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };

    image.onerror = () => {
      reject(new Error("Failed to decode JPEG image."));
    };

    image.src = dataUrl;
  });
}