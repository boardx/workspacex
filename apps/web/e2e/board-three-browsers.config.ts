import base from '../playwright.fullstack-smoke.config';
import {devices} from '@playwright/test';

export default {
  ...base,
  testDir: '.',
  testMatch: /board-(final-acceptance|accessibility-input|import-storage|collaboration-load|security)\.spec\.ts/,
  projects: [
    {name:'chromium',use:{...devices['Desktop Chrome']}},
    {name:'firefox',use:{...devices['Desktop Firefox']}},
    {name:'webkit',use:{...devices['Desktop Safari']}},
  ],
};
