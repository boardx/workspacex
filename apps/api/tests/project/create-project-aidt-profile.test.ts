import { describe, expect, it, vi } from "vitest";
import { project } from "@repo/contracts";
import { createProject, type CreateProjectInput } from "../../src/application/project/create-project";
import type { CreateProjectCommand, ProjectRepository } from "../../src/application/project/ports";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { ProjectController, CREATE_PROJECT_SCHEMA } from "../../src/interface/controllers/project.controller";
import { canManageProjectLifecycle, creationFingerprint } from "../../src/domain/project/create-project-rules";

const base = { orgId: toOrgId("aidt-atomic-unit-org"), actorId: "qa-consultant", kind: "general", name: "Same name", blueprintVersionId: null };
function setup(role: string | null = "consultant") {
  const create = vi.fn(async (_cmd: CreateProjectCommand) => ({ id: "prj-owned-test", kind: "general" as const, status: "active" as const }));
  const membership = vi.fn(async () => role === null ? null : { orgRole: role, teamId: null });
  return { create, membership, deps: { repo: { create } as unknown as ProjectRepository, identity: { findOrgMembership: membership } as unknown as IdentityRepository } };
}

describe("controlled AIDT project creation", () => {
  it("keeps the legacy request and its fingerprint unchanged", async () => {
    const { actorId: _actor, ...body } = base;
    expect(project.operations.createProject.in.parse(body)).toEqual(body);
    expect(creationFingerprint(base)).toBe("ea1629ad726571b97e59d341ba4cee84075afc93d86b511b74e57bdde8da491d");
    const { deps, create } = setup(); await createProject(deps, base);
    expect(create.mock.calls[0]![0]).not.toHaveProperty("profile");
  });

  it("accepts the single controlled profile and rejects arbitrary fields", () => {
    const { actorId: _actor, ...body } = base;
    expect(project.operations.createProject.in.parse({ ...body, profile: "aidt" }).profile).toBe("aidt");
    for (const extra of [{ tags: ["workspacex:aidt"] }, { ownerId: "another-user" }, { actorId: "another-user" }, { projectId: "existing-project" }]) {
      expect(project.operations.createProject.in.safeParse({ ...body, profile: "aidt", ...extra }).success).toBe(false);
    }
    expect(project.PROJECT_CREATION_PROFILE_TAGS.aidt).toBe("workspacex:aidt");
  });

  it.each([null, "", "other", false, {}, []])("rejects invalid profile %j at schema and application boundaries", async profile => {
    const { actorId: _actor, ...body } = base;
    expect(project.operations.createProject.in.safeParse({ ...body, profile }).success).toBe(false);
    const { deps, membership, create } = setup();
    await expect(createProject(deps, { ...base, profile } as unknown as CreateProjectInput)).rejects.toMatchObject({ reasonCode: "INVALID_CREATION_PROFILE" });
    expect(membership).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it.each([{ kind: "workshop", blueprintVersionId: null }, { kind: "general", blueprintVersionId: "a-blueprint" }, { kind: "general", blueprintVersionId: "" }])("rejects incompatible profile combination %j before any lookup or write", async over => {
    const { deps, membership, create } = setup();
    await expect(createProject(deps, { ...base, ...over, profile: "aidt" })).rejects.toMatchObject({ reasonCode: "INVALID_CREATION_PROFILE" });
    expect(membership).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it("lets an ordinary member create without granting tag/lifecycle administration", async () => {
    const { deps, create } = setup();
    await expect(createProject(deps, { ...base, profile: "aidt" })).resolves.toMatchObject({ id: "prj-owned-test", kind: "general" });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0]).toMatchObject({ actorId: base.actorId, orgId: base.orgId, profile: "aidt", blueprintBinding: null, fingerprint: creationFingerprint({ ...base, profile: "aidt" }) });
    expect(canManageProjectLifecycle("consultant")).toBe(false);
  });

  it.each([null, "compliance"])("does not widen creation rights for %s", async role => {
    const { deps, create } = setup(role);
    await expect(createProject(deps, { ...base, profile: "aidt" })).rejects.toMatchObject({ reasonCode: "ORG_ROLE_INSUFFICIENT" });
    expect(create).not.toHaveBeenCalled();
  });

  it("fails closed when membership cannot be read", async () => {
    const { deps, membership, create } = setup(); membership.mockRejectedValueOnce(new Error("synthetic identity outage"));
    await expect(createProject(deps, { ...base, profile: "aidt" })).rejects.toMatchObject({ reasonCode: "AUTH_SERVICE_UNAVAILABLE" });
    expect(create).not.toHaveBeenCalled();
  });

  it("passes validated profile and server principal through the existing controller", async () => {
    const { deps, create } = setup();
    const controller = Object.assign(Object.create(ProjectController.prototype), { repo: deps.repo, identity: deps.identity }) as ProjectController;
    const body = CREATE_PROJECT_SCHEMA.parse({ orgId: base.orgId, name: base.name, kind: base.kind, blueprintVersionId: null, profile: "aidt" });
    await expect(controller.create(body, { userId: base.actorId, orgId: base.orgId })).resolves.toEqual({ id: "prj-owned-test", kind: "general", status: "active" });
    expect(create.mock.calls[0]![0]).toMatchObject({ actorId: base.actorId, profile: "aidt" });
  });

  it("projects incompatible profile combinations as a structured HTTP 400", async () => {
    const { deps, create } = setup();
    const controller = Object.assign(Object.create(ProjectController.prototype), { repo: deps.repo, identity: deps.identity }) as ProjectController;
    const body = CREATE_PROJECT_SCHEMA.parse({ orgId: base.orgId, name: base.name, kind: "workshop", blueprintVersionId: null, profile: "aidt" });
    const error = await controller.create(body, { userId: base.actorId, orgId: base.orgId }).catch((error: { getStatus(): number; getResponse(): unknown }) => ({ status: error.getStatus(), response: error.getResponse() }));
    expect(error).toEqual({ status: 400, response: { reasonCode: "INVALID_CREATION_PROFILE" } });
    expect(create).not.toHaveBeenCalled();
  });

  it("separates same-name ordinary/AIDT requests while retaining AIDT replay identity", () => {
    const aidt = creationFingerprint({ ...base, profile: "aidt" });
    expect(aidt).not.toBe(creationFingerprint(base));
    expect(creationFingerprint({ ...base, profile: "aidt" })).toBe(aidt);
    expect(creationFingerprint({ ...base, actorId: "another-actor", profile: "aidt" })).not.toBe(aidt);
    expect(creationFingerprint({ ...base, orgId: "another-org", profile: "aidt" })).not.toBe(aidt);
  });
});
