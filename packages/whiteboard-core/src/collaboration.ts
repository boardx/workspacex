import type { Board } from '@repo/contracts/whiteboard';
import {
  WHITEBOARD_COLLABORATION_LIMITS,
  WhiteboardCheckpointManifest,
  WhiteboardCommentCommand,
  WhiteboardCommentThread,
  type WhiteboardCollaborationEvent,
} from '@repo/contracts/whiteboard-collaboration';

export type CollaborationRole = Board['role'];
export interface CollaborationActor { actorId: string; role: CollaborationRole; }
export interface CollaborationAccepted { operationId: string; replayed: boolean; threads: WhiteboardCommentThread[]; events: WhiteboardCollaborationEvent[]; }
export interface CollaborationDependencies {
  objectExists(objectId: string): boolean;
  isMentionable(userId: string): boolean;
  now(): Date;
  uuid(): string;
}

type Replay = { payload: string; accepted: CollaborationAccepted };
const clone = <T>(value: T): T => structuredClone(value);
const canonicalValue = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalValue(entry)])) : value;
const canonical = (value: unknown): string => JSON.stringify(canonicalValue(value));

/**
 * Canonical comment operation boundary shared by humans and agents. Durable adapters
 * persist returned threads/events atomically; transient presence deliberately lives elsewhere.
 */
export class WhiteboardCommentService {
  private readonly threads = new Map<string, WhiteboardCommentThread>();
  private readonly requests = new Map<string, Replay>();
  constructor(private readonly boardId: string, private readonly dependencies: CollaborationDependencies, initialThreads: readonly WhiteboardCommentThread[] = []) {
    for (const value of initialThreads) { const thread=WhiteboardCommentThread.parse(value); if(thread.boardId!==boardId||this.threads.has(thread.id))throw new Error('COMMENT_CONFLICT');this.threads.set(thread.id,clone(thread)); }
  }

  list(actor: CollaborationActor, includeObjectDeleted = false): WhiteboardCommentThread[] {
    this.actor(actor);
    return [...this.threads.values()]
      .filter(thread => includeObjectDeleted || thread.status !== 'object-deleted')
      .map(thread => clone(thread));
  }

  dispatch(actor: CollaborationActor, raw: unknown): CollaborationAccepted {
    this.actor(actor);
    const command = WhiteboardCommentCommand.parse(raw);
    const key = `${actor.actorId}:${command.requestId}`, payload = canonical(command);
    const replay = this.requests.get(key);
    if (replay) {
      if (replay.payload !== payload) throw new Error('IDEMPOTENCY_CONFLICT');
      return { ...clone(replay.accepted), replayed: true };
    }
    const now = this.dependencies.now().toISOString(), operationId = this.dependencies.uuid();
    const events: WhiteboardCollaborationEvent[] = [];
    const changed: WhiteboardCommentThread[] = [];
    if (command.type === 'create-comment') {
      if (!this.dependencies.objectExists(command.objectId)) throw new Error('OBJECT_NOT_FOUND');
      if (this.threads.has(command.threadId)) throw new Error('COMMENT_CONFLICT');
      if ([...this.threads.values()].filter(thread=>thread.objectId===command.objectId).length>=WHITEBOARD_COLLABORATION_LIMITS.threadsPerObject) throw new Error('COMMENT_LIMIT');
      this.mentions(command.mentions.map(value => value.userId));
      const thread = WhiteboardCommentThread.parse({
        id: command.threadId, boardId: this.boardId, objectId: command.objectId, status: 'open', revision: 1,
        resolvedBy: null, resolvedAt: null, archivedAt: null,
        comments: [{ id: command.commentId, threadId: command.threadId, boardId: this.boardId, objectId: command.objectId,
          parentCommentId: null, authorId: actor.actorId, body: command.body, mentions: command.mentions, createdAt: now, deletedAt: null }],
      });
      this.threads.set(thread.id, thread); changed.push(thread);
      events.push(this.event('CommentCreated', actor.actorId, operationId, now, { threadId: thread.id, commentId: command.commentId, objectId: thread.objectId }));
    } else if (command.type === 'archive-object-comments') {
      if (actor.role === 'viewer') throw new Error('FORBIDDEN');
      const affected = [...this.threads.values()].filter(thread => thread.objectId === command.objectId && thread.status !== 'object-deleted');
      for (const thread of affected) {
        thread.status = 'object-deleted'; thread.archivedAt = now; thread.revision++; changed.push(thread);
      }
      events.push(this.event('ObjectCommentsArchived', actor.actorId, operationId, now, { objectId: command.objectId, threadIds: affected.map(value => value.id) }));
    } else {
      const thread = this.threads.get(command.threadId);
      if (!thread || thread.status === 'object-deleted') throw new Error('COMMENT_NOT_FOUND');
      if (thread.revision !== command.expectedRevision) throw new Error('COMMENT_CONFLICT');
      if (command.type === 'reply') {
        if (thread.status === 'resolved') throw new Error('COMMENT_RESOLVED');
        if (thread.comments.length >= WHITEBOARD_COLLABORATION_LIMITS.commentsPerThread) throw new Error('COMMENT_LIMIT');
        if (thread.comments.some(value => value.id === command.commentId)) throw new Error('COMMENT_CONFLICT');
        this.mentions(command.mentions.map(value => value.userId));
        thread.comments.push({ id: command.commentId, threadId: thread.id, boardId: this.boardId, objectId: thread.objectId,
          parentCommentId: thread.comments[0]!.id, authorId: actor.actorId, body: command.body,
          mentions: clone(command.mentions), createdAt: now, deletedAt: null });
        thread.revision++; changed.push(thread);
        events.push(this.event('CommentReplied', actor.actorId, operationId, now, { threadId: thread.id, commentId: command.commentId, objectId: thread.objectId }));
      } else if (command.type === 'resolve') {
        if (actor.role === 'viewer') throw new Error('FORBIDDEN');
        thread.status = command.resolved ? 'resolved' : 'open'; thread.resolvedBy = command.resolved ? actor.actorId : null;
        thread.resolvedAt = command.resolved ? now : null; thread.revision++; changed.push(thread);
        events.push(this.event('CommentResolved', actor.actorId, operationId, now, { threadId: thread.id, resolved: command.resolved }));
      } else {
        const comment = thread.comments.find(value => value.id === command.commentId);
        if (!comment || comment.deletedAt) throw new Error('COMMENT_NOT_FOUND');
        if (actor.role !== 'owner' && comment.authorId !== actor.actorId) throw new Error('FORBIDDEN');
        // Preserve a tombstone for audit/reply identity; erase user text and mentions.
        comment.body = '[deleted]'; comment.mentions = []; comment.deletedAt = now; thread.revision++; changed.push(thread);
        events.push(this.event('CommentDeleted', actor.actorId, operationId, now, { threadId: thread.id, commentId: comment.id }));
      }
    }
    const accepted = { operationId, replayed: false, threads: changed.map(clone), events: events.map(clone) };
    this.requests.set(key, { payload, accepted: clone(accepted) });
    return accepted;
  }

  private actor(actor: CollaborationActor): void {
    if (!actor?.actorId || actor.actorId.length > 200 || !['owner', 'editor', 'viewer'].includes(actor.role)) throw new Error('FORBIDDEN');
  }
  private mentions(ids: string[]): void {
    if (new Set(ids).size !== ids.length || ids.some(id => !this.dependencies.isMentionable(id))) throw new Error('INVALID_MENTION');
  }
  private event<T extends WhiteboardCollaborationEvent['type']>(type: T, actorId: string, operationId: string, occurredAt: string,
    detail: Omit<Extract<WhiteboardCollaborationEvent, { type: T }>, 'type' | 'eventId' | 'operationId' | 'boardId' | 'actorId' | 'occurredAt'>): Extract<WhiteboardCollaborationEvent, { type: T }> {
    return { type, eventId: this.dependencies.uuid(), operationId, boardId: this.boardId, actorId, occurredAt, ...detail } as Extract<WhiteboardCollaborationEvent, { type: T }>;
  }
}

export interface PresenceInput { actorId: string; displayName: string; contributorColor: string; cursor: { x: number; y: number } | null; selected: string[]; editingObjectId: string | null; }
export interface PresenceState extends PresenceInput { expiresAt: string; }

/** Process-local awareness registry. Nothing here can be serialized as board content. */
export class WhiteboardPresenceRegistry {
  private readonly states = new Map<string, { state: PresenceState; updatedAt: number }>();
  constructor(private readonly ttlMs: number = WHITEBOARD_COLLABORATION_LIMITS.presenceTtlMs, private readonly minimumIntervalMs: number = WHITEBOARD_COLLABORATION_LIMITS.presenceMinimumIntervalMs) {}
  update(raw: PresenceInput, now = Date.now()): PresenceState | null {
    if (!raw.actorId || raw.actorId.length > 200 || !raw.displayName || raw.displayName.length > WHITEBOARD_COLLABORATION_LIMITS.displayNameChars
      || !/^#[0-9a-fA-F]{6}$/.test(raw.contributorColor) || raw.selected.length > WHITEBOARD_COLLABORATION_LIMITS.selectionIds
      || new Set(raw.selected).size !== raw.selected.length || !Number.isFinite(raw.cursor?.x ?? 0) || !Number.isFinite(raw.cursor?.y ?? 0)) throw new Error('PRESENCE_INVALID');
    const previous = this.states.get(raw.actorId);
    if (previous && now - previous.updatedAt < this.minimumIntervalMs) return null;
    const state = { ...clone(raw), expiresAt: new Date(now + this.ttlMs).toISOString() };
    this.states.set(raw.actorId, { state, updatedAt: now }); return clone(state);
  }
  list(now = Date.now()): PresenceState[] { this.sweep(now); return [...this.states.values()].map(value => clone(value.state)); }
  remove(actorId: string): void { this.states.delete(actorId); }
  sweep(now = Date.now()): void { for (const [id, entry] of this.states) if (Date.parse(entry.state.expiresAt) <= now) this.states.delete(id); }
}

const hex = (bytes: Uint8Array): string => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
export async function checkpointHash(bytes: Uint8Array): Promise<string> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > WHITEBOARD_COLLABORATION_LIMITS.checkpointBytes) throw new Error('CHECKPOINT_INVALID');
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  return `sha256:${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer)))}`;
}
export async function verifyCheckpoint(manifest: WhiteboardCheckpointManifest, bytes: Uint8Array): Promise<void> {
  const parsed = WhiteboardCheckpointManifest.parse(manifest);
  if (parsed.byteSize !== bytes.byteLength || parsed.contentHash !== await checkpointHash(bytes)) throw new Error('CHECKPOINT_HASH_MISMATCH');
}
export function restoredHead(current: { epoch: number; seq: number }, checkpoint: WhiteboardCheckpointManifest): { epoch: number; seq: 0; restoredFrom: { epoch: number; seq: number; checkpointId: string } } {
  const parsed = WhiteboardCheckpointManifest.parse(checkpoint);
  if (parsed.epoch > current.epoch || (parsed.epoch === current.epoch && parsed.seq > current.seq)) throw new Error('CHECKPOINT_AHEAD');
  if (!Number.isSafeInteger(current.epoch) || current.epoch < 1 || current.epoch === Number.MAX_SAFE_INTEGER) throw new Error('EPOCH_EXHAUSTED');
  return { epoch: current.epoch + 1, seq: 0, restoredFrom: { epoch: parsed.epoch, seq: parsed.seq, checkpointId: parsed.checkpointId } };
}
