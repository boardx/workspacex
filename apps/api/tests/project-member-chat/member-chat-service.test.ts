/** Unit tests use canonical role decisions and an in-memory port; no PostgreSQL/model claim. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { operations as C } from "@repo/contracts/project-member-chat";
import { authorize } from "../../src/application/identity/authorize";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { ProjectMemberChatRepository, Viewer } from "../../src/application/project-member-chat/ports";
import { listMemberMessages, listMemberReplies, postMemberMessage, type ProjectMemberChatDeps } from "../../src/application/project-member-chat/service";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository, type FakeMembership } from "../support/role-view-fakes";
import type { NonWorkshopStandingRow } from "../../src/application/identity/ports";

const viewer: Viewer = { orgId: toOrgId("member-chat-unit"), userId: "student", projectId: "project-one" };
const message = { id: "11111111-1111-4111-8111-111111111111", projectId: viewer.projectId, sequence: 1,
  authorId: viewer.userId, clientMessageId: "22222222-2222-4222-8222-222222222222", text: "先讨论我们的观察",
  threadRootId: null, stageReference: null, createdAt: "2026-11-14T12:00:00.000Z" };
const pageInput = C.listMessages.in.parse({ projectId: viewer.projectId });
const postInput = C.postMessage.in.parse({ projectId: viewer.projectId, clientMessageId: message.clientMessageId, text: message.text });
const guarded = <T>(value: T) => guard({ kind: "project", id: viewer.projectId }, value);
const unusedSession: TenantSession = { query: async () => { throw new Error("unit test must not issue SQL"); } };
const db: DatabasePort = {
  withTenant: async (_org, work) => work(unusedSession),
  withoutTenant: async () => { throw new Error("tenant business must not use a global session"); }, close: async () => {},
};
class GeneralIdentity extends FakeRoleViewRepository {
  standing: NonWorkshopStandingRow | null = null;
  override async findNonWorkshopStanding() { return this.standing; }
}
let members: Record<string, FakeMembership>;
let identity: GeneralIdentity;
let repo: ProjectMemberChatRepository;
let deps: ProjectMemberChatDeps;
beforeEach(() => {
  members = { student: { orgRole: "consultant", projectRole: "member" } };
  identity = new GeneralIdentity(members);
  repo = {
    facts: vi.fn(async () => guarded({ projectStatus: "active" as const, orgStatus: "active" as const })),
    page: vi.fn(async () => guarded({ items: [message], threadUpdates: [], latestSequence: 1, nextAfterSequence: 1, nextBeforeSequence: null })),
    findMessage: vi.fn(async () => guarded(message)),
    post: vi.fn(async () => guarded({ message, replayed: false })),
  };
  deps = { db, auth: { repo: identity, ids: new FakeDecisionIds() }, repo, enabled: () => true };
});
describe("optional pure-human project channel", () => {
  it("stays default-disabled without reading or writing any dependency", async () => {
    deps = { ...deps, enabled: () => false };
    await expect(listMemberMessages(deps, viewer, pageInput)).rejects.toMatchObject({ reason: "MODULE_DISABLED" });
    await expect(postMemberMessage(deps, viewer, postInput)).rejects.toMatchObject({ reason: "MODULE_DISABLED" });
    expect(repo.facts).not.toHaveBeenCalled(); expect(repo.post).not.toHaveBeenCalled();
  });
  it("uses the canonical member role and returns persisted data without model work", async () => {
    expect(await listMemberMessages(deps, viewer, pageInput)).toMatchObject({ canWrite: true, readOnlyReason: null, items: [message] });
    expect(await postMemberMessage(deps, viewer, postInput)).toEqual({ message, replayed: false });
    expect(repo.post).toHaveBeenCalledWith(viewer, postInput);
  });
  it.each(["archived", "org-disabled"] as const)("keeps %s history readable and rejects sending/retry", async reason => {
    repo.facts = vi.fn(async () => guarded({ projectStatus: reason === "archived" ? "archived" : "active", orgStatus: reason === "org-disabled" ? "disabled" : "active" }));
    expect(await listMemberMessages(deps, viewer, pageInput)).toMatchObject({ canWrite: false, readOnlyReason: reason });
    await expect(postMemberMessage(deps, viewer, postInput)).rejects.toMatchObject({ reason: reason === "archived" ? "READ_ONLY_ARCHIVED" : "READ_ONLY_ORG_DISABLED" });
    expect(repo.post).not.toHaveBeenCalled();
  });
  it("allows a real observer to read but never send", async () => {
    members.student = { orgRole: "consultant", projectRole: "observer" };
    expect(await listMemberMessages(deps, viewer, pageInput)).toMatchObject({ canWrite: false, readOnlyReason: "role" });
    await expect(postMemberMessage(deps, viewer, postInput)).rejects.toMatchObject({ reason: "READ_ONLY_ROLE" });
  });
  it.each(["list", "post", "replies"])("org admin outside the general-project membership cannot %s", async action => {
    members.student = { orgRole: "admin", projectRole: null };
    identity.standing = { containerKind: "general", memberRole: null };
    // Prove the existing project-overview fallback DOES allow this actor. The
    // channel's actual-member requirement, not a fake missing project, must deny.
    expect((await authorize(deps.auth, { ...viewer, object: { kind: "project", id: viewer.projectId }, action: "read.published" })).allowed).toBe(true);
    const work = action === "list" ? listMemberMessages(deps, viewer, pageInput)
      : action === "post" ? postMemberMessage(deps, viewer, postInput)
        : listMemberReplies(deps, viewer, C.listReplies.in.parse({ projectId: viewer.projectId, threadRootId: message.id }));
    await expect(work).rejects.toMatchObject({ reason: "NOT_FOUND" });
    expect(repo.facts).not.toHaveBeenCalled(); expect(repo.page).not.toHaveBeenCalled();
  });
  it("preserves existing general-project owner/collaborator resolution", async () => {
    members.student = { orgRole: "consultant", projectRole: null };
    identity.standing = { containerKind: "general", memberRole: "collaborator" };
    expect(await postMemberMessage(deps, viewer, postInput)).toMatchObject({ replayed: false });
  });
  it("rechecks a removed member on incremental reads and message retry", async () => {
    await listMemberMessages(deps, viewer, pageInput);
    members.student = { orgRole: "consultant", projectRole: null };
    await expect(listMemberMessages(deps, viewer, { ...pageInput, afterSequence: 1 })).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(postMemberMessage(deps, viewer, postInput)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    expect(repo.post).not.toHaveBeenCalled();
  });
  it("rejects a removal observed while acquiring the member lock", async () => {
    repo.facts = vi.fn(async () => guarded(null));
    await expect(postMemberMessage(deps, viewer, postInput)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    expect(repo.post).not.toHaveBeenCalled();
  });
  it("re-evaluates a role demotion committed before the membership lock", async () => {
    repo.facts = vi.fn(async () => {
      members.student = { orgRole: "consultant", projectRole: "observer" };
      return guarded({ projectStatus: "active" as const, orgStatus: "active" as const });
    });
    await expect(postMemberMessage(deps, viewer, postInput)).rejects.toMatchObject({ reason: "READ_ONLY_ROLE" });
    expect(repo.post).not.toHaveBeenCalled();
  });
  it("separates dependency failure from a valid empty channel", async () => {
    repo.facts = vi.fn(async () => { throw new Error("private database details"); });
    await expect(listMemberMessages(deps, viewer, pageInput)).rejects.toMatchObject({ reason: "DEPENDENCY_UNAVAILABLE", message: "DEPENDENCY_UNAVAILABLE" });
    expect(repo.page).not.toHaveBeenCalled();
  });
  it("does not disclose another-project or nested topic root", async () => {
    const input = C.listReplies.in.parse({ projectId: viewer.projectId, threadRootId: message.id });
    repo.findMessage = vi.fn(async () => guarded(null));
    await expect(listMemberReplies(deps, viewer, input)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    repo.findMessage = vi.fn(async () => guarded({ ...message, threadRootId: "33333333-3333-4333-8333-333333333333" }));
    await expect(listMemberReplies(deps, viewer, input)).rejects.toMatchObject({ reason: "THREAD_ROOT_INVALID" });
  });
});
describe("member channel contract", () => {
  it("rejects incompatible cursors, oversized/blank text and forged identity", () => {
    expect(C.listMessages.in.safeParse({ projectId: "p", beforeSequence: 2, afterSequence: 1 }).success).toBe(false);
    expect(C.postMessage.in.safeParse({ ...postInput, text: "   " }).success).toBe(false);
    expect(C.postMessage.in.safeParse({ ...postInput, text: "x".repeat(4001) }).success).toBe(false);
    expect(C.postMessage.in.safeParse({ ...postInput, authorId: "another-student" }).success).toBe(false);
  });
  it("normalizes the retry payload and maintains stable UUID identity", () => {
    expect(C.postMessage.in.parse({ ...postInput, text: "  hello \n", clientMessageId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" })).toMatchObject({ text: "hello", clientMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  });
});
