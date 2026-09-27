import {defineConfig} from 'vitest/config';
import base from './vitest.config';
import {assertLocalMaintenanceAcceptance} from './tests/support/board-maintenance-isolation';
assertLocalMaintenanceAcceptance();
export default defineConfig({...base,test:{...base.test,include:['tests/whiteboard/backup-maintenance-real.acceptance.ts'],maxWorkers:1,minWorkers:1,testTimeout:120_000,hookTimeout:120_000}});
