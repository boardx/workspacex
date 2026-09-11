import {defineConfig} from 'vitest/config';
import base from './vitest.config';
if(!process.env.WX_NATIVE_SANDBOX_CONTAINER||!process.env.WX_PDF_PERF_EVIDENCE)throw new Error('explicit sandbox and evidence directory required');
export default defineConfig({...base,test:{...base.test,include:['tests/agent-runtime/pdf-perf-measure.live.ts'],exclude:[],fileParallelism:false,testTimeout:1_800_000,hookTimeout:600_000}});
