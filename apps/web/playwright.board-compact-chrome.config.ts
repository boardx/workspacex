import {defineConfig} from '@playwright/test';
/** Main-session-only: consumes an existing isolated stack; never starts services. */
export default defineConfig({testDir:'./e2e',testMatch:'board-compact-chrome-acceptance.spec.ts',workers:1,retries:0,timeout:120000,use:{baseURL:process.env.WHITEBOARD_WEB_URL??`http://127.0.0.1:${process.env.WORKSPACEX_WEB_PORT??3000}`,trace:'off',video:'off',screenshot:'only-on-failure'},reporter:'list'});
