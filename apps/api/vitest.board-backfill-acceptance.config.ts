import {defineConfig} from 'vitest/config';
import base from './vitest.config';
export default defineConfig({...base,test:{...base.test,include:['tests/whiteboard/storage-backfill-real.acceptance.ts'],maxWorkers:1,minWorkers:1}});
