/**
 * #4227 —— `getThread` 不再恒回 `citations: []`：agent 消息挂着 `chat_citations` 行时，
 * 按契约 `Citation` 形状（含 `citationId`，前端 `openCitation` 据此上报）下发。
 * 反证：人类消息不取引用；仓储未实现批量读（既有替身）⇒ 仍为 []；取数带的是调用方组织。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chat as C } from "@repo/contracts";
import { guard } from "../../src/application/security/permission-filter";
import type { ChatCitationRow, ChatMessageRow, ChatRepository } from "../../src/application/chat/ports";
import { toOrgId } from "../../src/domain/org-id";

vi.mock("../../src/application/chat/resolve-visibility", () => ({
  resolveVisibility: vi.fn(async () => ({
    kind: "allow",
    decisionId: "d1",
    decision: { allowed: true },
    thread: { threadId: "t1", projectId: null, groupId: null, visibilityScope: "member-private", createdBy: "u1", archived: false },
    actor: { userId: "u1", projectRole: null, groupId: null },
    base: { allowed: true, decisionId: "d1" },
  })),
}));

const { getThread } = await import("../../src/application/chat/get-thread");

const ORG = toOrgId("org-a");
const msg = (id: string, authorKind: "human" | "agent"): ChatMessageRow => ({
  id, authorKind, authorId: authorKind === "agent" ? "agent-1" : "u1", agentId: authorKind === "agent" ? "agent-1" : null,
  body: "b", reviewPending: false, createdAt: "2026-09-26T00:00:00.000Z", rawTranscript: false,
} as unknown as ChatMessageRow);

const cite = (messageId: string, index: number): ChatCitationRow => ({
  citationId: `cit-${messageId}-${index}`, messageId, index, sourceFullName: `来源${index}`,
  anchorKind: "page", anchorPage: index + 1, anchorRange: null, anchorMessageId: null, sourceArtifactId: `art-${index}`,
});

let findBatch: ReturnType<typeof vi.fn>;
function deps(withBatch = true) {
  const chat = {
    findMessages: vi.fn(async () => guard({ kind: "thread", id: "t1" } as never, [msg("h1", "human"), msg("a1", "agent"), msg("a2", "agent")])),
    findThreadPresentation: vi.fn(async () => ({ phase: "onsite", lastActivityAt: "2026-09-26T00:00:00.000Z", version: 1, title: null })),
    ...(withBatch ? { findCitationsForMessages: findBatch } : {}),
  } as unknown as ChatRepository;
  return { chat, repo: {} as never, ids: { next: () => "d" } as never };
}

beforeEach(() => {
  findBatch = vi.fn(async () => [cite("a1", 1), cite("a1", 2)]);
});

describe("getThread · 引用下发", () => {
  it("agent 消息带回 chat_citations，形状符合契约且含 citationId", async () => {
    const out = await getThread(deps(), { userId: "u1", orgId: ORG, projectId: null, threadId: "t1" });
    const a1 = out.messages.find(m => m.id === "a1")!;
    expect(a1.citations).toEqual([
      { citationId: "cit-a1-1", index: 1, sourceFullName: "来源1", anchor: { kind: "page", page: 2, range: null, messageId: null } },
      { citationId: "cit-a1-2", index: 2, sourceFullName: "来源2", anchor: { kind: "page", page: 3, range: null, messageId: null } },
    ]);
    expect(out.messages.find(m => m.id === "a2")!.citations).toEqual([]);
    expect(out.messages.find(m => m.id === "h1")!.citations).toEqual([]);
    // 契约是 strict：多一个字段（例如 sourceArtifactId）就过不了。
    expect(C.operations.getThread.out.safeParse(out).success).toBe(true);
  });

  it("只为 agent 消息、按调用方组织批量取一次", async () => {
    await getThread(deps(), { userId: "u1", orgId: ORG, projectId: null, threadId: "t1" });
    expect(findBatch).toHaveBeenCalledTimes(1);
    expect(findBatch).toHaveBeenCalledWith(ORG, ["a1", "a2"]);
  });

  it("仓储没有批量读（既有替身）⇒ citations 仍为 []，不报错", async () => {
    const out = await getThread(deps(false), { userId: "u1", orgId: ORG, projectId: null, threadId: "t1" });
    expect(out.messages.every(m => m.citations.length === 0)).toBe(true);
  });
});
