import { defineConfig } from "vitest/config";
import base from "./vitest.config";
/** Dedicated real browser/API lane; no fallback to unit-only selection. */
export default defineConfig({ ...base, test: { ...base.test,
  include: ["tests/billing/cashier-browser.integration.ts", "tests/billing/subscription-browser.integration.ts"], exclude: [], fileParallelism: false,
  globalSetup: ["tests/billing/cashier-browser-global-setup.ts", "tests/support/db-global-setup.ts"],
} });
