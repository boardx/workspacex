import {defineConfig,devices} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';
import {BOARD_REMAINING_FILES,BOARD_REMAINING_GREP,BOARD_REMAINING_PROJECT} from './board-remaining-registry.mjs';
/** Targeted restored cases plus #5666. Does not replace either complete acceptance suite. */
export default defineConfig({
  ...base,workers:1,fullyParallel:false,retries:0,forbidOnly:true,
  outputDir:'./test-results/board-remaining',
  projects:[{name:BOARD_REMAINING_PROJECT,dependencies:[],testMatch:[...BOARD_REMAINING_FILES],grep:BOARD_REMAINING_GREP,
    use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}},
  }],
});
