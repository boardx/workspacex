import {defineConfig} from '@playwright/test';
const config=defineConfig({testDir:'.',testMatch:'board-widget-keyboard.spec.ts',workers:1,retries:0,timeout:180_000,
 projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
 use:{baseURL:process.env.BOARD_KEYBOARD_WEB_URL??process.env.BOARD_CONNECTOR_WEB_URL,trace:'off'},outputDir:'../test-results/board-widget-keyboard'});
export default config;
