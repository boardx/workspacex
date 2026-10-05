import {z} from 'zod';
/** Non-realtime Qwen-TTS multimodal-generation dialect; other TTS protocols are separate. */
export const BILLING_MODES=['character','audio-token'] as const;
export const Request=z.object({model:z.string().min(1).max(200),input:z.object({
 text:z.string().min(1),voice:z.string().min(1).max(200),
 language_type:z.enum(['Auto','Chinese','English','German','Italian','Portuguese','Spanish','Japanese','Korean','French','Russian']).optional(),
}).strict()}).strict();
export type RequestInput=z.infer<typeof Request>;
export type BillingMode=typeof BILLING_MODES[number];
