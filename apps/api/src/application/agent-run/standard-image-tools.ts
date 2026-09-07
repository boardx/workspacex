import type {z} from 'zod';
import type {ImageGenerateInput,ImageGenerated} from '@repo/contracts/standard-image-tools';
import type {ExecutionAuthorityContext} from './tool-execution-authority';
import type {DraftSessionFiles} from './skill-draft';
import type {DocumentSession} from './standard-document-tools';
export const STANDARD_IMAGE_SERVICE=Symbol('StandardImageService');
export type ImageContext=ExecutionAuthorityContext&{bindingId:string;toolCallId:string};
export interface StandardImageService{generate(context:ImageContext,input:z.infer<typeof ImageGenerateInput>):Promise<z.infer<typeof ImageGenerated>>}
export interface ImageGenerator{readonly modelRef:string;generateImage(prompt:string,signal?:AbortSignal):Promise<{url:string;taskId:string;modelRef:string}>}
export type ImageSession=DraftSessionFiles&Pick<DocumentSession,'execute'>;
export interface GeneratedImageDownloader{download(url:string,signal:AbortSignal):Promise<{bytes:Uint8Array;mime:'image/png'|'image/jpeg'}>}
