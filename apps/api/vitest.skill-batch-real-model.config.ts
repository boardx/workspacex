import {defineConfig} from 'vitest/config';
import base from './vitest.config';
if(!process.env.WX_NATIVE_SANDBOX_CONTAINER||!process.env.WX_SKILL_BATCH_EVIDENCE||!process.env.WX_SKILL_BATCH_CASE)throw new Error('explicit synthetic skill batch configuration required');
export default defineConfig({...base,test:{...base.test,include:['tests/agent-runtime/skill-batch-real-model.live.ts'],exclude:[],fileParallelism:false}});
