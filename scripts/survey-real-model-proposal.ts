/** Explicit real-provider evidence lane. Never substitutes the deterministic E2E provider. */
import { ConfiguredModelProvider,readModelProviderConfig } from '../apps/api/src/infrastructure/agent-run/configured-model-provider';
import { generateSurveyMarkdownProposal } from '../apps/api/src/application/survey/generate-markdown-proposal';
import { parseSurveyDesignMarkdown } from '@repo/contracts/survey-source';

async function main(){
 const provider=process.env.KERNEL_MODEL_PROVIDER??'';
 const modelId=process.env.KERNEL_SURVEY_MODEL_ID??process.env.KERNEL_DEFAULT_AGENT_MODEL_ID??process.env.KERNEL_MODEL_ID??'';
 if(!provider||provider==='loopback'||!modelId||!process.env.KERNEL_MODEL_API_KEY)throw new Error('Real model configuration required; no fallback.');
 const result=await generateSurveyMarkdownProposal({model:new ConfiguredModelProvider(readModelProviderConfig()),provider,modelId},
  {text:'请设计一份客户近期产品使用体验问卷，面向软件产品用户，包含五道中立的问题，单选、多选和开放题。不要生成答案或统计结果。'});
 const compiled=parseSurveyDesignMarkdown(result.markdown);
 if(!compiled.ok||compiled.draft.questions.length<3)throw new Error('Real model proposal failed survey compilation');
 process.stdout.write(JSON.stringify({lane:'real-model',execution:result.execution,source:result.source,questionCount:compiled.draft.questions.length,markdown:result.markdown})+'\n');
}
void main().catch(()=>{process.stderr.write('Real survey proposal verification failed (provider/configuration/compilation). No secrets or upstream body logged.\n');process.exitCode=1;});
