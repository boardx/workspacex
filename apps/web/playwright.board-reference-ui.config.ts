import {defineConfig,devices} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';
export default defineConfig({...base,testDir:'./e2e',testMatch:'board-compact-chrome-acceptance.spec.ts',workers:1,retries:0,timeout:240_000,outputDir:'./test-results/board-reference-ui',projects:[{name:'board-reference-ui',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}}]});
