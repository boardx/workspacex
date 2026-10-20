import { defineConfig } from "vitest/config";
import base from "./vitest.config";
/** Dedicated real browser/API lane; no fallback to unit-only selection. */
export default defineConfig({ ...base, test: { ...base.test,
  include: ["tests/billing/cashier-browser.integration.ts", "tests/billing/subscription-browser.integration.ts"], exclude: [], fileParallelism: false,
  // Browser hydration and HTTP reads on cold CI builds need a browser-sized
  // observation budget, rather than Vitest's 1s unit-poll default. Assertions
  // remain state-based and fail after a bounded 15s without fixed sleeps.
  expect: { ...base.test?.expect, poll: { timeout: 15000, interval: 100 } },
  globalSetup: ["tests/billing/cashier-browser-global-setup.ts", "tests/support/db-global-setup.ts"],
} });
