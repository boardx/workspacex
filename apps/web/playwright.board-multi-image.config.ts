import {defineConfig,devices} from '@playwright/test';
import fullstack from './playwright.fullstack-smoke.config';

/** Run through the root isolation wrapper: fresh API/web, seed and build proof.
 * This dedicated small batch has no dependency on unrelated browser journeys. */
const config=defineConfig({...fullstack,
 testDir:'./e2e',testMatch:['board-multi-image-upload.spec.ts'],
 projects:[{name:'board-multi-image',dependencies:[],testMatch:['board-multi-image-upload.spec.ts'],use:{...devices['Desktop Chrome']}}],
 workers:1,fullyParallel:false,retries:0,timeout:120_000,expect:{timeout:30_000},
 use:{...fullstack.use,viewport:{width:1440,height:1000},trace:'off',video:'off'},
});
export default config;
