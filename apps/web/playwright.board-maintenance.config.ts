import {defineConfig} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';
const servers=(Array.isArray(base.webServer)?base.webServer:[base.webServer]).filter(server=>server&&!server.command.includes('next build')).map(server=>server!);
export default defineConfig({...base,testDir:'./e2e',testMatch:'board-maintenance.spec.ts',projects:[{name:'board-maintenance'}],webServer:servers,use:{...base.use,trace:'off',video:'off'},workers:1,timeout:240000,reporter:'list'});
