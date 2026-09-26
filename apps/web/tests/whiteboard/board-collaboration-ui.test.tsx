import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createWhiteboardDocument, executeCommands, readObjects } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";
import { dispatchBoardCommentCommand, readBoardCommentThreads } from "@/components/whiteboard/board-comments";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects, onSelectionChange }: { objects: readonly BoardFabricObject[]; onSelectionChange: (ids: string[], source: "canvas") => void }) => <div data-testid="mock-surface"><button data-testid="select-object" onClick={() => onSelectionChange(objects[0] ? [objects[0].id] : [], "canvas")}>select</button></div>,
}));
class ResizeObserverMock { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(() => vi.clearAllMocks());

const boardId = "00000000-0000-4000-8000-000000000007";
const object = { id: "note", kind: "sticky" as const, schemaVersion: 1 as const, geometry: { x: 10, y: 20, width: 180, height: 140, rotation: 0 }, text: "协作想法", style: {}, parentId: null, orderKey: "" };
const peer = { actorId: "peer-1", displayName: "Grace", contributorColor: "#2563EB", cursor: { x: 90, y: 80 }, selected: ["note"], editingObjectId: "note", expiresAt: "2099-01-01T00:00:00.000Z" };

it("renders accessible contributor presence and supports object-bound comment, mention, reply and resolve", async () => {
  const doc = createWhiteboardDocument(); executeCommands(doc, [{ type: "create", object }], "fixture");
  render(<CollaborativeEditor boardId={boardId} clientId="client-1" currentUserId="owner-1" role="owner" doc={doc} readOnly={false} title="协作板" status="已同步" peers={[peer]} />);
  expect(screen.getByLabelText("Grace的光标")).toBeVisible();
  expect(screen.getByLabelText("Grace正在编辑协作想法")).toHaveStyle({ borderColor: "#2563EB" });
  fireEvent.click(screen.getByTestId("select-object")); fireEvent.click(screen.getByRole("button", { name: "评论" }));
  fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "请 Grace 看一下" } });
  fireEvent.change(screen.getByLabelText("提及成员"), { target: { value: "peer-1" } });
  fireEvent.click(screen.getByRole("button", { name: "发布评论" }));
  await waitFor(() => expect(readBoardCommentThreads(doc)).toHaveLength(1));
  expect(screen.getByTestId("board-comment-indicator-note")).toHaveAccessibleName("协作想法有 1 条评论");
  const panel = screen.getByTestId("board-comments-panel");
  expect(within(panel).getByText(/请 Grace 看一下/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "收到" } });
  fireEvent.click(screen.getByRole("button", { name: "回复" }));
  await waitFor(() => expect(readBoardCommentThreads(doc)[0]?.comments).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "标记解决" }));
  await waitFor(() => expect(readBoardCommentThreads(doc)[0]?.status).toBe("resolved"));
  expect(within(panel).getByText("已解决")).toBeVisible(); doc.destroy();
});

it("rejects invalid mentions and stale revisions without mutating shared comment state", () => {
  const doc = createWhiteboardDocument(); executeCommands(doc, [{ type: "create", object }], "fixture");
  const base = { doc, boardId, actorId: "owner-1", role: "owner" as const, mentionableIds: new Set(["owner-1", "peer-1"]) };
  expect(() => dispatchBoardCommentCommand({ ...base, command: { type: "create-comment", requestId: crypto.randomUUID(), threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), objectId: "note", body: "bad mention", mentions: [{ userId: "outsider" }], expectedRevision: 0 } })).toThrow("INVALID_MENTION");
  const threadId = crypto.randomUUID();
  dispatchBoardCommentCommand({ ...base, command: { type: "create-comment", requestId: crypto.randomUUID(), threadId, commentId: crypto.randomUUID(), objectId: "note", body: "first", mentions: [], expectedRevision: 0 } });
  expect(() => dispatchBoardCommentCommand({ ...base, command: { type: "reply", requestId: crypto.randomUUID(), threadId, commentId: crypto.randomUUID(), body: "stale", mentions: [], expectedRevision: 99 } })).toThrow("COMMENT_CONFLICT");
  expect(readBoardCommentThreads(doc)[0]?.comments).toHaveLength(1); doc.destroy();
});

it("keeps peer updates outside the local undo stack", async () => {
  const local = createWhiteboardDocument(), peerDoc = createWhiteboardDocument();
  const view = render(<CollaborativeEditor boardId={boardId} clientId="client-1" currentUserId="owner-1" doc={local} readOnly={false} role="owner" title="协作板" status="已同步" />);
  executeCommands(peerDoc, [{ type: "create", object: { ...object, id: "remote-note" } }], "peer");
  Y.applyUpdate(local, Y.encodeStateAsUpdate(peerDoc), Symbol("remote"));
  await waitFor(() => expect(readObjects(local).map(item => item.id)).toEqual(["remote-note"]));
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(readObjects(local).map(item => item.id)).toEqual(["remote-note"]);
  view.unmount(); local.destroy(); peerDoc.destroy();
});

it("archives object-bound comment threads in the same canonical delete transaction", () => {
  const doc = createWhiteboardDocument(); executeCommands(doc, [{ type: "create", object }], "fixture");
  dispatchBoardCommentCommand({ doc, boardId, actorId: "owner-1", role: "owner", mentionableIds: new Set(["owner-1"]), command: { type: "create-comment", requestId: crypto.randomUUID(), threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), objectId: "note", body: "bound", mentions: [], expectedRevision: 0 } });
  executeCommands(doc, [{ type: "delete", id: "note" }], "delete");
  expect(readBoardCommentThreads(doc)[0]).toMatchObject({ objectId: "note", status: "object-deleted", revision: 2, archivedAt: expect.any(String) });
  doc.destroy();
});
