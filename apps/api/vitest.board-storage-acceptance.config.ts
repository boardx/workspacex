import { defineConfig } from 'vitest/config';
import base from './vitest.config';
export default defineConfig({...base,test:{...base.test,include:['tests/whiteboard/storage-lifecycle-real.acceptance.ts','tests/whiteboard/pgsql-metadata-only-growth.test.ts'],maxWorkers:1,minWorkers:1}});
