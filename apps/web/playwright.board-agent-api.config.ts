import {randomUUID} from 'node:crypto';
import {defineConfig} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';
const marker=process.env.BOARD_API_RUNTIME_MARKER??randomUUID();
process.env.BOARD_API_RUNTIME_MARKER=marker;
const servers=(Array.isArray(base.webServer)?base.webServer:[base.webServer]).filter(server=>server&&!server.command.includes('next build')).map(server=>({...server!,env:{...server!.env,WORKSPACEX_DEPLOYMENT_MARKER:marker}}));
export default defineConfig({...base,testDir:'./e2e',testMatch:'board-agent-public-api.spec.ts',projects:[{name:'board-agent-api'}],webServer:servers,workers:1,timeout:180000,reporter:'list'});
