import type * as Y from 'yjs';
import { WhiteboardCommandBatch, type WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import { executeCommands } from './document';

export interface BoardCommandEnvelope {
  boardId: string;
  clientId: string;
  gestureId: string;
  commands: readonly WhiteboardCommand[];
}

export interface BoardCommandAccepted {
  operationId: string;
  transactionId: string;
  acceptedObjectIds: string[];
}

/** Transaction origin shared by renderer, undo and Yjs observers. */
export class WhiteboardCommandOrigin {
  readonly kind = 'whiteboard-command';
  constructor(
    readonly boardId: string,
    readonly clientId: string,
    readonly gestureId: string,
    readonly operationId: string,
    readonly transactionId: string,
  ) {}
}

type AcceptedGesture = { payload: string; result: BoardCommandAccepted };
type ApplyCommands = (commands: WhiteboardCommand[], origin: WhiteboardCommandOrigin) => void;

const acceptedByDocument = new WeakMap<Y.Doc, Map<string, AcceptedGesture>>();

function requiredIdentity(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new Error('BOARD_COMMAND_INVALID');
  return value;
}

function identity(parts: readonly string[]): string {
  // JSON tuple encoding is unambiguous even when an id contains punctuation.
  return JSON.stringify(parts);
}

/**
 * Canonical local command boundary. Idempotency is scoped to the Y.Doc lifetime;
 * durable collaboration ACK/replay remains the responsibility of the host.
 */
export class BoardCommandPort {
  private readonly accepted: Map<string, AcceptedGesture>;
  constructor(
    private readonly doc: Y.Doc,
    private readonly applyCommands: ApplyCommands = (commands, origin) => executeCommands(doc, commands, origin),
  ) {
    const existing = acceptedByDocument.get(doc);
    this.accepted = existing ?? new Map();
    if (!existing) acceptedByDocument.set(doc, this.accepted);
  }

  dispatch(input: BoardCommandEnvelope): BoardCommandAccepted {
    const boardId = requiredIdentity(input?.boardId);
    const clientId = requiredIdentity(input?.clientId);
    const gestureId = requiredIdentity(input?.gestureId);
    const commands = WhiteboardCommandBatch.parse(input?.commands);
    const gestureKey = identity([boardId, clientId, gestureId]);
    const payload = JSON.stringify(commands);
    const previous = this.accepted.get(gestureKey);
    if (previous) {
      if (previous.payload !== payload) throw new Error('BOARD_COMMAND_INVALID');
      return structuredClone(previous.result);
    }

    const operationId = `operation:${gestureKey}`;
    const transactionId = `transaction:${gestureKey}`;
    const origin = new WhiteboardCommandOrigin(boardId, clientId, gestureId, operationId, transactionId);
    this.applyCommands(commands, origin);
    const result: BoardCommandAccepted = {
      operationId,
      transactionId,
      acceptedObjectIds: [...new Set(commands.map(command => command.type === 'create' ? command.object.id : command.id))],
    };
    this.accepted.set(gestureKey, { payload, result: structuredClone(result) });
    return result;
  }
}
