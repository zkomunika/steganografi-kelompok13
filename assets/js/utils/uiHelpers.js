// utils/uiHelpers.js
// Shared presentation helpers used across controllers.
// No business logic lives here — only DOM manipulation utilities.

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------
const ERROR_ID = 'ui-error-banner';

/**
 * Show a dismissible error banner inside a page container.
 * Only one banner is shown at a time per container.
 *
 * @param {HTMLElement} container  – the page section element
 * @param {string}      message    – human-readable error text
 */
export function showError(container, message) {
  clearError(container);

  const banner = document.createElement('div');
  banner.id    = ERROR_ID + '-' + (container ? container.id : 'global');
  banner.setAttribute('role', 'alert');
  banner.className = 'error-banner';
  banner.innerHTML =
    `<span class="error-icon">⚠</span>` +
    `<span class="error-msg">${_escapeHtml(message)}</span>` +
    `<button class="error-close" aria-label="Tutup" title="Tutup">✕</button>`;

  banner.querySelector('.error-close').addEventListener('click', () => banner.remove());

  // Insert at the top of the page content (after the page-head div)
  const pageHead = container ? container.querySelector('.page-head') : null;
  const anchor   = pageHead ? pageHead.nextSibling : null;

  if (container && anchor) {
    container.insertBefore(banner, anchor);
  } else if (container) {
    container.prepend(banner);
  } else {
    document.body.prepend(banner);
  }

  // Auto-dismiss after 8 seconds
  setTimeout(() => { if (banner.parentNode) banner.remove(); }, 8000);
}

/**
 * Remove any existing error banner from a container.
 * @param {HTMLElement} container
 */
export function clearError(container) {
  if (!container) return;
  const id  = ERROR_ID + '-' + (container.id || 'global');
  const old = container.querySelector('[id^="' + ERROR_ID + '"]');
  if (old) old.remove();
}

// ---------------------------------------------------------------------------
// Format helpers (also useful in controllers)
// ---------------------------------------------------------------------------
export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024)          return bytes + ' B';
  if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
