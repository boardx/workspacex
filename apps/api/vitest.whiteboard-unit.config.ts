import { defineConfig } from 'vitest/config';
/** Pure Board guard tests. PostgreSQL behavior is verified separately in the owned isolated stack. */
export default defineConfig({test:{include:['tests/whiteboard/discussion-{guards,permissions}.test.ts'],maxWorkers:1,minWorkers:1}});
