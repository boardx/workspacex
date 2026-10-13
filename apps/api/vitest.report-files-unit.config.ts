import { defineConfig } from 'vitest/config';
/** Pure report-file orchestration; persistent RLS/lease acceptance stays in the isolated DB lane. */
export default defineConfig({ test: { include: ['tests/report-files/*.test.ts'], exclude: ['tests/report-files/*.db.test.ts'], fileParallelism: false } });
