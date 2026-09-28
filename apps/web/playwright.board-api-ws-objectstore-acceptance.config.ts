import {randomUUID} from 'node:crypto';
import {defineConfig,devices} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';

const marker=process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER??randomUUID();
process.env.BOARD_API_RUNTIME_MARKER=marker;
const servers=(Array.isArray(base.webServer)?base.webServer:[base.webServer]).filter(Boolean).map(server=>({...server!,reuseExistingServer:false,env:{...server!.env,WORKSPACEX_DEPLOYMENT_MARKER:marker,BOARD_API_RUNTIME_MARKER:marker,BOARD_AGENT_API_ACCEPTANCE:'1'}}));

export default defineConfig({...base,
 testDir:'./e2e',
 testMatch:['board-agent-public-api.spec.ts','board-shared-outbox.spec.ts','board-portable-real.spec.ts'],
 projects:[{name:'board-api-ws-objectstore',use:{...devices['Desktop Chrome']}}],
 webServer:servers,use:{...base.use,trace:'off',video:'off'},workers:1,fullyParallel:false,retries:0,timeout:240_000,
});
