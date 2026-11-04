import { IdentityController } from "../../src/interface/controllers/identity.controller";
import { ContractValidationError } from "../../src/interface/pipes/zod-body.pipe";
import { describe, expect, it, vi } from "vitest";
import { identity, provenance } from "@repo/contracts";
import { listOwnActivity } from "../../src/application/identity/list-own-activity";
import { toOrgId } from "../../src/domain/org-id";

const OMITTED_VALUE = "test-value-never-output";
const input = { userId: "me", orgId: toOrgId("my-org"), cursor: null, limit: 20 };
function event(type: string, detail: Record<string, unknown>) {
  return provenance.ProvenanceEvent.parse({ id: "event", type, actorId: "me", at: "2026-11-03T00:00:00Z", orgId: "my-org", target: { kind: "account", id: "me" }, detail });
}
function readerFor(type: string, detail: Record<string, unknown>) {
  return { query: vi.fn().mockResolvedValue({ events: [event(type, detail)], nextCursor: null }) };
}
describe("own activity opt-in presentation projection", () => {
  it("keeps legacy request response fields exact even when detail includes private fields", async () => {
    const reader = readerFor("profile-renamed", { displayName: "原文 Alice", password: OMITTED_VALUE });
    const result = await listOwnActivity({ reader }, input);
    expect(result.events[0]).toEqual({ eventId: "event", kind: "profile-renamed", occurredAt: "2026-11-03T00:00:00Z", summary: '显示名改为"原文 Alice"' });
    expect(reader.query).toHaveBeenCalledWith(input.orgId, { actorId: "me", limit: 20, cursor: undefined });
  });
  it.each([
    ["profile-renamed", { displayName: "原文 {name}", password: OMITTED_VALUE }, { displayName: "原文 {name}" }],
    ["profile-renamed", { displayName: 42 }, {}],
    ["avatar-changed", { cleared: true, artifactId: "private" }, { cleared: true }],
    ["avatar-changed", { cleared: "true" }, { cleared: false }],
    ["password-changed", { revokedSessionCount: 2, password: OMITTED_VALUE }, {}],
    ["team-created", { name: "原文 team", private: "private" }, { name: "原文 team" }],
    ["team-renamed", { name: "原文 team" }, { name: "原文 team" }],
    ["team-deleted", { name: null }, {}],
  ] as const)("whitelists display params for %s %#", async (kind, detail, params) => {
    const reader = readerFor(kind, detail);
    const result = await listOwnActivity({ reader }, { ...input, displayFormat: "structured-v1" });
    expect(identity.operations.listOwnActivity.out.safeParse(result).success).toBe(true);
    expect(result.events[0]?.display).toEqual({ code: kind, params });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain(OMITTED_VALUE);
    expect(reader.query).toHaveBeenCalledWith(input.orgId, { actorId: input.userId, limit: input.limit, cursor: undefined });
  });
  it("omits display for unsupported event kinds and retains the source summary", async () => {
    const kind = provenance.ProvenanceEventType.options.find((type) => !["profile-renamed", "avatar-changed", "password-changed", "team-created", "team-renamed", "team-deleted"].includes(type))!;
    const result = await listOwnActivity({ reader: readerFor(kind, { secret: OMITTED_VALUE }) }, { ...input, displayFormat: "structured-v1" });
    expect(result.events[0]).not.toHaveProperty("display");
    expect(result.events[0]?.summary).toBe(`执行了操作：${kind}`);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain(OMITTED_VALUE);
  });
});

it("rejects an unsupported presentation version as a contract validation 400", async () => {
  const controller = Object.create(IdentityController.prototype) as IdentityController;
  await expect(controller.ownActivity({ userId: input.userId, orgId: input.orgId }, undefined, undefined, "structured-v2"))
    .rejects.toBeInstanceOf(ContractValidationError);
});
