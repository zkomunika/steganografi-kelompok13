// services/navigationService.js
// Page-switching behaviour, extracted verbatim (in spirit) from the
// prototype's inline <script> block. Pure presentation concern — no
// steganography logic belongs here.

import { PAGE_ID_PREFIX } from '../constants.js';
import { setState } from '../state.js';

export function goToPage(pageName) {
  document.querySelectorAll('.nav-item').forEach((n) =>
    n.classList.toggle('active', n.dataset.page === pageName)
  );
  document.querySelectorAll('.page').forEach((p) =>
    p.classList.toggle('active', p.id === PAGE_ID_PREFIX + pageName)
  );
  setState('navigation.currentPage', pageName);
}

export function initNavigation() {
  document
    .querySelectorAll('.nav-item')
    .forEach((n) => n.addEventListener('click', () => goToPage(n.dataset.page)));

  document
    .querySelectorAll('[data-goto]')
    .forEach((el) => el.addEventListener('click', () => goToPage(el.dataset.goto)));
}
