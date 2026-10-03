import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/agent-runtime/configured-model-provider-thinking.test.ts", "tests/agent-runtime/configured-model-provider-reasoning-effort.test.ts", "tests/research/guided-thinking-policy.test.ts"], maxWorkers: 1, minWorkers: 1 } });
