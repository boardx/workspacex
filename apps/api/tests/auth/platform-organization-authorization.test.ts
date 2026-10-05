import { describe,expect,it,vi } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import type { ExecutionContext } from "@nestjs/common";
import { PlatformOperatorGuard } from "../../src/interface/guards/platform-operator.guard";
import { PlatformOrganizationController, SET_ORGANIZATION_PLAN_SCHEMA } from "../../src/interface/controllers/platform-organization.controller";
import { platformOrganizations as C } from "@repo/contracts";
import { platformOrgCatalogConfig } from "../../src/infrastructure/db/pg-config";

describe("platform organization admission contract",()=>{
 it("all catalog/detail/plan routes share the existing operator guard and contract body",()=>{
  expect(Reflect.getMetadata(GUARDS_METADATA,PlatformOrganizationController)).toContain(PlatformOperatorGuard);
  expect(SET_ORGANIZATION_PLAN_SCHEMA).toBe(C.operations.setPlan.in);
 });
 it("rejects ordinary org admins and outsiders before repository access",async()=>{
  const findByUserId=vi.fn().mockResolvedValue(null);
  const isPlatformAdmin=vi.fn().mockResolvedValue(false);
  const guard=new PlatformOperatorGuard({findByUserId} as never,{isPlatformAdmin} as never);
  const context={switchToHttp:()=>({getRequest:()=>({principal:{userId:"org-admin",orgId:"someone-elses-org"}})})} as ExecutionContext;
  await expect(guard.canActivate(context)).rejects.toMatchObject({status:403});
 });
 it("never defaults catalog credentials to app_rw",()=>{
  vi.stubEnv("PLATFORM_ORG_CATALOG_DB_USER",""); vi.stubEnv("PLATFORM_ORG_CATALOG_DB_PASSWORD","");
  expect(platformOrgCatalogConfig()).toBeNull();
  vi.stubEnv("PLATFORM_ORG_CATALOG_DB_USER","app_rw"); vi.stubEnv("PLATFORM_ORG_CATALOG_DB_PASSWORD","test-only");
  expect(platformOrgCatalogConfig).toThrow("catalog credential must be separate");
  vi.unstubAllEnvs();
 });
 it("bounds pagination and requires deliberate versioned plan edits with reason",()=>{
  expect(()=>C.operations.listOrganizations.in.parse({limit:51})).toThrow();
  expect(()=>C.operations.setPlan.in.parse({plan:"enterprise",expectedVersion:0,reason:""})).toThrow();
  expect(C.operations.listOrganizations.in.parse({})).toEqual({search:"",limit:25});
 });
});
