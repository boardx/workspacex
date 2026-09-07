import { defineConfig } from 'vitest/config';
import base from './vitest.config';

for (const key of ['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_MODEL', 'WX_NATIVE_SANDBOX_CONTAINER', 'WX_AUDIO_REAL_EVIDENCE', 'WORKSPACEX_BROWSER_MCP_ENDPOINT']) {
  if (!process.env[key]) throw new Error(`explicit browser skill real-model configuration required: ${key}`);
}

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/agent-runtime/browser-skill-real-model.live.ts'],
    exclude: [],
    fileParallelism: false,
  },
});
