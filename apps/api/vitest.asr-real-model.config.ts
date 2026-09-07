import {defineConfig} from 'vitest/config';
import base from './vitest.config';

if(!process.env.WX_ASR_REAL_EVIDENCE)throw new Error('explicit real ASR evidence directory required');
for(const key of ['KERNEL_ASR_PROVIDER','KERNEL_ASR_BASE_URL','KERNEL_ASR_API_KEY','KERNEL_ASR_MODEL']){
  if(!process.env[key])throw new Error(`missing ${key}`);
}

export default defineConfig({...base,test:{...base.test,include:['tests/agent-runtime/audio-asr-real-model.live.ts'],exclude:[],fileParallelism:false}});
