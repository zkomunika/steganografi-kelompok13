// constants.js
// Names and IDs referenced across more than one module. Centralising them
// means a typo becomes a single place to fix instead of a silent DOM bug.

export const PAGES = {
  DASHBOARD:  'dashboard',
  EMBEDDING:  'embedding',
  EXTRACTION: 'extraction',
  ANALYSIS:   'analysis',
  JPEG:       'jpeg',
  BATCH:      'batch',
};

export const PAGE_ID_PREFIX = 'page-';

export const STATUS = {
  OK:   'ok',
  FAIL: 'fail',
};

export const ERROR = {
  NO_IMAGE:           'Belum ada cover image yang di-upload.',
  INVALID_FORMAT:     'Format file tidak didukung. Gunakan PNG atau BMP.',
  FILE_READ_FAILED:   'File gagal dibaca. Pastikan file tidak rusak.',
  INVALID_IMAGE:      'Image tidak valid atau tidak dapat diproses.',
  EMPTY_MESSAGE:      'Secret message tidak boleh kosong.',
  EMPTY_KEY:          'Stego-Key tidak boleh kosong.',
  EMPTY_ENC_KEY:      'Kunci Enkripsi tidak boleh kosong.',
  SAME_KEYS:          'Kunci Enkripsi harus berbeda dari Stego-Key.',
  MESSAGE_TOO_LONG:   'Pesan melebihi kapasitas yang tersedia dalam image.',
  NO_STEGO_IMAGE:     'Belum ada stego image. Lakukan proses Embedding terlebih dahulu.',
  STATE_INCOMPLETE:   'Data yang dibutuhkan belum tersedia. Periksa kembali semua input.',
};
