import {defineConfig} from 'vitest/config';
import base from './vitest.config';
if(!process.env.WX_NATIVE_SANDBOX_CONTAINER||!process.env.WX_AUDIO_REAL_EVIDENCE)throw new Error('explicit real-model audio evidence configuration required');
export default defineConfig({...base,test:{...base.test,include:['tests/agent-runtime/generated-skill-real-model.live.ts'],exclude:[],fileParallelism:false}});
