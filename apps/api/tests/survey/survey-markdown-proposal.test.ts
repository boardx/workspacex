import { expect, it,vi } from 'vitest';
import { generateSurveyMarkdownProposal } from '../../src/application/survey/generate-markdown-proposal';

const markdown='# 客户反馈\n\n## feedback [open]\n请描述最近一次体验\n';
it('bounds model calls even if a provider ignores cancellation',async()=>{
 vi.useFakeTimers();
 try{
 const result=generateSurveyMarkdownProposal({model:{complete:async()=>new Promise(()=>{})},provider:'test',modelId:'model'},{text:'客户研究'});
 const failure=expect(result).rejects.toMatchObject({code:'SURVEY_AI_UNAVAILABLE'});
 await vi.advanceTimersByTimeAsync(60001);await failure;
 }finally{vi.useRealTimers();}
});
it('returns model Markdown for correction without writing a survey', async()=>{
  const result=await generateSurveyMarkdownProposal({model:{complete:async input=>{
    expect(input.user).toContain('客户近期体验');return {text:markdown};
  }},provider:'test-provider',modelId:'test-model'}, {text:'客户近期体验'});
  expect(result.markdown).toBe(markdown);
  expect(result.execution.modelId).toBe('test-model');
  expect(result.execution.id).toBeTruthy();
});
it('rejects malformed model output instead of replacing it with canned questions',async()=>{
  await expect(generateSurveyMarkdownProposal({model:{complete:async()=>({text:'{"questions":[]}'})},provider:'test',modelId:'model'},{text:'调研客户'})).rejects.toMatchObject({code:'SURVEY_AI_INVALID_MARKDOWN'});
});
it('fails closed when the configured provider is unavailable',async()=>{
  await expect(generateSurveyMarkdownProposal({model:{complete:async()=>{throw new Error('provider unavailable');}},provider:'test',modelId:'model'},{text:'调研客户'})).rejects.toMatchObject({code:'SURVEY_AI_UNAVAILABLE'});
});
