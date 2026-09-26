// services/fileService.js
// Thin wrapper around browser File/Image APIs. Responsible only for
// letting the user pick a file and reading its basic metadata
// (name, size, dimensions, data URL). No pixel-level decoding or
// steganography logic lives here — that belongs to core/imageHandler.js
// once it is implemented.

export function pickImageFile({ accept = 'image/png,image/bmp' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener(
      'change',
      () => {
        const file = input.files && input.files[0];
        if (!file) {
          reject(new Error('No file selected'));
          return;
        }
        resolve(file);
      },
      { once: true }
    );
    input.click();
  });
}

export function readImageMeta(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        resolve({
          name: file.name,
          size: file.size,
          width: img.width,
          height: img.height,
          dataUrl: reader.result,
        });
      };
      img.onerror = () => reject(new Error('Failed to read image dimensions'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
