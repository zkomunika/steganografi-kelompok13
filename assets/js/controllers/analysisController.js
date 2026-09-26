// controllers/analysisController.js
// Application layer for the Image Analysis page.
// Renders cover vs stego comparison from state when analysis results are available.
// Analysis computation (MSE/PSNR) is wired in via the next checkpoint.

import { getState, subscribe } from '../state.js';

const dom = {};

function cacheDom() {
  const page = document.getElementById('page-analysis');
  dom.page           = page;
  dom.coverPreview   = page.querySelector('#ana-cover-preview');
  dom.stegoPreview   = page.querySelector('#ana-stego-preview');
  dom.coverSizeLabel = page.querySelector('#ana-cover-size');
  dom.stegoSizeLabel = page.querySelector('#ana-stego-size');
  dom.mseValue       = page.querySelector('#ana-mse');
  dom.psnrValue      = page.querySelector('#ana-psnr');
  dom.fileDeltaValue = page.querySelector('#ana-filedelta');
  dom.summaryText    = page.querySelector('#ana-summary');
}

function _renderPreviews(state) {
  if (state.coverImage && dom.coverPreview) {
    dom.coverPreview.innerHTML = '';
    const img = document.createElement('img');
    img.src   = state.coverImage.dataUrl;
    img.alt   = 'Cover Image';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
    dom.coverPreview.appendChild(img);
    if (dom.coverSizeLabel) {
      dom.coverSizeLabel.textContent = _formatBytes(state.coverImage.size);
    }
  }

  if (state.stegoImage && dom.stegoPreview) {
    dom.stegoPreview.innerHTML = '';
    const img = document.createElement('img');
    img.src   = state.stegoImage.dataUrl;
    img.alt   = 'Stego Image';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
    dom.stegoPreview.appendChild(img);
    if (dom.stegoSizeLabel) {
      dom.stegoSizeLabel.textContent = _formatBytes(state.stegoImage.size);
    }
  }

  if (state.analysisResult) {
    const r = state.analysisResult;

    if (dom.mseValue) {
      dom.mseValue.textContent = r.mse !== null && r.mse !== undefined
        ? Number(r.mse).toFixed(4) : '—';
      dom.mseValue.className = 'metric-value' + (r.psnr > 50 ? ' good' : '');
    }

    if (dom.psnrValue) {
      if (r.psnr !== null && r.psnr !== undefined) {
        dom.psnrValue.textContent = isFinite(r.psnr)
          ? Number(r.psnr).toFixed(2) + ' dB' : '∞ dB';
      } else {
        dom.psnrValue.textContent = '—';
      }
      dom.psnrValue.className = 'metric-value' + (r.psnr > 50 ? ' good' : '');
    }

    if (dom.fileDeltaValue && r.fileSizeDeltaKb !== null && r.fileSizeDeltaKb !== undefined) {
      const delta = Number(r.fileSizeDeltaKb);
      dom.fileDeltaValue.textContent = (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' KB';
    } else if (dom.fileDeltaValue) {
      dom.fileDeltaValue.textContent = '—';
    }

    if (dom.summaryText) dom.summaryText.textContent = r.summary || '';
  }
}

function _formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export function initAnalysisController() {
  cacheDom();
  // Initial render from current state
  _renderPreviews(getState());
  // Re-render when state changes
  subscribe((state) => _renderPreviews(state));
  console.info('[AnalysisController] ready — will render from state.coverImage / state.stegoImage / state.analysisResult.');
}

export function getAnalysisMetrics() {
  return getState().analysisResult;
}
