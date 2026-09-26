// core/messageBitConverter.js
// Converts a UTF-8 string to/from a flat bit array (number[] of 0/1 values).
//
// Encoding scheme (matches the extraction side):
//   1. Encode the message string to UTF-8 bytes using TextEncoder.
//   2. Prepend a 32-bit big-endian length field (byte count of the UTF-8 payload).
//   3. Flatten every byte MSB→LSB into individual 0/1 values.
//
// The 32-bit length prefix allows the extractor to know exactly how many
// bits to read back without needing a null-terminator pattern.

const HEADER_BYTES = 4;   // 32-bit (4-byte) length prefix

// ---------------------------------------------------------------------------
// messageToBits
// ---------------------------------------------------------------------------
/**
 * Convert a UTF-8 string to a bit array.
 * Layout: [32-bit-length-prefix][payload-bytes]
 *
 * @param {string} message
 * @returns {number[]}  flat array of 0/1 values, MSB first per byte
 */
export function messageToBits(message) {
  if (typeof message !== 'string') {
    throw new TypeError('[messageBitConverter] message harus berupa string.');
  }

  // Encode to UTF-8
  const encoder  = new TextEncoder();  // always UTF-8
  const payload  = encoder.encode(message); // Uint8Array

  // Build header: 4 bytes, big-endian length of payload
  const byteLen  = payload.length;
  const header   = new Uint8Array(HEADER_BYTES);
  header[0] = (byteLen >>> 24) & 0xff;
  header[1] = (byteLen >>> 16) & 0xff;
  header[2] = (byteLen >>>  8) & 0xff;
  header[3] =  byteLen         & 0xff;

  // Concatenate header + payload
  const all  = new Uint8Array(HEADER_BYTES + byteLen);
  all.set(header,  0);
  all.set(payload, HEADER_BYTES);

  // Flatten to bit array
  const bits = [];
  for (const byte of all) {
    for (let shift = 7; shift >= 0; shift--) {
      bits.push((byte >> shift) & 1);
    }
  }

  return bits;
}

// ---------------------------------------------------------------------------
// bitsToMessage
// ---------------------------------------------------------------------------
/**
 * Reconstruct a UTF-8 string from a bit array produced by messageToBits().
 * Reads the 32-bit length prefix first, then extracts exactly that many
 * bytes from the remaining bits.
 *
 * @param {number[]} bits  – flat 0/1 array, at minimum 32 bits (length header)
 * @returns {string}       – decoded string, or empty string on error
 */
export function bitsToMessage(bits) {
  if (!Array.isArray(bits) || bits.length < HEADER_BYTES * 8) {
    return '';
  }

  // Read 32-bit header
  let byteLen = 0;
  for (let i = 0; i < 32; i++) {
    byteLen = (byteLen << 1) | (bits[i] & 1);
  }
  // Treat as unsigned 32-bit integer
  byteLen = byteLen >>> 0;

  const totalBitsNeeded = (HEADER_BYTES + byteLen) * 8;
  if (bits.length < totalBitsNeeded || byteLen === 0) {
    return '';
  }

  // Extract payload bytes
  const payloadBytes = new Uint8Array(byteLen);
  const payloadStart = HEADER_BYTES * 8;  // skip header bits

  for (let i = 0; i < byteLen; i++) {
    let byte = 0;
    for (let shift = 7; shift >= 0; shift--) {
      byte |= (bits[payloadStart + i * 8 + (7 - shift)] & 1) << shift;
    }
    payloadBytes[i] = byte;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
  } catch {
    // Fallback: non-fatal decode (replaces invalid sequences with U+FFFD)
    return new TextDecoder('utf-8', { fatal: false }).decode(payloadBytes);
  }
}

// ---------------------------------------------------------------------------
// getMessageByteLength
// ---------------------------------------------------------------------------
/**
 * Returns the number of UTF-8 bytes a message will occupy (without header).
 * Useful for displaying byte counts in the UI.
 *
 * @param {string} message
 * @returns {number}
 */
export function getMessageByteLength(message) {
  if (!message) return 0;
  return new TextEncoder().encode(message).length;
}

// ---------------------------------------------------------------------------
// getRequiredBits
// ---------------------------------------------------------------------------
/**
 * Total bits needed to embed a message (header + payload).
 * This is simply messageToBits(message).length but without building the
 * full bit array — faster for capacity checks.
 *
 * @param {string} message
 * @returns {number}
 */
export function getRequiredBits(message) {
  if (!message) return 0;
  const payloadBytes = new TextEncoder().encode(message).length;
  return (HEADER_BYTES + payloadBytes) * 8;
}
