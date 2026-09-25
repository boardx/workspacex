/**
 * `GET /platform/access` —— 「我有没有平台运营准入」的自查路由（permissions-review delta，
 * 2026-09-20 人类要求：只有平台管理员看得到平台管理菜单）。
 *
 * 断言三件：
 *   ① 三种身份（超管 / 落库的平台管理员 / 普通用户）各自拿到什么答案——普通用户是
 *      `platformOperator: false` 的 **200**，不是 403（那正是这条路由存在的理由）。
 *   ② 这条路由**没有**挂 `PlatformOperatorGuard`：挂了就对普通用户 403，界面又回到
 *      「用错误当信号」。反证：`PlatformMemberController` 读得到那个守卫元数据。
 *   ③ 路径与出参由契约校验（`out.parse`），不是手抄。
 */
import { describe, expect, it } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { platformMembers as C } from "@repo/contracts";
import { PlatformAccessController } from "../../src/interface/controllers/platform-access.controller";
import { PlatformMemberController } from "../../src/interface/controllers/platform-member.controller";
import { PlatformOperatorGuard } from "../../src/interface/guards/platform-operator.guard";

type Creds = { findByUserId: (userId: string) => Promise<{ email: string } | null> };
type Admins = { isPlatformAdmin: (userId: string) => Promise<boolean>; listAdminUserIds: () => Promise<string[]> };

function controller(emailByUser: Record<string, string>, adminUserIds: string[]): PlatformAccessController {
  const credentials: Creds = {
    findByUserId: async (userId) => (emailByUser[userId] ? { email: emailByUser[userId]! } : null),
  };
  const platformAdmins: Admins = {
    isPlatformAdmin: async (userId) => adminUserIds.includes(userId),
    listAdminUserIds: async () => adminUserIds,
  };
  // 构造器只用这两个仓储的这两个方法；结构化桩比起一个 mock 框架更能说清依赖面。
  return new PlatformAccessController(credentials as never, platformAdmins as never);
}

const principal = (userId: string) => ({ userId, orgId: "org-x" }) as never;

describe("GET /platform/access", () => {
  it("平台超管（邮箱在白名单里）：三项分别为 true / false / true", async () => {
    process.env.PLATFORM_SUPERUSER_EMAILS = "boss@example.test";
    const out = await controller({ "u-boss": "boss@example.test" }, []).access(principal("u-boss"));
    expect(out).toEqual({ platformSuperuser: true, platformAdmin: false, platformOperator: true });
  });

  it("落库的平台管理员（不在白名单）：不是超管，但够格", async () => {
    process.env.PLATFORM_SUPERUSER_EMAILS = "boss@example.test";
    const out = await controller({ "u-ops": "ops@example.test" }, ["u-ops"]).access(principal("u-ops"));
    expect(out).toEqual({ platformSuperuser: false, platformAdmin: true, platformOperator: true });
  });

  it("普通用户：不够格的答案是 200 的 false，不是异常——界面靠它决定不画平台后台菜单", async () => {
    process.env.PLATFORM_SUPERUSER_EMAILS = "boss@example.test";
    const out = await controller({ "u-consultant": "someone@example.test" }, []).access(principal("u-consultant"));
    expect(out).toEqual({ platformSuperuser: false, platformAdmin: false, platformOperator: false });
  });

  it("白名单为空（未配置）时也不抛——所有人都只是不够格", async () => {
    delete process.env.PLATFORM_SUPERUSER_EMAILS;
    const out = await controller({ "u-x": "x@example.test" }, []).access(principal("u-x"));
    expect(out.platformOperator).toBe(false);
  });

  it("这条路由不挂 PlatformOperatorGuard（反证：PlatformMemberController 挂着）", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformAccessController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformAccessController.prototype.access)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformMemberController) as unknown[]).toContain(PlatformOperatorGuard);
  });

  it("路径来自契约，不是手抄的字符串", () => {
    const path = Reflect.getMetadata("path", PlatformAccessController.prototype.access) as string;
    expect(path).toBe(C.operations.getPlatformAccess.path);
  });
});
