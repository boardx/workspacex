import {z} from 'zod';import {NativeSessionResolveInput} from './native-session-binding';import {ChildCancellationStatus} from './run-control';
export const STANDARD_RUN_CANCEL_TOOL='wx_run_cancel' as const;
export const RunCancelInput=z.object({runId:z.string().min(1).max(256),reason:z.string().min(1).max(1000).optional(),idempotencyKey:z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/)}).strict();
export const RunCancelOutput=z.object({cancellationRequested:z.boolean(),finalStatus:z.literal('cancelled').optional(),childCancellation:ChildCancellationStatus}).strict();
const identity=NativeSessionResolveInput.omit({runId:true}).extend({toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional()});
export const StandardRunCancelInvocation=identity.extend({toolName:z.literal(STANDARD_RUN_CANCEL_TOOL),toolArgs:RunCancelInput}).strict();
