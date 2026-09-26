import type * as Y from 'yjs';
import { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import {
  BoardCommandPort,
  WhiteboardCommandOrigin,
  type BoardCommandAccepted,
  type BoardCommandEnvelope,
} from './command-port';
import { cloneDocument, objectMap, validateDocument } from './document';
import {
  parseContentObject,
  readContentObject,
  type CanonicalContentObject,
  type ContentObjectType,
} from './content-object-model';
export * from './content-object-model';

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
export interface CreateContentObjectInput {
  boardId: string; clientId: string; gestureId: string; id: string;
  geometry: WhiteboardObject['geometry']; text?: string; style?: WhiteboardObject['style'];
  parentId?: string | null; orderKey?: string; content: CanonicalContentObject;
  extensionData?: Record<string, unknown>;
}

function contractKind(content: CanonicalContentObject): WhiteboardObject['kind'] {
  if (content.type === 'drawing' || content.type === 'image') return content.type;
  if (content.type === 'shape' && content.variant === 'ellipse') return 'ellipse';
  if (content.type === 'shape' && ['rectangle', 'rounded-rectangle'].includes(content.variant)) return 'rectangle';
  return 'extension';
}

/** Creates exactly one canonical command and never allocates identity on behalf of its caller. */
export function createContentObjectEnvelope(input: CreateContentObjectInput): BoardCommandEnvelope {
  const content = parseContentObject(input.content);
  const previous = structuredClone(input.extensionData ?? {});
  const object = WhiteboardObject.parse({
    id: input.id, schemaVersion: 1, kind: contractKind(content), geometry: input.geometry,
    text: input.text ?? '', style: input.style ?? {}, parentId: input.parentId ?? null,
    orderKey: input.orderKey ?? '', extensionData: { ...previous, contentObject: content },
  });
  return { boardId: input.boardId, clientId: input.clientId, gestureId: input.gestureId, commands: [{ type: 'create', object }] };
}

export interface ReplaceContentObjectCommand { type: 'replace-content'; id: string; content: CanonicalContentObject; }
export interface ContentObjectCommandEnvelope { boardId: string; clientId: string; gestureId: string; command: ReplaceContentObjectCommand; }
export interface ContentObjectEvent {
  type: 'ContentObjectUpdated'; operationId: string; transactionId: string; objectId: string;
  before: CanonicalContentObject; after: CanonicalContentObject;
}
export interface ContentObjectAccepted extends BoardCommandAccepted { event: ContentObjectEvent; }

const acceptedByDocument = new WeakMap<Y.Doc, Map<string, { payload: string; result: ContentObjectAccepted }>>();
function identity(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new Error('CONTENT_COMMAND_INVALID'); return value; }

function applyReplace(doc: Y.Doc, command: ReplaceContentObjectCommand): { before: CanonicalContentObject; after: CanonicalContentObject } {
  if (command.type !== 'replace-content' || !ID.test(command.id)) throw new Error('CONTENT_COMMAND_INVALID');
  const item = objectMap(doc).get(command.id);
  if (!item) throw new Error('OBJECT_NOT_FOUND');
  const current = WhiteboardObject.parse({ ...item.toJSON(), id: command.id });
  const before = readContentObject(current); if (!before) throw new Error('CONTENT_OBJECT_NOT_FOUND');
  const after = parseContentObject(command.content);
  if (before.type !== after.type) throw new Error('CONTENT_OBJECT_TYPE_IMMUTABLE');
  const extension = structuredClone(current.extensionData ?? {});
  item.set('extensionData', { ...structuredClone(extension), contentObject: after });
  return { before, after };
}

/** Atomic edit boundary for rich object metadata; one envelope is one command, transaction and undo step. */
export class ContentObjectCommandPort {
  private readonly accepted: Map<string, { payload: string; result: ContentObjectAccepted }>;
  constructor(private readonly doc: Y.Doc) {
    this.accepted = acceptedByDocument.get(doc) ?? new Map();
    acceptedByDocument.set(doc, this.accepted);
  }
  dispatch(input: ContentObjectCommandEnvelope): ContentObjectAccepted {
    const boardId = identity(input?.boardId), clientId = identity(input?.clientId), gestureId = identity(input?.gestureId);
    const command = { type: 'replace-content' as const, id: identity(input?.command?.id), content: parseContentObject(input?.command?.content) };
    const key = JSON.stringify([boardId, clientId, gestureId]), payload = JSON.stringify(command);
    const previous = this.accepted.get(key);
    if (previous) { if (previous.payload !== payload) throw new Error('CONTENT_COMMAND_INVALID'); return structuredClone(previous.result); }
    const operationId = `operation:${key}`, transactionId = `transaction:${key}`;
    const origin = new WhiteboardCommandOrigin(boardId, clientId, gestureId, operationId, transactionId);
    const candidate = cloneDocument(this.doc);
    try { candidate.transact(() => applyReplace(candidate, command), origin); validateDocument(candidate); }
    finally { candidate.destroy(); }
    let change!: { before: CanonicalContentObject; after: CanonicalContentObject };
    this.doc.transact(() => { change = applyReplace(this.doc, command); }, origin);
    const result: ContentObjectAccepted = {
      operationId, transactionId, acceptedObjectIds: [command.id],
      event: { type: 'ContentObjectUpdated', operationId, transactionId, objectId: command.id, ...change },
    };
    this.accepted.set(key, { payload, result: structuredClone(result) });
    return result;
  }
}

/** Convenience composition keeps creation on the existing shared command boundary. */
export interface ContentObjectCreatedAccepted extends BoardCommandAccepted {
  event: { type: 'ObjectCreated'; operationId: string; transactionId: string; objectId: string; contentType: ContentObjectType };
}

export function createContentObject(port: BoardCommandPort, input: CreateContentObjectInput): ContentObjectCreatedAccepted {
  const envelope = createContentObjectEnvelope(input);
  const accepted = port.dispatch(envelope);
  const content = parseContentObject(input.content);
  return { ...accepted, event: { type: 'ObjectCreated', operationId: accepted.operationId, transactionId: accepted.transactionId, objectId: input.id, contentType: content.type } };
}
