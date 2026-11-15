import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
/** Optional-module bootstrap tests intentionally have no PostgreSQL setup. */
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: {
    include: ['apps/api/tests/skill/aidt-backend-isolation.test.ts', 'apps/api/tests/skill/aidt-backend-import-replay-isolation.test.ts', 'apps/api/tests/skill/aidt-skill-pack.test.ts', 'apps/api/tests/skill/aidt-v2-skill-guidance.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
