import { guard } from "../../src/application/security/permission-filter";
import "reflect-metadata";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { auth } from "@repo/contracts";
import { AuthOrgController } from "../../src/interface/controllers/auth-org.controller";
import { PrincipalGuard } from "../../src/interface/guards/principal.guard";
import { toOrgId } from "../../src/domain/org-id";
import * as ports from "../../src/application/auth/ports";
import * as identity from "../../src/application/identity/ports";
import { CAPABILITY_REPOSITORY } from "../../src/application/identity/capability-ports";
import { OrganizationCreationConflict, ORGANIZATION_CREATION_REPOSITORY } from "../../src/application/auth/create-organization";
const create = vi.fn(async (input: { userId: string; requestId: string }) => ({ creatorId: input.userId, requestId: input.requestId, result: guard({ kind: "organization", id: "org-new" }, { orgId: "org-new", orgName: "新组织" }) }));
const credentials = { findByUserId: vi.fn(async () => ({ emailVerifiedAt: new Date() })) };
const tokens = [ports.SESSION_TOKEN_STORE, ports.CLOCK, identity.IDENTITY_REPOSITORY, identity.SESSION_STORE, identity.AUTHORIZATION_CACHE, CAPABILITY_REPOSITORY, identity.DECISION_ID_FACTORY, ports.REGISTRATION_REPOSITORY, ports.ORG_LIFECYCLE_REPOSITORY];
@Module({ controllers: [AuthOrgController], providers: [
  ...tokens.map(provide => ({ provide, useValue: {} })),
  { provide: ports.CREDENTIAL_REPOSITORY, useValue: credentials },
  { provide: ORGANIZATION_CREATION_REPOSITORY, useValue: { create } },
] })
class HttpModule {}
let app: INestApplication; let base: string;
beforeAll(async () => {
  app = await NestFactory.create(HttpModule, { logger: false });
  app.useGlobalGuards(new PrincipalGuard({ resolve: async headers => headers.authorization === "Bearer live" ? { userId: "authenticated-user", orgId: toOrgId("org-current") } : null }, new Reflector()));
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
afterAll(async () => { await app?.close(); });
const body = { orgName: " 新组织 ", requestId: "b9895d9f-e385-46c8-aa29-484dfda7cb02" };
async function post(value: unknown, token?: string) {
  return fetch(`${base}${auth.operations.createOrganization.path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) });
}
describe("protected organization creation HTTP contract", () => {
  it("anonymous and invalid/expired bearer cannot create", async () => {
    create.mockClear();
    for (const token of [undefined, "expired"]) expect((await post(body, token)).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
  it("body identity and tenant injection rejected; principal alone determines owner", async () => {
    create.mockClear();
    for (const extra of [{ userId: "victim" }, { orgId: "victim-org" }]) expect((await post({ ...body, ...extra }, "live")).status).toBe(400);
    const response = await post(body, "live"); expect(response.status).toBe(201);
    expect(auth.operations.createOrganization.out.parse(await response.json())).toEqual({ orgId: "org-new", orgName: "新组织" });
    expect(create).toHaveBeenCalledWith({ userId: "authenticated-user", orgName: "新组织", requestId: body.requestId });
  });
  it("maps retry name conflicts to a contracted 409 without leaking details", async () => {
    create.mockRejectedValueOnce(new OrganizationCreationConflict());
    const response = await post(body, "live");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ reasonCode: "ORGANIZATION_CREATION_CONFLICT" });
  });

});
