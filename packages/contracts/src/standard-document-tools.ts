import {z} from 'zod';
import {NativeSessionBindingRef,NativeSessionResolveInput} from './native-session-binding';
export const DOCUMENT_PARSE_LIMITS={timeoutMs:30000,responseBytes:32768} as const;
export const DOCUMENT_PARSE_TOOL='wx_document_parse';
export const DocumentParseInput=z.object({workspacePath:z.string().startsWith('/inputs/').max(4096),outputMode:z.literal('markdown').optional(),ocr:z.literal(false).optional()}).strict();
export const DocumentParseOutput=z.object({textPath:z.string().regex(/^\/workspace\/parsed-[a-f0-9-]{36}\/document\.md$/),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),textHash:z.string().regex(/^[a-f0-9]{64}$/),
 source:z.object({attachmentId:z.string().min(1).max(256),path:z.string().max(4096),mediaType:z.string().max(256),sizeBytes:z.number().int().nonnegative()}).strict(),
 warnings:z.array(z.enum(['markdown_only_no_page_coordinates','ocr_not_performed','tables_may_lose_layout'])).max(3)}).strict();
export const DocumentParseInvocation=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:NativeSessionBindingRef.shape.bindingId,toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolName:z.literal(DOCUMENT_PARSE_TOOL),toolArgs:DocumentParseInput}).strict();
