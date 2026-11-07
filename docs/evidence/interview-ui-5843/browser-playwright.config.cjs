const path = require('node:path');
module.exports = {
  testDir: path.resolve(__dirname, '../../../apps/web/e2e'),
  testMatch: 'digital-interview-research-quality.spec.ts',
  workers: 1,
  timeout: 90000,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/interview-ui-5843-results',
  use: { baseURL: 'http://localhost:35843', headless: true },
};
