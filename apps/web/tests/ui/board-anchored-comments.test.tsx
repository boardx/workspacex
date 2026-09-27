import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WhiteboardCommentCommand, type WhiteboardCommentThread } from "@repo/contracts/whiteboard-collaboration";
import { createWhiteboardDocument, executeCommands } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

const comments = vi.hoisted(() => ({ threads: [] as WhiteboardCommentThread[] }));
const commentApi = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/components/whiteboard/board-comments", () => ({
  listBoardCommentThreads: vi.fn(async () => structuredClone(comments.threads)),
  dispatchBoardCommentCommand: commentApi.dispatch,
}));
vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange }: { objects: readonly BoardFabricObject[]; onSelectionChange: (ids: string[], source: "outline") => void }) => (
    <button data-testid="select-object" onClick={() => onSelectionChange(objects[0] ? [objects[0].id] : [], "outline")}>select</button>
  ),
}));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

const boardId = "00000000-0000-4000-8000-000000000007";
const object = {
  id: "comment-target",
  schemaVersion: 1 as const,
  kind: "sticky" as const,
  geometry: { x: 10, y: 20, width: 180, height: 140, rotation: 0 },
  text: "评论目标",
  style: {},
  parentId: null,
  orderKey: "a",
};

beforeEach(() => {
  comments.threads = [];
  commentApi.dispatch.mockReset();
  commentApi.dispatch.mockImplementation(async (requestedBoardId: string, command: { type: string; threadId: string; commentId: string; objectId: string | null; worldPosition?: { x: number; y: number } | null; body: string; mentions: string[] }) => {
    const now = "2026-09-27T00:00:00.000Z";
    comments.threads = [{
      id: command.threadId,
      boardId: requestedBoardId,
      objectId: command.objectId,
      worldPosition: command.worldPosition ?? null,
      status: "open",
      revision: 1,
      resolvedBy: null,
      resolvedAt: null,
      archivedAt: null,
      comments: [{
        id: command.commentId,
        threadId: command.threadId,
        boardId: requestedBoardId,
        objectId: command.objectId,
        worldPosition: command.worldPosition ?? null,
        parentCommentId: null,
        authorId: "commenter-1",
        body: command.body,
        mentions: command.mentions.map((userId) => ({ userId })),
        createdAt: now,
        deletedAt: null,
      }],
    }];
    return { operationId: crypto.randomUUID(), replayed: false, threads: structuredClone(comments.threads) };
  });
});
afterEach(cleanup);

it("lets a commenter create an object-anchored thread while keeping object editing read-only", async () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{ type: "create", object }], "fixture");
  render(<CollaborativeEditor boardId={boardId} clientId="commenter-client" currentUserId="commenter-1" role="commenter" doc={doc} readOnly title="协作板" status="已同步 · 只读" />);

  fireEvent.click(screen.getByTestId("select-object"));
  expect(screen.getByLabelText("对象文字")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "评论" }));
  fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "只评论，不编辑" } });
  expect(screen.getByRole("button", { name: "发布评论" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "发布评论" }));

  await waitFor(() => expect(commentApi.dispatch).toHaveBeenCalledTimes(1));
  expect(commentApi.dispatch.mock.calls[0]?.[1]).toMatchObject({
    type: "create-comment",
    objectId: "comment-target",
    worldPosition: null,
    body: "只评论，不编辑",
  });
  doc.destroy();
});

it("keeps object and world-position anchors mutually exclusive in the public command contract", () => {
  const base = { type: "create-comment", requestId: crypto.randomUUID(), threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), body: "anchor", mentions: [], expectedRevision: 0 } as const;
  expect(WhiteboardCommentCommand.safeParse({ ...base, objectId: "note-1", worldPosition: null }).success).toBe(true);
  expect(WhiteboardCommentCommand.safeParse({ ...base, objectId: null, worldPosition: { x: 320, y: 240 } }).success).toBe(true);
  expect(WhiteboardCommentCommand.safeParse({ ...base, objectId: "note-1", worldPosition: { x: 320, y: 240 } }).success).toBe(false);
  expect(WhiteboardCommentCommand.safeParse({ ...base, objectId: null, worldPosition: null }).success).toBe(false);
});
