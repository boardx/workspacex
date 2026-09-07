import {z} from 'zod';
import {NativeInputManifest} from './native-session-binding';
import {ToolExecutionCheckInput} from './run-control';
/** Parent session's attested attachment entry; never parsed from task prose. */
export const DelegatedInputFile=NativeInputManifest.innerType().element;
export const NativeFileDelegationCheckInput=ToolExecutionCheckInput.extend({
 toolName:z.literal('read_file'),toolCallId:z.string().min(1).max(256),
 toolArgs:z.record(z.unknown()),file:DelegatedInputFile,
}).strict();
export const NativeFileDelegationCheckOutput=z.object({allowed:z.literal(true)}).strict();
