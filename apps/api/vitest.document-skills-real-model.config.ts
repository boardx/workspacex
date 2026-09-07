import { defineConfig } from "vitest/config";
for(const key of ['DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL','WX_NATIVE_SANDBOX_CONTAINER','WX_DOCUMENT_SKILLS_REAL_EVIDENCE'])if(!process.env[key])throw new Error(`missing explicit Office real-model setting: ${key}`);
export default defineConfig({ test: {include:["tests/agent-runtime/office-editing-real-model.live.ts"],environment:"node",fileParallelism:false,testTimeout:500000} });
