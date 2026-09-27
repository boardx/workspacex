import {defineConfig} from '@playwright/test';
import base from './playwright.fullstack-smoke.config';
// Config-level servers seed the isolated database; this API lane needs no Next build.
const servers=(Array.isArray(base.webServer)?base.webServer:[base.webServer]).filter(server=>server&&!server.command.includes('next build'));
export default defineConfig({...base,testDir:'./e2e',testMatch:'board-acl-race.spec.ts',projects:[{name:'board-acl-race'}],webServer:servers,use:{...base.use,trace:'off',video:'off'},workers:1,timeout:180000,reporter:'list'});
