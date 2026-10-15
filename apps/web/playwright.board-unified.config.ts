import {defineConfig,devices} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';
import {BOARD_UNIFIED_REGRESSION_SPECS} from './board-unified-regression-registry';
/** Exact affected-product lane: same fresh isolated runtime, no unrelated journeys. */
export default defineConfig({
 ...base,workers:1,fullyParallel:false,retries:0,timeout:180_000,
 outputDir:'./test-results/board-unified',
 projects:[
  {name:'board-unified-desktop',dependencies:[],testMatch:[...BOARD_UNIFIED_REGRESSION_SPECS,'whiteboard-live.spec.ts'],
   use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
  {name:'board-unified-mobile',dependencies:[],testMatch:['board-widget-keyboard.spec.ts'],
   use:{...devices['Desktop Chrome'],viewport:{width:390,height:844}}},
 ],
});
