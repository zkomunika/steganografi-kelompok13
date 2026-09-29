// app.js
// Composition root. The only job of this file is to wait for the DOM
// and wire every module together — it holds no business logic and no
// steganography algorithms of its own.

import { CONFIG } from './config.js';
import { initNavigation } from './services/navigationService.js';
import { initEmbeddingController } from './controllers/embeddingController.js';
import { initExtractionController } from './controllers/extractionController.js';
import { initAnalysisController } from './controllers/analysisController.js';
import { initJpegTestController } from './controllers/jpegTestController.js';
import { initBatchTestController } from './controllers/batchTestController.js';

function bootstrap() {
  initNavigation();
  initEmbeddingController();
  initExtractionController();
  initAnalysisController();
  initJpegTestController();
  initBatchTestController();

  console.info(`[app] ${CONFIG.appName} ${CONFIG.version} — modular foundation loaded.`);
}

document.addEventListener('DOMContentLoaded', bootstrap);
