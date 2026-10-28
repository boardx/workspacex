import { defineConfig } from 'vitest/config';
/** Private transport tests use real loopback/UDS servers and no database. DB ownership stays in the normal isolated PG suite. */
export default defineConfig({ test: { include: ['tests/skill/sandbox-capacity-transport.test.ts'], maxWorkers: 1, minWorkers: 1 } });
