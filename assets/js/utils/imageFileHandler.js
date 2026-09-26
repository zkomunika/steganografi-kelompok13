// utils/imageFileHandler.js
// Handles saving a generated image (e.g. the Stego Image) back to the
// user's device as a PNG file via a programmatic <a> download trigger.
//
// No pixel manipulation lives here — this module only handles the
// "save to disk" concern.

/**
 * Memicu download file image ke perangkat pengguna.
 * Menerima data URL atau Blob.
 *
 * @param {string|Blob} dataUrlOrBlob  – PNG data URL atau Blob
 * @param {string}      filename       – nama file (termasuk ekstensi, mis. "stego.png")
 */
export function downloadImage(dataUrlOrBlob, filename = 'stego_output.png') {
  const a = document.createElement('a');
  a.download = filename;

  if (typeof dataUrlOrBlob === 'string') {
    // Data URL langsung digunakan sebagai href
    a.href = dataUrlOrBlob;
  } else {
    // Blob: buat object URL sementara, lalu revoke setelah klik
    const objectUrl = URL.createObjectURL(dataUrlOrBlob);
    a.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  // Trigger download tanpa membuka tab baru
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
