import {expect,it} from 'vitest';
import {SurveyMarkdownProposalInputSchema,SURVEY_PROPOSAL_FILE_MAX_BYTES} from '../src/survey-markdown-proposal';
it('requires an explicit input and one source',()=>{
 expect(SurveyMarkdownProposalInputSchema.safeParse({text:'  '}).success).toBe(false);
 expect(SurveyMarkdownProposalInputSchema.safeParse({file:{name:'source.md',base64:'YQ=='},transcriptionId:'recording'}).success).toBe(false);
 expect(SurveyMarkdownProposalInputSchema.parse({text:'  客户目标  '})).toEqual({text:'客户目标'});
});
it('rejects oversized file envelopes and arbitrary URL input',()=>{
 expect(SurveyMarkdownProposalInputSchema.safeParse({file:{name:'large.md',base64:'a'.repeat(Math.ceil(SURVEY_PROPOSAL_FILE_MAX_BYTES/3)*4+1)}}).success).toBe(false);
 expect(SurveyMarkdownProposalInputSchema.safeParse({text:'客户研究',url:'https://example.com/private'}).success).toBe(false);
});
