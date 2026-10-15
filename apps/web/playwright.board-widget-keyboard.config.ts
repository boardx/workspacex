import {defineConfig,devices} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';
/** Fresh seeded isolated runtime; never accepts an unrelated existing server. */
const config=defineConfig({
 ...base,testDir:'./e2e',testMatch:['board-widget-keyboard.spec.ts'],workers:1,retries:0,timeout:180_000,
 outputDir:'test-results/board-widget-keyboard',
 projects:[
  {name:'board-keyboard-desktop',dependencies:[],testMatch:['board-widget-keyboard.spec.ts'],use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}},
  {name:'board-keyboard-mobile',dependencies:[],testMatch:['board-widget-keyboard.spec.ts'],use:{...devices['Desktop Chrome'],viewport:{width:390,height:844}}},
 ],
});
export default config;
