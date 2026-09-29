// core/cryptoService.js
//
// Enkripsi pesan sebelum disisipkan ke citra (Juknis: "enkripsi sebelum embed").
//
// ── Skema ────────────────────────────────────────────────────────────────────
//   Kunci   : PBKDF2-HMAC-SHA256 (600.000 iterasi) dari Kunci Enkripsi → AES-256
//   Cipher  : AES-256-GCM (terautentikasi; tag 128 bit)
//   Salt    : 16 byte acak per pesan  (crypto.getRandomValues)
//   IV      : 12 byte acak per pesan  (crypto.getRandomValues)
//
//   Layout payload terenkripsi (inilah yang dimasukkan ke messageBitConverter):
//   ┌────────────┬────────────┬──────────────────────────────┐
//   │ salt (16)  │  IV (12)   │ ciphertext (N) ‖ tag GCM (16) │
//   └────────────┴────────────┴──────────────────────────────┘
//   Overhead tetap = 16 + 12 + 16 = 44 byte per pesan.
//
// ── Catatan keamanan ─────────────────────────────────────────────────────────
//   • Kunci Enkripsi HARUS terpisah dari Stego-Key. Stego-Key hanya menentukan
//     posisi bit (djb2 → Xorshift32, murah dihitung); bila password yang sama
//     dipakai untuk keduanya, penyerang bisa menebak password lewat uji posisi
//     yang murah dan melewati biaya PBKDF2.
//   • Salt dan IV acak per pesan → pesan yang sama menghasilkan payload berbeda.
//   • GCM mengautentikasi data: kunci salah atau bit yang rusak (mis. akibat
//     kompresi JPEG) selalu terdeteksi, tidak pernah menghasilkan teks "hampir benar".
//   • Tidak ada kunci/IV/salt yang disimpan di source maupun di storage browser.
//   • Web Crypto (crypto.subtle) hanya tersedia di konteks aman: https:// atau
//     http://localhost.
//
// ── Interface ────────────────────────────────────────────────────────────────
//   CRYPTO_OVERHEAD_BYTES
//   getEncryptedByteLength(plainByteLen) → number
//   encryptMessage(plaintext, password)  → Promise<Uint8Array>
//   decryptMessage(payload, password)    → Promise<string>   (throws DecryptionError)

export const SALT_BYTES = 16;
export const IV_BYTES   = 12;
export const TAG_BYTES  = 16;
export const PBKDF2_ITERATIONS = 600000;

/** Tambahan byte yang selalu ditambahkan enkripsi pada setiap pesan. */
export const CRYPTO_OVERHEAD_BYTES = SALT_BYTES + IV_BYTES + TAG_BYTES;

export class DecryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Panjang payload terenkripsi (byte) untuk plaintext sepanjang plainByteLen byte. */
export function getEncryptedByteLength(plainByteLen) {
  return plainByteLen + CRYPTO_OVERHEAD_BYTES;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
function _subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      'Web Crypto tidak tersedia. Jalankan aplikasi lewat http://localhost atau https://, ' +
      'bukan dengan membuka file langsung.'
    );
  }
  return c.subtle;
}

function _passwordBytes(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('[cryptoService] Kunci enkripsi harus berupa string tidak kosong.');
  }
  // NFC: karakter yang tampak sama tetapi tersusun berbeda menghasilkan kunci sama.
  return new TextEncoder().encode(password.normalize('NFC'));
}

async function _deriveKey(password, salt, usage) {
  const subtle  = _subtle();
  const baseKey = await subtle.importKey(
    'raw', _passwordBytes(password), 'PBKDF2', false, ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

// ---------------------------------------------------------------------------
// encryptMessage
// ---------------------------------------------------------------------------
/**
 * @param {string} plaintext
 * @param {string} password   – Kunci Enkripsi (bukan Stego-Key)
 * @param {{salt?:Uint8Array, iv?:Uint8Array}} [testOverrides]
 *        HANYA untuk pengujian yang harus dapat diulang (runner batch): salt/IV
 *        tetap membuat ciphertext, dan karenanya bit yang diubah, identik di setiap
 *        run. Jangan dipakai di jalur pemakaian biasa — salt dan IV wajib acak
 *        (dan IV tidak boleh dipakai ulang dengan kunci yang sama).
 * @returns {Promise<Uint8Array>}  salt ‖ iv ‖ ciphertext ‖ tag
 */
export async function encryptMessage(plaintext, password, testOverrides = {}) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('[cryptoService] plaintext harus berupa string.');
  }
  const subtle = _subtle();
  const salt   = testOverrides.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv     = testOverrides.iv   ?? globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
    throw new TypeError(`[cryptoService] salt harus ${SALT_BYTES} byte dan IV ${IV_BYTES} byte.`);
  }
  const key    = await _deriveKey(password, salt, 'encrypt');

  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 },
      key,
      new TextEncoder().encode(plaintext)
    )
  );

  const out = new Uint8Array(SALT_BYTES + IV_BYTES + ct.length);
  out.set(salt, 0);
  out.set(iv,   SALT_BYTES);
  out.set(ct,   SALT_BYTES + IV_BYTES);
  return out;
}

// ---------------------------------------------------------------------------
// decryptMessage
// ---------------------------------------------------------------------------
/**
 * @param {Uint8Array} payload   – keluaran encryptMessage()
 * @param {string}     password  – Kunci Enkripsi
 * @returns {Promise<string>}
 * @throws {DecryptionError}  kunci salah, payload terpotong, atau data dimodifikasi
 */
export async function decryptMessage(payload, password) {
  // Minimal: overhead + 1 byte plaintext.
  if (!(payload instanceof Uint8Array) || payload.length <= CRYPTO_OVERHEAD_BYTES) {
    throw new DecryptionError('Payload terlalu pendek untuk pesan terenkripsi.');
  }

  const salt = payload.slice(0, SALT_BYTES);
  const iv   = payload.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ct   = payload.slice(SALT_BYTES + IV_BYTES);
  const key  = await _deriveKey(password, salt, 'decrypt');

  let plainBytes;
  try {
    plainBytes = new Uint8Array(
      await _subtle().decrypt({ name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 }, key, ct)
    );
  } catch {
    // Web Crypto sengaja tidak membedakan penyebab kegagalan tag.
    throw new DecryptionError(
      'Dekripsi gagal: Kunci Enkripsi salah, atau data pesan rusak/dimodifikasi.'
    );
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(plainBytes);
  } catch {
    throw new DecryptionError('Dekripsi berhasil tetapi isi pesan bukan UTF-8 yang valid.');
  }
}
