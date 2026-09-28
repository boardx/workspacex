import {defineConfig} from '@playwright/test';
import realModel from './playwright.real-model-smoke.config';
/** Manual, paid-model lane: inherits the existing real-model deployment/auth setup.
 * No loopback provider, automatic retry, credential loading, or fixture proposal. */
export default defineConfig({...realModel,workers:1,retries:0,timeout:300_000,
  globalSetup:'./e2e/board-real-model-global-setup.ts',
  projects:[{width:1440,height:900},{width:1280,height:720},{width:1024,height:768}].map(viewport=>({name:`board-real-model-${viewport.width}`,testMatch:['board-real-model-organize.spec.ts'],use:{viewport}})),
  outputDir:'test-results/board-real-model',
  reporter:[['list'],['json',{outputFile:'test-results/board-real-model/report.json'}]],
  // Traces contain login/Authorization traffic. Keep only scrubbed evidence below.
  use:{...realModel.use,trace:'off',video:'off',screenshot:'only-on-failure'},
});
