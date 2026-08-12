#!/usr/bin/env node
import { runWithTestIsolation } from "../with-test-isolation";

void runWithTestIsolation(process.argv, {
  acquireSlot: async () => ({
    waitedMs: 0,
    release: () => undefined,
  }),
}).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
