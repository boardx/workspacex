import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import fullstack from '../../playwright.fullstack-smoke.config';
/** Fresh-stack lane inherits the established API/web/seed orchestration unchanged.
 * Run through the root isolation wrapper; this file adds no bespoke service path. */
const webDirectory=resolve(__dirname,'../..');
const servers=Array.isArray(fullstack.webServer)?fullstack.webServer:fullstack.webServer?[fullstack.webServer]:[];
export default defineConfig({ ...fullstack, testDir: '..', workers: 1, retries: 0,
  webServer:servers.map(server=>({...server,cwd:server.cwd??webDirectory})),
  // This fresh local acceptance lane shares one production build across three engines.
  // The canonical board-storage CI config remains its existing Chromium project.
  projects: (['chromium','firefox','webkit'] as const).map(browserName => ({
    name:`durable-images-${browserName}`, use:{browserName},
    testMatch:['board-durable-images.spec.ts','board-portable-real.spec.ts'],
  })),
  timeout:120_000, expect:{timeout:30_000},
  use:{...fullstack.use,viewport:{width:1440,height:1000},trace:'retain-on-failure'},
});
