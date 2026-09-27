import base from './playwright.fullstack-smoke.config';
import {devices} from '@playwright/test';
// Existing real PG/ObjectStore image durability + canonical vendor package roundtrip.
export default {...base,testDir:'./e2e',testMatch:['board-durable-images.spec.ts','board-vendor-schema-migration.spec.ts'],workers:1,retries:0,fullyParallel:false,timeout:240_000,
 use:{...base.use,trace:'off' as const,video:'off' as const},projects:[{name:'board-storage',use:{...devices['Desktop Chrome']}}],
 webServer:(Array.isArray(base.webServer)?base.webServer:[base.webServer]).map(server=>({...server!,reuseExistingServer:false,env:{...server!.env,WORKSPACEX_DEPLOYMENT_MARKER:process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER!}})),
};
