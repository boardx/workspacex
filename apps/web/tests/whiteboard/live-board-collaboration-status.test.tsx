import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { WhiteboardConnectionState } from "@/lib/whiteboard-provider";

const harness = vi.hoisted(() => ({ state: null as ((value: WhiteboardConnectionState) => void) | null, retry: vi.fn(), close: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { userId: "owner-1" } }) }));
vi.mock("@/lib/live-whiteboard", () => ({ getBoard: vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000007", name: "协作板", ownerId: "owner-1", role: "owner", archived: false, createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z" })) }));
vi.mock("@/lib/whiteboard-provider", () => ({ WhiteboardProvider: class { constructor(_doc: unknown, _id: string, callback: (value: WhiteboardConnectionState) => void) { harness.state = callback; } awareness() {} retryNow = harness.retry; close = harness.close; } }));
vi.mock("@/components/whiteboard/collaborative-editor", () => ({ CollaborativeEditor: ({ status,commentsReadOnly }: { status: string;commentsReadOnly:boolean }) => <div data-testid="editor-status" data-comments-readonly={String(commentsReadOnly)}>{status}</div> }));

import { LiveBoard } from "@/components/whiteboard/live-board";
const online: WhiteboardConnectionState = { phase: "online", pending: 0, role: "owner", archived: false, peers: [], reason: null, retryAttempt: 0, duplicateAcks: 0, lastAckSequence: 12, lastAckReceipt:null };

beforeEach(() => { harness.state = null; harness.retry.mockClear(); harness.close.mockClear(); });

it("makes pending, retry and duplicate ACK recovery state visible and actionable", async () => {
  render(<LiveBoard boardId="00000000-0000-4000-8000-000000000007" />);
  await waitFor(() => expect(harness.state).not.toBeNull());
  expect(screen.getByTestId("board-sync-banner")).toHaveClass("shrink-0","relative");
  expect(screen.getByTestId("board-editor-region")).toHaveClass("relative","overflow-hidden");
  expect(screen.getByTestId("board-sync-banner")).toHaveTextContent("加密保存在此浏览器");
  harness.state?.({ ...online, phase: "offline", pending: 3, reason: "CONNECTION_LOST", retryAttempt: 2, duplicateAcks: 1 });
  expect(await screen.findByTestId("editor-status")).toHaveTextContent("第 2 次重连 · 3 项修改待确认");
  expect(screen.getByTestId("board-duplicate-ack")).toHaveTextContent("已忽略 1 个重复确认");
  fireEvent.click(screen.getByTestId("board-retry-sync")); expect(harness.retry).toHaveBeenCalledOnce();
  expect(screen.getByTestId("editor-status")).toHaveAttribute("data-comments-readonly","true");
  harness.state?.({ ...online, role:"commenter", pending: 0 });
  expect(await screen.findByTestId("editor-status")).toHaveTextContent("已同步 · 序列 12");
  expect(screen.getByTestId("editor-status")).toHaveAttribute("data-comments-readonly","false");
});
