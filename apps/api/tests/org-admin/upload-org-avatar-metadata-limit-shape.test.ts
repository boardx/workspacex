/**
 * D4（2026-08-09 复核，评分卡打回项之一）—— `uploadAvatar` controller 方法在**元数据**
 * 层（`sizeBytes`/`contentType` 走查询串，经 `UPLOAD_ORG_AVATAR_SCHEMA.safeParse`）
 * 校验，早于 `readRawBody` + `uploadOrgAvatar` 用例的**真实字节**校验。
 *
 * 实测过的坏行为：6MB 文件（`declaredSizeBytes` 如实等于 6MB，超过契约 `.max(5MB)`）
 * 在 zod 这一步就被拦下，落成一个裸 `HttpException({ fields: [...] }, 400)`——用例里
 * `OrgAdminError("FILE_TOO_LARGE")` 那条分支根本没机会跑，响应体没有 `reasonCode`，
 * 前端 `uploadOrgAvatar` 调用方对应的 `FILE_TOO_LARGE` 文案分支因此永远死代码，
 * 用户看到的是「上传失败：400」。
 *
 * 本文件只测**这一层**（controller 的元数据 safeParse 分支），不重复
 * `upload-org-avatar-server-validated.test.ts` 已经测过的用例层真实字节校验——
 * 两层校验的失败码现在应该长成同一个形状（`toHttpException` 那一条），这里验的
 * 正是"两层同形"这件事本身。
 *
 * 不连真实 Postgres：`requireAdminRole` 需要的 `identity.findOrgMembership` 用内联桩，
 * 这条失败路径在到达 `readRawBody`/仓储之前就抛出，压根用不到真实 DB。
 */
import { describe, expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import { OrgAdminManagementController } from "../../src/interface/controllers/org-admin-management.controller";
import { toOrgId } from "../../src/domain/org-id";
import type { IdentityRepository } from "../../src/application/identity/ports";

const ORG = "org-i838-avatar-metadata";
const ADMIN = "u-i838-avatar-admin";

function buildController(): OrgAdminManagementController {
  const identity = {
    findOrgMembership: async () => ({ orgRole: "admin", teamId: null }),
  } as unknown as IdentityRepository;
  return new OrgAdminManagementController(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    identity,
    null as never,
    null as never,  // F160 token 额度仓储：本文件不调那三条路由,
    null as never,  // F162 限额规则仓储：本文件不调那五条路由
  );
}

function asRequest(): never {
  // 元数据校验失败的分支在到达 `readRawBody(req)` 之前就 throw——`req` 从未被读，
  // 这个占位不需要真的实现 `Request`。
  return {} as never;
}

describe("uploadAvatar controller —— 元数据层拒绝要长成用例层拒绝同一个形状", () => {
  it("声明的 sizeBytes 超过契约上限 —— 413 + reasonCode FILE_TOO_LARGE，不是裸 400", async () => {
    const controller = buildController();
    const principal = { userId: ADMIN, orgId: toOrgId(ORG) };

    await expect(
      controller.uploadAvatar(
        ORG,
        "avatar.png",
        String(6 * 1024 * 1024), // 6MB > 契约 5MB 上限
        "a".repeat(64),
        "image/png",
        asRequest(),
        principal,
      ),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(HttpException);
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(413);
      expect(ex.getResponse()).toMatchObject({ reasonCode: "FILE_TOO_LARGE" });
      return true;
    });
  });

  it("声明的 contentType 不在白名单 —— 415 + reasonCode UNSUPPORTED_CONTENT_TYPE，不是裸 400", async () => {
    const controller = buildController();
    const principal = { userId: ADMIN, orgId: toOrgId(ORG) };

    await expect(
      controller.uploadAvatar(
        ORG,
        "avatar.gif",
        String(1024),
        "a".repeat(64),
        "image/gif", // 契约枚举只有 png/jpeg/webp
        asRequest(),
        principal,
      ),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(HttpException);
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(415);
      expect(ex.getResponse()).toMatchObject({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
      return true;
    });
  });

  it("其余字段（filename 缺失）不是这两个已知业务码能表达的情况 —— 维持裸 400 `{ fields }`", async () => {
    const controller = buildController();
    const principal = { userId: ADMIN, orgId: toOrgId(ORG) };

    await expect(
      controller.uploadAvatar(
        ORG,
        "", // filename 校验失败（min(1)）
        String(1024),
        "a".repeat(64),
        "image/png",
        asRequest(),
        principal,
      ),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(HttpException);
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(400);
      const body = ex.getResponse() as { fields?: unknown };
      expect(Array.isArray(body.fields)).toBe(true);
      return true;
    });
  });
});
