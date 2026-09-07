import {z} from 'zod';
import {limits} from './sandbox-session';
import {NativeSessionBindingRef,NativeSessionResolveInput} from './native-session-binding';
export const AUDIO_TRANSCRIBE_TOOL='wx_audio_transcribe';
export const AUDIO_TRANSCRIBE_LIMITS={maxBytes:limits.maxFileBytes,maxDurationMs:3600000,chunkDurationMs:30000,deadlineMs:240000,concurrency:4,decodeDeadlineMs:120000,maxTextBytes:262144,responseBytes:270336} as const;
export const AudioTranscribeInput=z.object({attachmentId:z.string().min(1).max(256),language:z.string().min(1).max(32).optional(),diarization:z.boolean().optional()}).strict();
export const AudioSegment=z.object({id:z.string().min(1).max(128),startMs:z.number().int().nonnegative(),endMs:z.number().int().positive().max(AUDIO_TRANSCRIBE_LIMITS.maxDurationMs),text:z.string().max(AUDIO_TRANSCRIBE_LIMITS.maxTextBytes)}).strict();
export const AudioTranscribed=z.object({workspacePath:z.string().regex(/^\/workspace\/transcribed-[a-f0-9]{64}\.json$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),segments:z.array(AudioSegment).min(1).max(AUDIO_TRANSCRIBE_LIMITS.maxDurationMs/AUDIO_TRANSCRIBE_LIMITS.chunkDurationMs),warnings:z.array(z.enum(['source_chunk_boundaries_not_word_timestamps','speaker_identity_unavailable','confidence_not_calibrated','no_recognized_speech','some_chunks_without_recognized_speech'])).max(5)}).strict();
export const AudioTranscribeInvocation=NativeSessionResolveInput.omit({runId:true}).extend({bindingId:NativeSessionBindingRef.shape.bindingId,toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional(),toolName:z.literal(AUDIO_TRANSCRIBE_TOOL),toolArgs:AudioTranscribeInput}).strict();

export const AudioDecodedChunk=z.object({path:z.string(),startMs:z.number().int().nonnegative(),endMs:z.number().int().positive(),sizeBytes:z.number().int().positive(),frames:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const AudioDecodedChunks=z.array(AudioDecodedChunk).min(1).max(AUDIO_TRANSCRIBE_LIMITS.maxDurationMs/AUDIO_TRANSCRIBE_LIMITS.chunkDurationMs);
