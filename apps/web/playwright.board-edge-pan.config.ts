import {defineConfig} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';

/** Fresh production build, seeded isolated API and all eight real drag cases. */
export const boardEdgePanConfig = defineConfig({
 ...base,
 testDir:'./e2e',testMatch:'board-edge-pan.spec.ts',
 projects:(base.projects??[]).filter(project=>project.name==='seeded').map(project=>({...project,name:'board-edge-pan',dependencies:[],testMatch:'board-edge-pan.spec.ts'})),
 workers:1,fullyParallel:false,retries:0,timeout:120_000,
 use:{...base.use,trace:'off',video:'off',screenshot:'only-on-failure'},
});
export default boardEdgePanConfig;
