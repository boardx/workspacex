import {z} from 'zod';
import {NativeSessionBindingRef,NativeSessionResolveInput} from './native-session-binding';
import {limits as sandboxLimits} from './sandbox-session';
export const DOCUMENT_PARSE_LIMITS={timeoutMs:30000,responseBytes:32768} as const;
export const DOCUMENT_OCR_LIMITS={maxPages:10,maxPixels:4194304,maxDimension:2048,maxOutputBytes:sandboxLimits.maxFileBytes} as const;
export const DOCUMENT_PARSE_TOOL='wx_document_parse';
export const DocumentParseInput=z.object({workspacePath:z.string().startsWith('/inputs/').max(4096),outputMode:z.literal('markdown').optional(),ocr:z.boolean().optional()}).strict();
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const pixel=z.number().int().nonnegative().max(DOCUMENT_OCR_LIMITS.maxDimension);
export const DocumentOcrStructure=z.object({engine:z.literal('tesseract'),coordinateSpace:z.literal('rendered_page_pixels'),pages:z.array(z.object({
 pageNumber:z.number().int().min(1).max(DOCUMENT_OCR_LIMITS.maxPages),width:pixel.positive(),height:pixel.positive(),
 words:z.array(z.object({text:z.string().min(1),bbox:z.object({x:pixel,y:pixel,width:pixel,height:pixel}).strict(),confidence:z.number().min(0).max(100)}).strict()),
}).strict()).min(1).max(DOCUMENT_OCR_LIMITS.maxPages)}).strict();
const DocumentParseBaseOutput=z.object({textPath:z.string().regex(/^\/workspace\/parsed-[a-f0-9-]{36}\/document\.md$/),sourceHash:digest,textHash:digest,
 source:z.object({attachmentId:z.string().min(1).max(256),path:z.string().max(4096),mediaType:z.string().max(256),sizeBytes:z.number().int().nonnegative()}).strict(),
 warnings:z.array(z.enum(['markdown_only_no_page_coordinates','ocr_not_performed','tables_may_lose_layout','ocr_may_misrecognize_text'])).max(4)}).strict();
export const DocumentParseOutput=z.union([DocumentParseBaseOutput,DocumentParseBaseOutput.extend({structurePath:z.string().regex(/^\/workspace\/parsed-[a-f0-9-]{36}\/structure\.json$/),structureHash:digest}).strict()]);
export const DocumentParseInvocation=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:NativeSessionBindingRef.shape.bindingId,toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolName:z.literal(DOCUMENT_PARSE_TOOL),toolArgs:DocumentParseInput}).strict();
