import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/knowledge-graph/recall-vector-fusion.test.ts', 'tests/knowledge-graph/recall-ranking.test.ts', 'tests/knowledge-graph/recall-evaluation-config.test.ts'], maxWorkers: 1, minWorkers: 1 } });
