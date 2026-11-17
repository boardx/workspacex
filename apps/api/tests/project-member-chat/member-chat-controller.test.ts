import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { ProjectMemberChatController, projectMemberChatEnabled } from "../../src/interface/controllers/project-member-chat.controller";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { ProjectMemberChatRepository } from "../../src/application/project-member-chat/ports";
import { ProjectMemberChatError } from "../../src/domain/project-member-chat/errors";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDecisionIds, FakeRoleViewRepository } from "../support/role-view-fakes";
const principal = { userId: "student", orgId: toOrgId("member-chat-controller") };
const projectId = "project-one";
const session: TenantSession = { query: async () => { throw new Error("unit test must not query a database"); } };
const db: DatabasePort = { withTenant: async (_org, work) => work(session),
  withoutTenant: async () => { throw new Error("global database use forbidden"); }, close: async () => {} };
const identity = new FakeRoleViewRepository({ student: { orgRole: "consultant", projectRole: "member" } });
function create() {
  const wrap = <T>(payload: T) => guard({ kind: "project", id: projectId }, payload);
  const repo: ProjectMemberChatRepository = {
    facts: vi.fn(async () => wrap({ projectStatus: "active" as const, orgStatus: "active" as const })),
    page: vi.fn(async () => wrap({ items: [], latestSequence: 0, nextAfterSequence: 0, nextBeforeSequence: null, threadUpdates: [] })),
    findMessage: vi.fn(async () => wrap(null)), post: vi.fn(async () => { throw new ProjectMemberChatError("IDEMPOTENCY_CONFLICT"); }),
  };
  return { controller: new ProjectMemberChatController(db, identity, new FakeDecisionIds(), repo), repo };
}
async function failure(request: Promise<unknown>, status: number, reasonCode: string) {
  try { await request; throw new Error("expected HTTP failure"); }
  catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toEqual({ reasonCode });
  }
}
afterEach(() => vi.unstubAllEnvs());
describe("member channel protocol adapter (no HTTP server/database)", () => {
  it("requires a principal", async () => {
    const { controller } = create();
    await expect(controller.list(projectId, {}, null!)).rejects.toMatchObject({ status: 401 });
  });
  it.each([undefined, "", "false", "0", "yes"])("is default-off for %s", async value => {
    vi.stubEnv("ENABLE_PROJECT_MEMBER_CHAT", value);
    expect(projectMemberChatEnabled()).toBe(false);
    const { controller, repo } = create();
    await failure(controller.list(projectId, {}, principal), 404, "MODULE_DISABLED");
    expect(repo.page).not.toHaveBeenCalled();
  });
  it("coerces numeric HTTP query parameters and supplies the default page size", async () => {
    vi.stubEnv("ENABLE_PROJECT_MEMBER_CHAT", "1");
    const { controller, repo } = create();
    expect(await controller.list(projectId, { afterSequence: "4", limit: "1" }, principal)).toMatchObject({ items: [], canWrite: true });
    expect(repo.page).toHaveBeenCalledWith({ ...principal, projectId }, { projectId, afterSequence: 4, limit: 1 });
    await controller.list(projectId, {}, principal);
    expect(repo.page).toHaveBeenLastCalledWith({ ...principal, projectId }, { projectId, limit: 30 });
  });
  it("keeps conflict machine-readable without disclosing stack or SQL", async () => {
    vi.stubEnv("ENABLE_PROJECT_MEMBER_CHAT", "true");
    const { controller } = create();
    await failure(controller.post(projectId, { clientMessageId: "11111111-1111-4111-8111-111111111111", text: "hello" }, principal), 409, "IDEMPOTENCY_CONFLICT");
  });
  it("distinguishes invalid input, excessive content and foreign thread roots", async () => {
    vi.stubEnv("ENABLE_PROJECT_MEMBER_CHAT", "1");
    const { controller } = create();
    await failure(controller.list(projectId, { beforeSequence: "2", afterSequence: "1" }, principal), 422, "INVALID_INPUT");
    await failure(controller.post(projectId, { text: "x".repeat(4001) }, principal), 413, "MESSAGE_TOO_LARGE");
    await failure(controller.replies(projectId, "22222222-2222-4222-8222-222222222222", {}, principal), 404, "NOT_FOUND");
  });
  it("uses the existing path project and rejects forged author fields", async () => {
    vi.stubEnv("ENABLE_PROJECT_MEMBER_CHAT", "1");
    const { controller, repo } = create();
    await failure(controller.post(projectId, { authorId: "teacher", clientMessageId: "11111111-1111-4111-8111-111111111111", text: "hello" }, principal), 422, "INVALID_INPUT");
    expect(repo.post).not.toHaveBeenCalled();
  });
});
