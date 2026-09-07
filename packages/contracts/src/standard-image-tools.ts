import {z} from 'zod';
import {limits} from './sandbox-session';
import {NativeSessionBindingRef,NativeSessionResolveInput} from './native-session-binding';
export const IMAGE_GENERATE_TOOL='wx_image_generate';
export const IMAGE_GENERATE_LIMITS={maxBytes:limits.maxFileBytes,downloadMs:15000,verifyMs:30000,deadlineMs:180000,responseBytes:32768,dimension:1024} as const;
export const ImageGenerateInput=z.object({prompt:z.string().min(1).max(16384),referenceAttachmentIds:z.array(z.string().min(1).max(256)).max(limits.maxFiles).optional(),sizeProfile:z.literal('square'),idempotencyKey:z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/)}).strict();
export const ImageGenerated=z.object({status:z.literal('generated'),workspacePath:z.string().regex(/^\/workspace\/generated-[a-f0-9]{64}\.(png|jpg)$/),mime:z.enum(['image/png','image/jpeg']),width:z.literal(IMAGE_GENERATE_LIMITS.dimension),height:z.literal(IMAGE_GENERATE_LIMITS.dimension),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().positive().max(IMAGE_GENERATE_LIMITS.maxBytes),modelRef:z.string().min(1).max(256),taskId:z.string().min(1).max(256)}).strict();
export const ImageGenerateInvocation=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:NativeSessionBindingRef.shape.bindingId,toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolName:z.literal(IMAGE_GENERATE_TOOL),toolArgs:ImageGenerateInput}).strict();
