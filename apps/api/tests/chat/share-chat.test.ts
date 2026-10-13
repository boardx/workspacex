import { describe, expect, it, vi } from "vitest";
import { chatShare as C } from "@repo/contracts";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
import { ChatShareService, ShareChangedError, shareHash, type ShareDeps } from "../../src/application/chat/share-chat";
import { ThreadNotVisibleError } from "../../src/application/chat/get-thread";
import { redactChatSharePath } from "../../src/domain/chat/share-path";

vi.mock("../../src/application/chat/resolve-visibility", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/application/chat/resolve-visibility")>(),
  resolveVisibility: vi.fn(async () => ({
    kind: "allow", actor: { projectRole: null }, base: {
      allowed: true, orgLayer: { role: "consultant", teamId: null, passed: true },
      projectLayer: null, scopeLayer: { scope: "org-wide", passed: true }, reasonCode: null, decisionId: "d",
    },
  })),
}));

function setup() {
  const orgId = toOrgId("org-share-unit");
  const snapshot: C.SnapshotValue = { title: "分享", messages: [{ authorKind: "human", text: "hello", createdAt: "2026-10-13T00:00:00.000Z", attachments: [] }] };
  const deps = {
    repo: { findOrganization: vi.fn(async () => ({ kind: "organization" })) },
    chat: {
      findThreadFacts: vi.fn(async () => ({ threadId: "t", createdBy: "owner", projectId: null })),
      findMessages: vi.fn(async () => guard({ kind: "project", id: "t" }, [
        { id: "m", body: "hello", authorKind: "human", createdAt: "2026-10-13T00:00:00.000Z", rawTranscript: false, reviewPending: false },
        { id: "raw", body: "SECRET TRANSCRIPT", authorKind: "human", rawTranscript: true },
        { id: "review", body: "SECRET REVIEW", authorKind: "agent", reviewPending: true },
      ])),
      findThreadPresentation: vi.fn(async () => ({ title: "分享" })),
    },
    shares: {
      insert: vi.fn(async () => ({ id: "s", createdAt: "now", revokedAt: null })),
      list: vi.fn(async () => []), revoke: vi.fn(async () => true),
      findByTokenHash: vi.fn(async (tokenHash: string) => ({
        id: "s", threadId: "t", createdBy: "owner", tokenHash, revokedAt: null, createdAt: "now",
        snapshot: guard({ kind: "project", id: "s" }, snapshot),
      })),
    },
    commands: { attachmentsByMessage: vi.fn(async () => new Map()) },
  };
  const service = new ChatShareService(deps as unknown as ShareDeps);
  return { deps, service, actor: { orgId, userId: "owner", threadId: "t" }, snapshot };
}
describe("public snapshot publication boundary", () => {
  it("exports only reviewed conversation messages, with no identities or run fields", async () => {
    const { service, actor } = setup();
    const { snapshot } = await service.preview(actor);
    expect(snapshot.messages).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|authorId|orgId|threadId|agentRunId/);
  });
  it("rejects publication and management by a reader who is not the creator", async () => {
    const { service, actor, deps } = setup();
    const reader = { ...actor, userId: "colleague" };
    await expect(service.preview(reader)).rejects.toBeInstanceOf(ThreadNotVisibleError);
    await expect(service.create(reader, "a".repeat(64))).rejects.toBeInstanceOf(ThreadNotVisibleError);
    await expect(service.revoke(reader, "s")).rejects.toBeInstanceOf(ThreadNotVisibleError);
    expect(deps.shares.insert).not.toHaveBeenCalled();
    expect(deps.shares.revoke).not.toHaveBeenCalled();
  });
  it("keeps personal-local organizations isolated from anonymous publication", async () => {
    const { service, actor, deps } = setup();
    deps.repo.findOrganization.mockResolvedValue({ kind: "personal-local" });
    await expect(service.preview(actor)).rejects.toBeInstanceOf(ThreadNotVisibleError);
    expect(deps.shares.insert).not.toHaveBeenCalled();
  });
  it("rejects changed content instead of silently sharing additional messages", async () => {
    const { service, actor, deps } = setup();
    await expect(service.create(actor, "b".repeat(64))).rejects.toBeInstanceOf(ShareChangedError);
    expect(deps.shares.insert).not.toHaveBeenCalled();
  });
  it("stores a hash, never the bearer secret, and reads using a separate snapshot", async () => {
    const { service, actor, deps } = setup();
    const preview = await service.preview(actor);
    const created = await service.create(actor, preview.revision);
    expect(C.Token.safeParse(created.token).success).toBe(true);
    const input = deps.shares.insert.mock.calls[0] as unknown as [unknown, { tokenHash: string }];
    expect(input[1].tokenHash).toBe(shareHash(created.token));
    expect(JSON.stringify(input)).not.toContain(created.token);
    expect((await service.read(created.token)).snapshot.messages[0]?.text).toBe("hello");
  });
  it("rejects revoked tokens and wrong hash even if the repository returns a row", async () => {
    const { service, deps } = setup();
    const token = "a".repeat(43);
    const found = await deps.shares.findByTokenHash(shareHash(token));
    deps.shares.findByTokenHash.mockResolvedValue({ ...found, revokedAt: "now" } as never);
    await expect(service.read(token)).rejects.toBeInstanceOf(ThreadNotVisibleError);
    deps.shares.findByTokenHash.mockResolvedValue({ ...found, tokenHash: "b".repeat(64) });
    await expect(service.read(token)).rejects.toBeInstanceOf(ThreadNotVisibleError);
  });
  it("rejects malformed tokens before a database lookup and redacts in-flight paths", async () => {
    const { service, deps } = setup();
    await expect(service.read("bad")).rejects.toBeInstanceOf(ThreadNotVisibleError);
    expect(deps.shares.findByTokenHash).not.toHaveBeenCalled();
    expect(redactChatSharePath("/chat/shares/" + "s".repeat(43))).toBe("/chat/shares/:token");
    expect(redactChatSharePath("/chat/threads/t/shares")).toBe("/chat/threads/t/shares");
  });
});
