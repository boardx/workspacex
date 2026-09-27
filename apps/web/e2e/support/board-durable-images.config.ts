import { defineConfig } from '@playwright/test';
/** Existing isolated fullstack services and seed-fullstack-smoke are required.
 * This config deliberately never launches Docker, servers or fixture mutators. */
export default defineConfig({ testDir: '..', testMatch: 'board-durable-images.spec.ts', workers: 1, retries: 0,
  timeout: 120_000, expect: {timeout: 30_000}, use: {baseURL: process.env.WHITEBOARD_WEB_URL ?? (process.env.WORKSPACEX_WEB_PORT ? `http://127.0.0.1:${process.env.WORKSPACEX_WEB_PORT}` : undefined), viewport:{width:1440,height:1000}, trace:'retain-on-failure'} });
