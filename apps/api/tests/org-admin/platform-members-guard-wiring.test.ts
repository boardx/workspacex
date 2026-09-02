/**
 * `PlatformMemberController` 的两条路由**都**挂在 `PlatformSuperuserGuard` 后面——这是
 * `lint-permission-paths` 允许 `pg-platform-member-repository.ts` 不走 `guard()` 的前提之一，
 * 而 `@UseGuards` 是元数据，直接调 controller 方法的测试（`platform-members-real.test.ts`）
 * 绕过 Nest 的守卫链，验不了它。这里读 Nest 的守卫元数据，断言类级守卫存在且正是那一个。
 *
 * 反证：一个没挂守卫的同形 controller 读到的是 `undefined`——断言不是恒真。
 */
import { describe, expect, it } from "vitest";
import { Controller, Get } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { PlatformMemberController } from "../../src/interface/controllers/platform-member.controller";
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
  it("类级 @UseGuards 正是 PlatformSuperuserGuard（覆盖 list 与 setOrgRole 两条路由）", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PlatformMemberController) as unknown[] | undefined;
    expect(guards).toContain(PlatformSuperuserGuard);
  });

  it("反证：没挂守卫的同形 controller 读不到守卫元数据", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UnguardedLookalike)).toBeUndefined();
  });

  it("两条路由的路径来自契约（不是手抄的字符串）", () => {
    const listPath = Reflect.getMetadata("path", PlatformMemberController.prototype.list) as string;
    const setPath = Reflect.getMetadata("path", PlatformMemberController.prototype.setOrgRole) as string;
    expect(listPath).toBe(C.operations.listPlatformMembers.path);
    expect(setPath).toBe(C.operations.setPlatformMemberOrgRole.path);
  });
});
