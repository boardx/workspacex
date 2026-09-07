import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Preserve canonical isolation, global setup and environment. Replace rather than
// merge include/exclude arrays: mergeConfig would also select the ordinary suite.
if (!process.env.WX_NATIVE_SANDBOX_CONTAINER) {
  throw new Error("test:native-chain requires an explicitly owned WX_NATIVE_SANDBOX_CONTAINER");
}
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/agent-runtime/native-full-chain.test.ts"],
    exclude: [],
    fileParallelism: false,
  },
});
