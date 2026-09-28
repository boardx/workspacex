import {resolve} from 'node:path';
import base from '../playwright.fullstack-smoke.config';
import {randomUUID} from 'node:crypto';
import {devices} from '@playwright/test';
// Inherited shell commands are authored relative to apps/web, not this e2e directory.
const webDirectory = resolve(__dirname, '..');
const marker=process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER??randomUUID();
process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER=marker;
process.env.BOARD_ACCEPTANCE_RUNTIME_STARTED_AT??=new Date().toISOString();
// The fullstack config is Chromium-first because its voice tests need Chrome's
// fake-media flags. This lane also launches Firefox and WebKit, neither of
// which should inherit Chromium launch arguments or a microphone grant for a
// visual-only journey.
const {permissions: _permissions, launchOptions: _launchOptions, ...browserNeutralUse}=base.use ?? {};
export default {...base,testDir:'.',testMatch:/board-visual-accessibility-acceptance\.spec\.ts/,timeout:10*60_000,workers:1,retries:0,fullyParallel:false,
  outputDir:'../test-results/board-visual-accessibility',use:{...browserNeutralUse,trace:'off' as const,video:'off' as const},
  projects:[
    {name:'chromium',use:{...devices['Desktop Chrome'],hasTouch:true,
      permissions:['microphone'],launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}}},
    {name:'firefox',use:{...devices['Desktop Firefox']}},
    {name:'webkit',use:{...devices['Desktop Safari']}},
  ],
  webServer:(Array.isArray(base.webServer)?base.webServer:[base.webServer]).map(server=>({...server!,cwd:resolve(webDirectory,server?.cwd??'.'),reuseExistingServer:false,env:{...server?.env,WORKSPACEX_DEPLOYMENT_MARKER:marker}})),
};
