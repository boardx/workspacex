import { defineConfig } from 'vitest/config';
import base from './vitest.config';
if (!process.env.WX_NATIVE_SANDBOX_CONTAINER || !process.env.WX_REPORT_FILES_REAL_EVIDENCE) throw new Error('An explicitly owned sandbox and private evidence path are required');
export default defineConfig({ ...base, test: { ...base.test, include: ['tests/report-files/native-live.test.ts'], exclude: [], fileParallelism: false, bail: 1, testTimeout: 600000, hookTimeout: 180000 } });
