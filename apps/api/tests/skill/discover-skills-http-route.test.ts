/**
 * #1865 —— `/admin/skills/url-imports/discover` **从 HTTP 真的可达**。
 *
 * 与 `url-import-http-route.test.ts` 同一条纪律：不只测"存在"（404 也是一种
 * "答了"），要证明真实容器里绑的是带两道 SSRF 门的取回器，且授权排在取回之前。
 * 与那个文件的差别：本用例不落库，所以这里没有 `counts()` 那一套——不需要证
 * "库里什么都没留下"，因为这条路径从来不写库。
 *
 * ## ⚠ 本文件不证明"一次成功的真实扫描能从 HTTP 打进来"
 *
 * 与 `url-import-http-route.test.ts` 文件头逐字同一处限制，且理由更硬：那个
 * 文件至少能用**回放**在不连网的情况下证一次 200；本用例完全不落库，没有
 * 回放可用，唯一能证明"真的扫描成功"的办法是让生产装配（真实 DNS、真实
 * `api.github.com`）连一次真网络——这需要真实公网可达 + 不受 GitHub 匿名
 * 60 次/小时配额影响，两者在 CI 里都不能保证（这台机器上实测：`anthropics/skills`
 * 仓库 `skills/` 目录一次扫描就要 ~110 次 Contents API 调用，接近甚至超过配额）。
 * ⇒ **真实扫描成功路径**已经用**用例层**测试（`discover-skills-from-url.test.ts`，
 * 走完整 TLS + DNS 打桩但仍是真实取回器 `fetchImportSource`）验证过，并额外用
 * 真实 `anthropics/skills` 仓库跑过一次手工验证（细节见 PR 正文）——本文件只
 * 覆盖**不需要成功连网**的那一半：授权、契约、以及"host 不是 github.com"这类
 * 在真正发起网络请求之前就会被拒的负样本。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1865-discover-http";
const LOCAL_ORG = "org-i1865-discover-http-local";
const ADMIN = "u-i1865-discover-admin";
const MEMBER = "u-i1865-discover-member";
const LOCAL_OWNER = "u-i1865-discover-local-owner";

/** 一个字面量就会被第一道门拒的地址——负样本离线且确定，不取决于本机有没有网。 */
const BLOCKED_URL = "https://127.0.0.1/owner/repo";
/** 一个合法形状但不经过网络就已经确定会被拒的地址（host 不是 github.com）。 */
const NOT_GITHUB_URL = "https://example.com/owner/repo";

let app: NestExpressApplication;
let base = "";

const authFor = (userId: string, orgId: string) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

function post(userId: string, orgId: string, body: unknown, path = "/admin/skills/url-imports/discover") {
  return fetch(`${base}${path}`, { method: "POST", headers: authFor(userId, orgId), body: JSON.stringify(body) });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, LOCAL_ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i1865-discover-http" });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await seedOrg({
    orgId: LOCAL_ORG,
    kind: "personal-local",
    ownerUserId: LOCAL_OWNER,
    projectId: "proj-i1865-discover-http-local",
  });
  await addOrgMember(LOCAL_ORG, LOCAL_OWNER, "admin", null);

  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, LOCAL_ORG);
});

describe("路由真的存在（正样本，⚠ 没有它下面的负样本只证了『答了』）", () => {
  /**
   * ⚠ 正样本手法与 `url-import-http-route.test.ts` 同源：既然不能连真实网络，
   *   就选一个**在授权门之后、发起取回请求之前**必定确定性拒绝的地址
   *   （`NOT_GITHUB_URL`：host 不是 `github.com`，本用例自己的输入形状校验，
   *   不依赖网络）。它证明的是"admin 走到了用例逻辑本身、契约 out 走了错误分支"，
   *   而不是"扫描成功"——成功路径见文件头。
   */
  it("admin 提交合法但非 github.com 的地址 ⇒ 走到了用例逻辑（422），不是路由不存在（404）", async () => {
    const response = await post(ADMIN, ORG, { sourceUrl: NOT_GITHUB_URL });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe("IMPORT_CONTENT_INVALID");
  });

  it("装置自检：邻近的未知路径确实 404 ⇒ 上面那条 422 是这条路由给的", async () => {
    const response = await post(ADMIN, ORG, {}, "/admin/skills/url-imports/discover-does-not-exist");
    expect(response.status).toBe(404);
  });
});

describe("授权：非 admin 被拒，且在取回之前被拒", () => {
  it("consultant 提交一个会被 SSRF 门拒的地址 ⇒ 回的是授权码，不是取回码", async () => {
    const response = await post(MEMBER, ORG, { sourceUrl: BLOCKED_URL });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe("IMPORT_NOT_ORG_ADMIN");
  });
});

describe("本用例自己的输入形状校验在 HTTP 面仍然生效", () => {
  it("admin 提交 loopback 字面量地址 ⇒ 422 / IMPORT_CONTENT_INVALID（host 不是 github.com）", async () => {
    const response = await post(ADMIN, ORG, { sourceUrl: BLOCKED_URL });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe("IMPORT_CONTENT_INVALID");
  });
});

describe("localOnlyOrg 由组织的 kind 逐请求推出（⚠ controller 自己的那条安全判定）", () => {
  /**
   * 手法与 `url-import-http-route.test.ts` 同源：`sourceUrl` 用一个**真的是**
   * `github.com` 的地址，让请求真的走到 `deps.fetch` 里——`localOnlyOrg` 门排在
   * 协议/host 判定**之前**，所以这里不需要网络连通就能看到码的差异：
   *   · `localOnlyOrg: true`（正确）⇒ 403 / `IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG`；
   *   · 写死 `false`（缺陷）会连去真实 GitHub，得到完全不同的码/更长的耗时。
   */
  it("personal-local 组织的 owner 扫描 ⇒ 403 / IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG", async () => {
    const response = await post(LOCAL_OWNER, LOCAL_ORG, {
      sourceUrl: "https://github.com/anthropics/skills/tree/main/skills",
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe(
      "IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG",
    );
  });

  /** 对照：同一个地址，普通组织必须继续往下走（不是本地组织码）。 */
  it("对照：普通组织的同一个地址不会被本地组织门拦，会继续走到 IMPORT_CONTENT_INVALID 之外的分支", async () => {
    const response = await post(ADMIN, ORG, { sourceUrl: NOT_GITHUB_URL });
    const body = (await response.json()) as { reasonCode?: string };
    expect(body.reasonCode).not.toBe("IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG");
  });
});

describe("契约校验真的挂在这条路由上", () => {
  it("缺字段 ⇒ 400", async () => {
    const response = await post(ADMIN, ORG, {});
    expect(response.status).toBe(400);
  });

  it("多余字段被拒（契约是 .strict()）", async () => {
    const response = await post(ADMIN, ORG, {
      sourceUrl: "https://github.com/o/r",
      unexpected: true,
    });
    expect(response.status).toBe(400);
  });
});
