/**
 * `PlatformMemberController` 的四条路由都挂着门——这是 `lint-permission-paths` 允许
 * `pg-platform-member-repository.ts` 不走 `guard()` 的前提之一，而 `@UseGuards` 是元数据，
 * 直接调 controller 方法的测试（`platform-members-real.test.ts`）绕过 Nest 的守卫链，验不了它。
 * 这里读 Nest 的守卫元数据：
 *   · 类级 `PlatformOperatorGuard`（平台超管或落库的平台管理员皆可）覆盖全部四条路由；
 *   · `grantPlatformAdmin`/`revokePlatformAdmin` 额外叠一层方法级 `PlatformSuperuserGuard`
 *     ——只有真超管能授予/撤销这个角色，平台管理员自己不能（platform-admin-role delta）。
 *
 * 反证：一个没挂守卫的同形 controller 读到的是 `undefined`——断言不是恒真。
 */
import { describe, expect, it } from "vitest";
import { Controller, Get } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { PlatformMemberController } from "../../src/interface/controllers/platform-member.controller";
import { PlatformOperatorGuard } from "../../src/interface/guards/platform-operator.guard";
import { PlatformSuperuserGuard } from "../../src/interface/guards/platform-superuser.guard";
import { platformMembers as C } from "@repo/contracts";

@Controller()
class UnguardedLookalike {
  @Get("/platform/members")
  list() {
    return { members: [] };
  }
}

describe("PlatformMemberController guard wiring", () => {
  it("类级 @UseGuards 正是 PlatformOperatorGuard（覆盖全部四条路由）", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PlatformMemberController) as unknown[] | undefined;
    expect(guards).toContain(PlatformOperatorGuard);
  });

  it("grantPlatformAdmin / revokePlatformAdmin 额外叠一层方法级 PlatformSuperuserGuard——只有真超管能到这两条", () => {
    const grantGuards = Reflect.getMetadata(GUARDS_METADATA, PlatformMemberController.prototype.grantPlatformAdmin) as
      | unknown[]
      | undefined;
    const revokeGuards = Reflect.getMetadata(GUARDS_METADATA, PlatformMemberController.prototype.revokePlatformAdmin) as
      | unknown[]
      | undefined;
    expect(grantGuards).toContain(PlatformSuperuserGuard);
    expect(revokeGuards).toContain(PlatformSuperuserGuard);
  });

  it("list / setOrgRole 两条不带方法级 PlatformSuperuserGuard——平台管理员也能走", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformMemberController.prototype.list)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformMemberController.prototype.setOrgRole)).toBeUndefined();
  });

  it("反证：没挂守卫的同形 controller 读不到守卫元数据", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UnguardedLookalike)).toBeUndefined();
  });

  it("四条路由的路径来自契约（不是手抄的字符串）", () => {
    const listPath = Reflect.getMetadata("path", PlatformMemberController.prototype.list) as string;
    const setPath = Reflect.getMetadata("path", PlatformMemberController.prototype.setOrgRole) as string;
    const grantPath = Reflect.getMetadata("path", PlatformMemberController.prototype.grantPlatformAdmin) as string;
    const revokePath = Reflect.getMetadata("path", PlatformMemberController.prototype.revokePlatformAdmin) as string;
    expect(listPath).toBe(C.operations.listPlatformMembers.path);
    expect(setPath).toBe(C.operations.setPlatformMemberOrgRole.path);
    expect(grantPath).toBe(C.operations.grantPlatformAdmin.path);
    expect(revokePath).toBe(C.operations.revokePlatformAdmin.path);
  });
});
