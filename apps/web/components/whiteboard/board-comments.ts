import type * as Y from "yjs";
import { WHITEBOARD_COLLABORATION_LIMITS, WhiteboardCommentCommand, WhiteboardCommentThread, type WhiteboardCommentThread as CommentThread } from "@repo/contracts/whiteboard-collaboration";
import { readObjects } from "@repo/whiteboard-core";

const ROOT = "commentThreads";
export const BOARD_COMMENT_ORIGIN = Symbol("board-comment");
const clone = <T,>(value: T): T => structuredClone(value);

function map(doc: Y.Doc) { return doc.getMap<unknown>(ROOT); }

export function readBoardCommentThreads(doc: Y.Doc): CommentThread[] {
  return [...map(doc).values()].flatMap((value) => {
    const parsed = WhiteboardCommentThread.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }).sort((left, right) => left.comments[0]!.createdAt.localeCompare(right.comments[0]!.createdAt));
}

export function dispatchBoardCommentCommand(input: {
  doc: Y.Doc; boardId: string; actorId: string; role: "owner" | "editor" | "viewer";
  mentionableIds: ReadonlySet<string>; command: unknown; now?: Date;
}): CommentThread[] {
  const command = WhiteboardCommentCommand.parse(input.command);
  if (!input.actorId || input.actorId.length > 200) throw new Error("FORBIDDEN");
  const threads = map(input.doc), current = readBoardCommentThreads(input.doc);
  const now = (input.now ?? new Date()).toISOString();
  const checkMentions = (mentions: Array<{ userId: string }>) => {
    if (new Set(mentions.map(item => item.userId)).size !== mentions.length || mentions.some(item => !input.mentionableIds.has(item.userId))) throw new Error("INVALID_MENTION");
  };
  const changed: CommentThread[] = [];
  if (command.type === "create-comment") {
    if (!readObjects(input.doc).some(object => object.id === command.objectId)) throw new Error("OBJECT_NOT_FOUND");
    if (threads.has(command.threadId)) throw new Error("COMMENT_CONFLICT");
    if (current.filter(thread => thread.objectId === command.objectId).length >= WHITEBOARD_COLLABORATION_LIMITS.threadsPerObject) throw new Error("COMMENT_LIMIT");
    checkMentions(command.mentions);
    changed.push(WhiteboardCommentThread.parse({ id: command.threadId, boardId: input.boardId, objectId: command.objectId, status: "open", revision: 1, resolvedBy: null, resolvedAt: null, archivedAt: null,
      comments: [{ id: command.commentId, threadId: command.threadId, boardId: input.boardId, objectId: command.objectId, parentCommentId: null, authorId: input.actorId, body: command.body, mentions: command.mentions, createdAt: now, deletedAt: null }] }));
  } else if (command.type === "archive-object-comments") {
    if (input.role === "viewer") throw new Error("FORBIDDEN");
    changed.push(...current.filter(thread => thread.objectId === command.objectId && thread.status !== "object-deleted").map(thread => ({ ...thread, status: "object-deleted" as const, archivedAt: now, revision: thread.revision + 1 })));
  } else {
    const thread = current.find(item => item.id === command.threadId);
    if (!thread || thread.status === "object-deleted") throw new Error("COMMENT_NOT_FOUND");
    if (thread.revision !== command.expectedRevision) throw new Error("COMMENT_CONFLICT");
    if (command.type === "reply") {
      if (thread.status === "resolved") throw new Error("COMMENT_RESOLVED");
      if (thread.comments.length >= WHITEBOARD_COLLABORATION_LIMITS.commentsPerThread) throw new Error("COMMENT_LIMIT");
      if (thread.comments.some(item => item.id === command.commentId)) throw new Error("COMMENT_CONFLICT");
      checkMentions(command.mentions);
      changed.push({ ...thread, revision: thread.revision + 1, comments: [...thread.comments, { id: command.commentId, threadId: thread.id, boardId: input.boardId, objectId: thread.objectId, parentCommentId: thread.comments[0]!.id, authorId: input.actorId, body: command.body, mentions: clone(command.mentions), createdAt: now, deletedAt: null }] });
    } else if (command.type === "resolve") {
      if (input.role === "viewer") throw new Error("FORBIDDEN");
      changed.push({ ...thread, status: command.resolved ? "resolved" : "open", resolvedBy: command.resolved ? input.actorId : null, resolvedAt: command.resolved ? now : null, revision: thread.revision + 1 });
    } else {
      const comment = thread.comments.find(item => item.id === command.commentId);
      if (!comment || comment.deletedAt) throw new Error("COMMENT_NOT_FOUND");
      if (input.role !== "owner" && comment.authorId !== input.actorId) throw new Error("FORBIDDEN");
      changed.push({ ...thread, revision: thread.revision + 1, comments: thread.comments.map(item => item.id === comment.id ? { ...item, body: "[deleted]", mentions: [], deletedAt: now } : item) });
    }
  }
  input.doc.transact(() => { for (const thread of changed) threads.set(thread.id, WhiteboardCommentThread.parse(thread)); }, BOARD_COMMENT_ORIGIN);
  return changed.map(clone);
}
