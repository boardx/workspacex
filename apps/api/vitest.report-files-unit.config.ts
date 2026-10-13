import { defineConfig } from 'vitest/config';
/** Pure report orchestration. DB and opted-in native model acceptance have separate lanes. */
export default defineConfig({ test: {
  include: ['tests/report-files/*.test.ts'],
  exclude: ['tests/report-files/*.db.test.ts', 'tests/report-files/native-live.test.ts'],
  fileParallelism: false,
} });
