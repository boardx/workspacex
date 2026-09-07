import type {z} from 'zod';
import type {AudioTranscribed,AudioTranscribeInput} from '@repo/contracts/standard-audio-tools';
import type {ExecutionAuthorityContext} from './tool-execution-authority';
export const STANDARD_AUDIO_SERVICE=Symbol('STANDARD_AUDIO_SERVICE');
export type AudioContext=ExecutionAuthorityContext & {readonly bindingId:string;readonly toolCallId:string};
export interface StandardAudioService {
 transcribe(context:AudioContext,input:z.infer<typeof AudioTranscribeInput>):Promise<z.infer<typeof AudioTranscribed>>;
}
