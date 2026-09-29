/**
 * Calculate bit accuracy between original and extracted bits.
 *
 * @param {Array<number|string>} originalBits - Original embedded bits.
 * @param {Array<number|string>} extractedBits - Bits extracted after processing.
 * @returns {number} Accuracy percentage (0-100).
 */
export function calculateBitAccuracy(originalBits, extractedBits) {
  if (!Array.isArray(originalBits) || !Array.isArray(extractedBits)) {
    throw new TypeError("originalBits and extractedBits must be arrays.");
  }

  if (originalBits.length === 0) {
    return 0;
  }

  const isValidBit = (bit) =>
    bit === 0 ||
    bit === 1 ||
    bit === "0" ||
    bit === "1";

  if (!originalBits.every(isValidBit)) {
    throw new TypeError("originalBits must contain only 0 or 1.");
  }

  if (!extractedBits.every(isValidBit)) {
    throw new TypeError("extractedBits must contain only 0 or 1.");
  }

  let matchingBits = 0;

  for (let i = 0; i < originalBits.length; i++) {
    if (
      extractedBits[i] !== undefined &&
      Number(originalBits[i]) === Number(extractedBits[i])
    ) {
      matchingBits++;
    }
  }

  return (matchingBits / originalBits.length) * 100;
}