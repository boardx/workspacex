import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/auth/email-recovery-credentials.test.ts"], maxWorkers: 1, minWorkers: 1 } });
