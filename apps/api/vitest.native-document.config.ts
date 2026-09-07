import { defineConfig } from 'vitest/config';
import base from './vitest.config';
if (!process.env.WX_NATIVE_SANDBOX_CONTAINER) throw new Error('Native document acceptance requires an owned sandbox container');
export default defineConfig({ ...base, test: { ...base.test,
  include: ['tests/agent-runtime/standard-document-locators-http.test.ts'],
  exclude: [], fileParallelism: false,
} });
