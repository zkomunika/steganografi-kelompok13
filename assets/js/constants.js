// constants.js
// Names/ids referenced across more than one module. Centralising them
// means a typo becomes a single place to fix instead of a silent bug
// hiding in a DOM query somewhere.

export const PAGES = {
  DASHBOARD: 'dashboard',
  EMBEDDING: 'embedding',
  EXTRACTION: 'extraction',
  ANALYSIS: 'analysis',
  JPEG: 'jpeg',
};

export const PAGE_ID_PREFIX = 'page-';

export const STATUS = {
  OK: 'ok',
  FAIL: 'fail',
};
