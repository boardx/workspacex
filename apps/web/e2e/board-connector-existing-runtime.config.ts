import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'board-connector-independent-process.spec.ts',workers:1,fullyParallel:false,retries:0,timeout:240_000,
 use:{baseURL:process.env.BOARD_CONNECTOR_WEB_URL,trace:'off'},outputDir:'../test-results/board-connector-independent'});
