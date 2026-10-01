import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { AgentStarterImportController } from "../../src/interface/controllers/agent-starter-import.controller";
import { SkillStarterImportController } from "../../src/interface/controllers/skill-starter-import.controller";
import { operations } from "../../../../packages/contracts/src/wave2-runtime";
import { toOrgId } from "../../src/domain/org-id";
const input = { packId: "official-role-pack", packVersion: "1.0.0", idempotencyKey: "enable-test", expectedOrgId: "org-a" };
describe("starter import organization binding before dependencies", () => {
  it.each(["agent", "skill"])("rejects an in-flight %s request resolved after the session switched organizations without any dependency access", async (kind) => {
    const accessed = vi.fn();
    const dependency = new Proxy({}, { get: () => accessed });
    const controller = kind === "agent"
      ? new AgentStarterImportController(dependency as never, dependency as never, dependency as never, dependency as never, dependency as never)
      : new SkillStarterImportController(dependency as never, dependency as never, dependency as never);
    // This is the immutable principal snapshot produced when the delayed HTTP request's
    // auth resolver runs AFTER switchCurrentOrganization updated the same session.
    await expect(controller.import({ userId: "admin", orgId: toOrgId("org-b") }, input, {} as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(accessed).not.toHaveBeenCalled();
  });
  it.each([operations.importSkillStarterPack.in, operations.importAgentStarterPack.in])("strictly accepts explicit scope and legacy input, rejecting invented scope fields", (schema) => {
    expect(schema.parse(input)).toEqual(input);
    const { expectedOrgId, ...legacy } = input;
    expect(schema.parse(legacy)).toEqual(legacy);
    expect(schema.safeParse({ ...input, orgId: "org-b" }).success).toBe(false);
    expect(schema.safeParse({ ...input, expectedOrgId: "" }).success).toBe(false);
  });
});

// Real HTTP request -> production PrincipalGuard -> production ZodBodyPipe -> controller.
// Only the session resolver is controlled so organization switching can win the race.
import { Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { PRINCIPAL_RESOLVER_PORT } from "../../src/application/ports/principal-resolver.port";
import { IDENTITY_REPOSITORY } from "../../src/application/identity/ports";
import { AGENT_STARTER_IMPORT_REPOSITORY, AGENT_STARTER_PACK_SOURCE, OFFICIAL_AGENT_ROLE_PACK_IMPORT_REPOSITORY, WORKFLOW_DEFINITION_STORE } from "../../src/application/agent-import/ports";
import { SKILL_STARTER_IMPORT_REPOSITORY, SKILL_STARTER_PACK_SOURCE } from "../../src/application/skill-import/ports";

it.each(["/admin/skills/starter-pack-imports", "/admin/agents/starter-pack-imports"])("rejects real in-flight HTTP %s after the same session switches org", async (path) => {
  let currentOrg = "org-a";
  let release!: () => void;
  let began!: () => void;
  const resolving = new Promise<void>((resolve) => { began = resolve; });
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const access = vi.fn();
  @Module({
    controllers: [AgentStarterImportController, SkillStarterImportController],
    providers: [
      { provide: APP_GUARD, useClass: PrincipalGuard },
      { provide: PRINCIPAL_RESOLVER_PORT, useValue: { resolve: async () => { began(); await paused; return { userId: "admin", orgId: toOrgId(currentOrg) }; } } },
      ...[IDENTITY_REPOSITORY, AGENT_STARTER_IMPORT_REPOSITORY, AGENT_STARTER_PACK_SOURCE, OFFICIAL_AGENT_ROLE_PACK_IMPORT_REPOSITORY, WORKFLOW_DEFINITION_STORE, SKILL_STARTER_IMPORT_REPOSITORY, SKILL_STARTER_PACK_SOURCE].map((provide) => ({ provide, useValue: { findOrgMembership: access, load: access, findExisting: access, persistVerified: access, isRegistered: access } })),
    ],
  })
  class ImportScopeHttpModule {}
  const app = await NestFactory.create(ImportScopeHttpModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  try {
    const response = fetch(`${await app.getUrl()}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer same-session-token" }, body: JSON.stringify(input) });
    await resolving;
    currentOrg = "org-b";
    release();
    expect((await response).status).toBe(403);
    expect(access).not.toHaveBeenCalled();
  } finally { release(); await app.close(); }
});
