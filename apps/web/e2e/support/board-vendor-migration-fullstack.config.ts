import {resolve} from 'node:path';
import {defineConfig} from '@playwright/test';
import fullstack from '../../playwright.fullstack-smoke.config';
const cwd=resolve(__dirname,'../..'),servers=Array.isArray(fullstack.webServer)?fullstack.webServer:fullstack.webServer?[fullstack.webServer]:[];
/** Inherits the standard isolated fullstack launch; --list starts no services. */
export default defineConfig({...fullstack,testDir:'..',workers:1,retries:0,webServer:servers.map(server=>({...server,cwd:server.cwd??cwd})),projects:[{name:'vendor-schema-diagnostics',testMatch:'board-vendor-schema-migration.spec.ts'}],timeout:120_000,expect:{timeout:30_000},use:{...fullstack.use,viewport:{width:1440,height:1000},trace:'retain-on-failure'}});
