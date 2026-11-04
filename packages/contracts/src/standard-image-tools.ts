import {z} from 'zod';
import {limits} from './sandbox-session';
import {NativeSessionBindingRef,NativeSessionResolveInput} from './native-session-binding';
export const IMAGE_GENERATE_TOOL='wx_image_generate';
export const IMAGE_GENERATE_LIMITS={maxBytes:limits.maxFileBytes,downloadMs:15000,verifyMs:30000,deadlineMs:180000,responseBytes:32768,dimension:1024} as const;
export const ImageGenerateInput=z.object({prompt:z.string().min(1).max(16384),referenceAttachmentIds:z.array(z.string().min(1).max(256)).max(limits.maxFiles).optional(),sizeProfile:z.enum(['square','square-hd']),generationProfile:z.enum(['standard','complex','icon']).optional(),idempotencyKey:z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/)}).strict();
export const ImageGenerated=z.object({status:z.literal('generated'),workspacePath:z.string().regex(/^\/workspace\/generated-[a-f0-9]{64}\.(png|jpg)$/),mime:z.enum(['image/png','image/jpeg']),width:z.union([z.literal(1024),z.literal(2048)]),height:z.union([z.literal(1024),z.literal(2048)]),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().positive().max(IMAGE_GENERATE_LIMITS.maxBytes),modelRef:z.string().min(1).max(256),taskId:z.string().min(1).max(256)}).strict();
export const ImageGenerateInvocation=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:NativeSessionBindingRef.shape.bindingId,toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolName:z.literal(IMAGE_GENERATE_TOOL),toolArgs:ImageGenerateInput}).strict();

/** Single fixed dispatch mapping; prices are separately verified deployment configuration. */
export const IMAGE_PROFILE_ROUTING={
 standard:{modelId:'qwen-image-3.0',dimension:1024},
 complex:{modelId:'qwen-image-3.0-pro',dimension:2048},
 icon:{modelId:'z-image-turbo',dimension:1024},
} as const;
export function isRoutedImageModel(modelId:string):boolean{return Object.values(IMAGE_PROFILE_ROUTING).some(row=>row.modelId===modelId);}
export function resolveImageProfile(input:{sizeProfile:'square'|'square-hd';generationProfile?:'standard'|'complex'|'icon'}) {
 if(input.generationProfile==='icon'&&input.sizeProfile==='square-hd')throw new Error('image_profile_conflict');
 if(input.generationProfile==='icon')return IMAGE_PROFILE_ROUTING.icon;
 if(input.generationProfile==='complex'||input.sizeProfile==='square-hd')return IMAGE_PROFILE_ROUTING.complex;
 return IMAGE_PROFILE_ROUTING.standard;
}
