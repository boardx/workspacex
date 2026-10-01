import { z } from 'zod';
export const SURVEY_PROPOSAL_FILE_MAX_BYTES=262144;
// Base64 plus worst-case JSON escaping of the bounded UTF-16 text/name and envelope.
export const SURVEY_PROPOSAL_BODY_MAX_BYTES=Math.ceil(SURVEY_PROPOSAL_FILE_MAX_BYTES/3)*4+20000*6+4096;
export const SurveyMarkdownProposalInputSchema=z.object({
  text:z.string().trim().max(20000).default(''),
  transcriptionId:z.string().min(1).max(200).optional(),
  file:z.object({name:z.string().min(1).max(200),base64:z.string().min(1).max(Math.ceil(SURVEY_PROPOSAL_FILE_MAX_BYTES/3)*4)}).strict().optional(),
}).strict().refine(value=>!!value.text||!!value.transcriptionId||!!value.file,'输入需求或选择文件/已保存的录音逐字稿')
  .refine(value=>!(value.file&&value.transcriptionId),'一次选择一个来源');
export const SurveyMarkdownProposalSchema=z.object({
  markdown:z.string().min(1).max(262144),
  execution:z.object({id:z.string().uuid(),provider:z.string().min(1),modelId:z.string().min(1),generatedAt:z.string().datetime()}).strict(),
  source:z.object({kind:z.enum(['text','transcription','file']),sha256:z.string().length(64),name:z.string().optional(),referenceId:z.string().optional()}).strict(),
}).strict();
export type SurveyMarkdownProposal=z.infer<typeof SurveyMarkdownProposalSchema>;
