import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.fullstack-smoke.config';
const cwd=resolve(__dirname,'../..'),servers=Array.isArray(base.webServer)?base.webServer:base.webServer?[base.webServer]:[];
export default defineConfig({...base,testDir:'..',workers:1,retries:0,webServer:servers.map(server=>({...server,cwd:server.cwd??cwd})),projects:[{name:'chat-board-three-diagrams',testMatch:'chat-board-three-diagram.spec.ts'}],timeout:240_000,expect:{timeout:30_000}});
