import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defineConfig} from '@playwright/test';
import fullstack from '../../playwright.fullstack-smoke.config';

const cwd=resolve(__dirname,'../..'),servers=Array.isArray(fullstack.webServer)?fullstack.webServer:fullstack.webServer?[fullstack.webServer]:[];
const marker=process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER??randomUUID();

/** Unconditional synthetic import-report regression; it must not depend on captured vendor files. */
export default defineConfig({...fullstack,testDir:'..',workers:1,retries:0,
  webServer:servers.map(server=>({...server,cwd:server.cwd??cwd,reuseExistingServer:false,env:{...server.env,WORKSPACEX_DEPLOYMENT_MARKER:marker}})),
  projects:[{name:'synthetic-import-report',testMatch:'board-import-report.spec.ts'}],
  outputDir:'../../test-results/board-ci/import-report/browser',
  reporter:[['list'],['json',{outputFile:resolve(cwd,'test-results/board-ci/import-report/playwright.json')}]],
  timeout:180_000,expect:{timeout:30_000},use:{...fullstack.use,viewport:{width:1440,height:1000},trace:'retain-on-failure'},
});
