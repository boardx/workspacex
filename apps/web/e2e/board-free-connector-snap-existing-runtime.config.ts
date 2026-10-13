import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'board-free-connector-snap.spec.ts',workers:1,retries:0,timeout:180_000,use:{baseURL:process.env.BOARD_CONNECTOR_WEB_URL,trace:'off'},outputDir:'../test-results/board-free-connector-snap'});
