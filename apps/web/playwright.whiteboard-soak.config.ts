import { defineConfig } from '@playwright/test';
import fullstack from './playwright.fullstack-smoke.config';
import { readSoakConfig } from './e2e/support/whiteboard-collaboration-soak';

const soak = readSoakConfig();
const ledgerPrivateKey=process.env.WHITEBOARD_SOAK_LEDGER_PRIVATE_KEY;
delete process.env.WHITEBOARD_SOAK_LEDGER_PRIVATE_KEY;
const soakWebServers=(Array.isArray(fullstack.webServer)?fullstack.webServer:[fullstack.webServer]).filter(Boolean).map(server=>{
  const env={...server!.env};delete env.WHITEBOARD_SOAK_LEDGER_PRIVATE_KEY;
  if(typeof server?.command!=='string'||!server.command.includes('@repo/api start')||!ledgerPrivateKey)return {...server!,env};
  return {...server,env:{...env,WHITEBOARD_SOAK_LEDGER_PRIVATE_KEY:ledgerPrivateKey}};
});

/**
 * Explicit long-running Board evidence lane. It reuses the isolated full-stack
 * topology but replaces the ordinary project list, output directory and budget.
 */
export default defineConfig({
  ...fullstack,
  webServer:soakWebServers,
  outputDir: 'test-results/whiteboard-collaboration-soak',
  projects: [{ name: 'whiteboard-collaboration-soak', testMatch: ['whiteboard-collaboration-soak.spec.ts'] }],
  timeout: soak.durationMs + soak.offlineMs + 10 * 60_000,
  retries: 0,
  reporter: process.env.CI
    ? [['line'], ['json', { outputFile: 'test-results/whiteboard-collaboration-soak/playwright.json' }]]
    : 'list',
});
