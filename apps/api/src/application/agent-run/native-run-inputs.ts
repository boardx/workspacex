import type { z } from 'zod';
import type { NativeInputManifest } from '@repo/contracts/native-session-binding';
import type { ExecutionAuthorityContext } from './tool-execution-authority';
export interface NativeRunInputSet {
  readonly manifest: z.infer<typeof NativeInputManifest>;
  readonly files: readonly { path: string; contentBase64: string }[];
}
/** Trusted current-run reader, never accepts model-selected attachment or storage identifiers. */
export interface NativeRunInputs {
  read(context: ExecutionAuthorityContext): Promise<NativeRunInputSet>;
}
