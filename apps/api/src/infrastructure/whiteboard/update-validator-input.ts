import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import type { WhiteboardDeletionProof, WhiteboardDeletionChange } from '../../application/whiteboard/collaboration-ports';

/** Internal structured-clone protocol; never import the worker entry point for types. */
export type WorkerValidationInput =
  | { mode: 'compensate'; snapshot: Uint8Array; before: Uint8Array }
  | { mode: 'restore-deletion'; snapshot: Uint8Array; proof: WhiteboardDeletionProof[]; changes?: WhiteboardDeletionChange[]; inverseUpdate?: Uint8Array }
  | { mode: 'objects'; snapshot: Uint8Array }
  | { mode: 'object-ids'; snapshot: Uint8Array }
  | { mode: 'update'; snapshot: Uint8Array; update: Uint8Array }
  | { mode: 'commands'; snapshot: Uint8Array; commands: WhiteboardCommand[] }
  | { mode: 'diff'; snapshot: Uint8Array; vector?: Uint8Array };
