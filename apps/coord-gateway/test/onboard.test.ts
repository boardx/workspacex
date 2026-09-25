// 项目接入向导（p30/F05，UC-01，真 workerd）：
//   1. installation(created)/installation_repositories(added) webhook → 直接注册为目录项目（安装即租户）
//   2. GitHub API façade（installation 视角）纯函数：list repos + collaborator permission 判定 admin
//   3. 自动体检四项：webhook 配置态 / 镜像种子（真 RepoHub 数据）/ CODEOWNERS·CONTRIBUTING / 分支保护
//   4. REST 面鉴权矩阵：ops token 门 + GitHub App 未配置 fail-closed
//   5. IDOR 回归（#776 review）：installations/checkup/finalize 三个端点必须在服务端
//      强制"发起人对该 installation/repo 有 collaborator admin 权限"——此前只有前端
//      disabled 徽章，服务端完全不校验，任意登录用户可枚举/侦察/注册任意租户的仓库。
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGitHubAppAuth } from "@repo/coord-projection";
import {
  canonicalRepoId,
  deriveProjectSlug,
  handleOnboard,
  listInstallationRepos,
  reposFromInstallationPayload,
  runCheckup,
  verifyAdminAccess,
} from "../src/onboard";
import type { Env } from "../src/index";

const SECRET = "test-webhook-secret";
const enc = new TextEncoder();

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postWebhook(event: string, payload: unknown, delivery: string) {
  const body = JSON.stringify(payload);
  return SELF.fetch("https://gw.test/api/coord/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": await sign(body),
      "x-github-delivery": delivery,
      "x-github-event": event,
    },
    body,
  });
}

// 预热吸收 vitest-pool-workers singleWorker 的一次性 DO 失效（同 gateway.test.ts/directory.test.ts 纪律）
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const r = await SELF.fetch("https://gw.test/api/coord/directory/projects", {
      headers: { authorization: "Bearer test-api-token" },
    }).catch(() => null);
    if (r?.ok) break;
  }
});

describe("安装即注册（installation/installation_repositories webhook → 目录 DO）", () => {
  it("installation(created)：payload.repositories 全部注册为目录项目", async () => {
    const r = await postWebhook(
      "installation",
      {
        action: "created",
        installation: { id: 9001, account: { login: "usamshen", type: "User" } },
        repositories: [
          { full_name: "usamshen/pixel-forge", name: "pixel-forge", private: false },
          { full_name: "usamshen/ledgerly", name: "ledgerly", private: false },
        ],
      },
      "dlv-install-1",
    );
    expect(r.status).toBe(202);
    const body = await r.json<{ ok: boolean; registered: { slug: string; registered: boolean }[] }>();
    // slug 由 owner+repo 派生（#377），断言处复用同一个派生函数，不另抄一份字面量。
    const expected = [
      await deriveProjectSlug("usamshen", "pixel-forge"),
      await deriveProjectSlug("usamshen", "ledgerly"),
    ].sort();
    expect(body.registered.map((x) => x.slug).sort()).toEqual(expected);

    const list = await (
      await SELF.fetch("https://gw.test/api/coord/directory/projects", {
        headers: { authorization: "Bearer test-api-token" },
      })
    ).json<{ projects: { slug: string }[] }>();
    const slugs = list.projects.map((p) => p.slug);
    for (const slug of expected) expect(slugs).toContain(slug);
  });

  it("installation_repositories(added)：repositories_added 增量注册；重复安装幂等（409 不视为失败）", async () => {
    const r1 = await postWebhook(
      "installation_repositories",
      { action: "added", installation: { id: 9001 }, repositories_added: [{ full_name: "acme-inc/crm-core", name: "crm-core", private: true }] },
      "dlv-install-2",
    );
    expect(r1.status).toBe(202);
    const body1 = await r1.json<{ registered: { slug: string; registered: boolean }[] }>();
    const crmSlug = await deriveProjectSlug("acme-inc", "crm-core");
    expect(body1.registered).toEqual([{ slug: crmSlug, registered: true }]);

    // 同一仓再次投递（幂等）：slug 已占用 → registered:false，仍是 202 而非错误
    const r2 = await postWebhook(
      "installation_repositories",
      { action: "added", installation: { id: 9001 }, repositories_added: [{ full_name: "acme-inc/crm-core", name: "crm-core", private: true }] },
      "dlv-install-3",
    );
    expect(r2.status).toBe(202);
    const body2 = await r2.json<{ registered: { slug: string; registered: boolean }[] }>();
    expect(body2.registered).toEqual([{ slug: crmSlug, registered: false }]);
  });

  it("非 created/added 动作（如 deleted）→ ack 但不注册（registered 空数组）", async () => {
    const r = await postWebhook(
      "installation",
      { action: "deleted", installation: { id: 9001 }, repositories: [{ full_name: "usamshen/should-not-register", name: "should-not-register", private: false }] },
      "dlv-install-4",
    );
    expect(r.status).toBe(202);
    expect((await r.json<{ registered: unknown[] }>()).registered).toEqual([]);
  });

  it("installation 事件缺 repository 顶层字段也能过——不落旧的 missing_repository 400", async () => {
    // 回归断言：installation/installation_repositories 事件天然没有顶层 repository 字段，
    // 必须在 handleWebhook 里被特判拦截，不能落到「要求 repository.full_name」的旧分支。
    const r = await postWebhook("installation", { action: "created", installation: { id: 1 }, repositories: [] }, "dlv-install-5");
    expect(r.status).toBe(202);
  });
});

// directory 侧的硬约束（packages/coord-directory/src/schema.ts + directory.ts:322）：
// 不满足就是 422 invalid_slug，任何派生结果都必须过这一关。
const DIRECTORY_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

describe("slug 派生", () => {
  it("可读前缀：小写化 + 非法字符折叠为连字符 + 裁两端，owner 在前", async () => {
    expect(await deriveProjectSlug("usamshen", "Pixel_Forge")).toMatch(/^usamshen-pixel-forge-[0-9a-f]{16}$/);
    expect(await deriveProjectSlug("acme-inc", "crm.core!!")).toMatch(/^acme-inc-crm-core-[0-9a-f]{16}$/);
    expect(await deriveProjectSlug("--edge--", "--repo--")).toMatch(/^edge-repo-[0-9a-f]{16}$/);
  });

  it("同一个 owner/repo 永远得到同一个 slug（稳定，可重复投递）；大小写不影响", async () => {
    const a = await deriveProjectSlug("usamshen", "pixel-forge");
    expect(await deriveProjectSlug("usamshen", "pixel-forge")).toBe(a);
    expect(await deriveProjectSlug("UsamShen", "Pixel-Forge")).toBe(a);
    expect(canonicalRepoId("UsamShen", "Pixel-Forge")).toBe("usamshen/pixel-forge");
  });

  it("#377 反证：不同 owner 的同名仓派生出不同 slug", async () => {
    expect(await deriveProjectSlug("owner-a", "demo")).not.toBe(await deriveProjectSlug("owner-b", "demo"));
  });

  it("前缀折叠不导致撞号：a-b/c 与 a/b-c 可读前缀相同，摘要仍把它们分开", async () => {
    const x = await deriveProjectSlug("a-b", "c");
    const y = await deriveProjectSlug("a", "b-c");
    expect(x.replace(/-[0-9a-f]{16}$/, "")).toBe(y.replace(/-[0-9a-f]{16}$/, "")); // 前缀确实撞了
    expect(x).not.toBe(y); // 但 slug 没撞
  });

  it("超长 owner/repo 被截断后仍满足 directory 的 SLUG_RE，且彼此不撞", async () => {
    const owner = "o".repeat(39); // GitHub owner 上限
    const long1 = await deriveProjectSlug(owner, "r".repeat(100));
    const long2 = await deriveProjectSlug(owner, "r".repeat(101));
    expect(long1.length).toBeLessThanOrEqual(63);
    expect(long1).toMatch(DIRECTORY_SLUG_RE);
    expect(long2).toMatch(DIRECTORY_SLUG_RE);
    expect(long1).not.toBe(long2); // 截断点之后的差异由摘要兜住
  });

  it("全是非法字符时兜底 \"repo\" 前缀，仍是合法 slug", async () => {
    const slug = await deriveProjectSlug("!!!", "???");
    expect(slug).toMatch(/^repo-[0-9a-f]{16}$/);
    expect(slug).toMatch(DIRECTORY_SLUG_RE);
  });
});

describe("installation payload 解析（两种事件形状）", () => {
  it("installation(created) 用 repositories；installation_repositories(added) 用 repositories_added", () => {
    expect(
      reposFromInstallationPayload("installation", { repositories: [{ full_name: "a/b", name: "b", private: false }] }),
    ).toEqual([{ full_name: "a/b", name: "b", private: false }]);
    expect(
      reposFromInstallationPayload("installation_repositories", {
        repositories_added: [{ full_name: "a/c", name: "c", private: true }],
      }),
    ).toEqual([{ full_name: "a/c", name: "c", private: true }]);
    expect(reposFromInstallationPayload("installation", {})).toEqual([]);
  });
});

// ---------- GitHub API façade + 体检（mock fetch，不打真 GitHub；同 coord-projection 测试纪律） ----------

let privatePem = "";

function pemFromPkcs8(der: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  )) as CryptoKeyPair;
  privatePem = pemFromPkcs8((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
});

function mockAuth() {
  return createGitHubAppAuth({
    appId: "12345",
    privateKey: privatePem,
    fetchImpl: (async () =>
      Response.json({ token: "ghs_mock", expires_at: new Date(Date.now() + 3600_000).toISOString() }, { status: 201 })) as typeof fetch,
  });
}

describe("listInstallationRepos：真实仓库列表 + collaborator permission 判定 admin", () => {
  it("按 login 逐仓查 permission；admin 才置 is_admin=true，403/404 保守判非 admin", async () => {
    const auth = mockAuth();
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/installation/repositories"))
        return Response.json({
          repositories: [
            { full_name: "usamshen/pixel-forge", private: false, description: "渲染引擎", language: "TypeScript", default_branch: "main" },
            { full_name: "acme-inc/crm-core", private: true, description: "CRM 主仓", language: "TypeScript", default_branch: "main" },
          ],
        });
      if (url.includes("/repos/usamshen/pixel-forge/collaborators/usamshen/permission"))
        return Response.json({ permission: "admin" });
      if (url.includes("/repos/acme-inc/crm-core/collaborators/usamshen/permission"))
        return Response.json({ permission: "write" });
      return Response.json({ message: "not found" }, { status: 404 });
    }) as typeof fetch;

    const repos = await listInstallationRepos(auth, 9001, "usamshen", fetchImpl);
    expect(repos).toHaveLength(2);
    // 按 full_name 定位（身份），再单独断言 slug 与派生函数一致——不再拿 slug 当主键找行。
    const pixel = repos.find((r) => r.full_name === "usamshen/pixel-forge")!;
    const crm = repos.find((r) => r.full_name === "acme-inc/crm-core")!;
    expect(pixel.is_admin).toBe(true);
    expect(crm.is_admin).toBe(false);
    expect(pixel.slug).toBe(await deriveProjectSlug("usamshen", "pixel-forge"));
    expect(crm.slug).toBe(await deriveProjectSlug("acme-inc", "crm-core"));
  });

  // IDOR 回归（#776 review）：请求者与仓库零 collaborator 关系的仓库必须整条从
  // 列表剔除，不能只是 is_admin=false——否则任意登录用户枚举 installation_id 仍能
  // 拿到其他租户私有仓库的 full_name/description/language 等元数据。
  it("与请求者零 collaborator 关系的仓库（permission=none / 403 / 404）整条剔除，不下发任何元数据", async () => {
    const auth = mockAuth();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/installation/repositories"))
        return Response.json({
          repositories: [
            { full_name: "usamshen/pixel-forge", private: false, description: "渲染引擎" },
            { full_name: "other-org/private-secret", private: true, description: "别的租户的私有仓" },
            { full_name: "other-org/public-none", private: false, description: "公开但无关系" },
          ],
        });
      if (url.includes("/repos/usamshen/pixel-forge/collaborators/attacker/permission"))
        return Response.json({ permission: "admin" });
      if (url.includes("/repos/other-org/private-secret/collaborators/attacker/permission"))
        return Response.json({ message: "not found" }, { status: 404 }); // 攻击者不是协作者
      if (url.includes("/repos/other-org/public-none/collaborators/attacker/permission"))
        return Response.json({ permission: "none" });
      return Response.json({ message: "unexpected" }, { status: 500 });
    }) as typeof fetch;

    const repos = await listInstallationRepos(auth, 9001, "attacker", fetchImpl);
    expect(repos.map((r) => r.full_name)).toEqual(["usamshen/pixel-forge"]);
    expect(repos.some((r) => r.full_name.includes("other-org"))).toBe(false);
  });
});

// IDOR 回归三条（#776 review）：checkup 与 finalize 共用的授权门禁——非归属用户
// （无 collaborator 关系 / 有关系但非 admin）一律被拒，只有真实 admin 放行。
describe("verifyAdminAccess：checkup/finalize 共用授权门禁（IDOR 回归）", () => {
  it("① 与目标仓零 collaborator 关系（404/查无）→ 拒绝", async () => {
    const auth = mockAuth();
    const fetchImpl = (async () => Response.json({ message: "not found" }, { status: 404 })) as typeof fetch;
    expect(await verifyAdminAccess(auth, 9001, "other-org", "private-secret", "attacker", fetchImpl)).toBe(false);
  });

  it("② 有 collaborator 关系但只是 write/read（非 admin）→ 拒绝", async () => {
    const auth = mockAuth();
    const fetchImpl = (async () => Response.json({ permission: "write" })) as typeof fetch;
    expect(await verifyAdminAccess(auth, 9001, "acme-inc", "crm-core", "non-admin-collaborator", fetchImpl)).toBe(false);
  });

  it("③ 真实 admin → 放行", async () => {
    const auth = mockAuth();
    const fetchImpl = (async () => Response.json({ permission: "admin" })) as typeof fetch;
    expect(await verifyAdminAccess(auth, 9001, "usamshen", "pixel-forge", "usamshen", fetchImpl)).toBe(true);
  });
});

describe("runCheckup：四项真实体检（警告不阻塞）", () => {
  it("webhook 已配置 + 有镜像数据 + CODEOWNERS/CONTRIBUTING 都在 + 分支已保护 → 全部 ok", async () => {
    // 先灌一条镜像事件，让 mirror-seed 检查读到非零数据（真 RepoHub DO，非 mock）
    const repo = "onboard-checkup-ok/repo";
    await env.REPOHUB.get(env.REPOHUB.idFromName(repo)).fetch("https://repohub/webhook/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delivery_id: "seed-1", mirror: { kind: "issue", data: { number: 1, state: "open", title: "t", labels: [], assignees: [] } } }),
    });

    const auth = mockAuth();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contents/")) return new Response(null, { status: 200 });
      if (url.includes("/branches/main/protection"))
        return Response.json({ required_pull_request_reviews: { required_approving_review_count: 1 } });
      return Response.json({ message: "unexpected" }, { status: 500 });
    }) as typeof fetch;

    const items = await runCheckup(env as unknown as Env, auth, 9001, "onboard-checkup-ok", "repo", "main", fetchImpl);
    expect(items.map((i) => i.id)).toEqual(["webhook", "mirror-seed", "modules-init", "branch-protection"]);
    expect(items.every((i) => i.result === "ok")).toBe(true);
  });

  it("无镜像数据 + 缺 CODEOWNERS/CONTRIBUTING + 未保护分支 → 对应项 warn 且带 remedy，不阻塞（仍是终态）", async () => {
    const auth = mockAuth();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contents/")) return Response.json({ message: "not found" }, { status: 404 });
      if (url.includes("/branches/main/protection")) return Response.json({ message: "not found" }, { status: 404 });
      return Response.json({ message: "unexpected" }, { status: 500 });
    }) as typeof fetch;

    const items = await runCheckup(env as unknown as Env, auth, 9001, "onboard-checkup-empty", "repo-fresh", "main", fetchImpl);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId["mirror-seed"]!.result).toBe("warn");
    expect(byId["modules-init"]!.result).toBe("warn");
    expect(byId["modules-init"]!.remedy).toBeTruthy();
    expect(byId["branch-protection"]!.result).toBe("warn");
    expect(byId["branch-protection"]!.remedy).toBeTruthy();
  });
});

describe("REST 面 /api/coord/onboard/*", () => {
  it("GitHub App 未配置（本测试环境无 GITHUB_APP_ID）→ 503 fail-closed", async () => {
    const r = await SELF.fetch("https://gw.test/api/coord/onboard/installations/9001", {
      headers: { authorization: "Bearer test-api-token" },
    });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "github_app_not_configured" });
  });

  it("无 token / 假 token → 401（fail-closed，先于 GitHub App 配置检查）", async () => {
    expect((await SELF.fetch("https://gw.test/api/coord/onboard/installations/9001")).status).toBe(401);
    expect(
      (
        await SELF.fetch("https://gw.test/api/coord/onboard/installations/9001", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
  });

  it("finalize：本测试环境无 GITHUB_APP_ID，所有三个端点（含 finalize）统一 fail-closed 503——" +
    "finalize 现在也要先打 GitHub 核验 admin 权限，不再是「只写目录 DO」的例外", async () => {
    const r = await SELF.fetch("https://gw.test/api/coord/onboard/finalize", {
      method: "POST",
      headers: { authorization: "Bearer test-api-token", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "github_app_not_configured" });
  });

  it("未知子路径 → 404", async () => {
    const r = await SELF.fetch("https://gw.test/api/coord/onboard/nope", {
      headers: { authorization: "Bearer test-api-token" },
    });
    expect(r.status).toBe(404);
  });
});

// ---------- 端到端 REST 路径的 IDOR 回归（#776 复审要求：不能只有单元测试覆盖）----------
// SELF.fetch 走的是 miniflare 按 wrangler.toml 解析出的独立 env 快照，测试文件里改写
// `cloudflare:test` 的 env 对象不会反映到那个快照里（已实测：改了 GITHUB_APP_ID 后
// SELF.fetch 仍然 503，证明两者不是同一份绑定）。于是这里改为**直接调用 handleOnboard**
// ——它就是 index.ts fetch() 分发到的同一个函数，不是重新实现；用真实的
// env.DIRECTORY/env.REPOHUB（cloudflare:test 导出的活体 DO 绑定）拼一份自定义 Env
// （补上 GITHUB_APP_ID/PRIVATE_KEY/COORD_API_TOKEN），这样既走了生产代码的完整路径，
// 又能用 vi.stubGlobal 顶替全局 fetch 挡下真实 GitHub 调用（同一 JS realm，直接调用
// 不经过额外的 worker 分发，stubGlobal 保证生效）。
describe("REST 面 IDOR 回归（installation_id 属己但 repo 属他 / 零归属侦察）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function testGatewayEnv(): Env {
    return {
      ...(env as unknown as Env),
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: privatePem,
      COORD_API_TOKEN: "test-api-token",
    };
  }

  /** 装机（token 铸造）响应恒定通过；仓库/权限响应由每条用例自定义。 */
  function stubGithub(handle: (url: string) => Response) {
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/access_tokens"))
          return Response.json({ token: "ghs_e2e", expires_at: new Date(Date.now() + 3600_000).toISOString() }, { status: 201 });
        return handle(url);
      }) as typeof fetch,
    );
  }

  it("installations/:id：installation_id 属于攻击者自己安装的账户，但请求者与其下全部仓库零 collaborator 关系 → 403，响应体不含 account/permissions（同族 IDOR 收口）", async () => {
    stubGithub((url) => {
      if (url.includes("/installation/repositories"))
        return Response.json({ repositories: [{ full_name: "victim-org/secret-repo", private: true, description: "受害者的私有仓" }] });
      if (url.includes("/collaborators/attacker/permission")) return Response.json({ message: "not found" }, { status: 404 });
      if (url.match(/\/app\/installations\/\d+$/)) return Response.json({ id: 9002, account: { login: "victim-org", type: "Organization" }, permissions: { contents: "read" } });
      return Response.json({ message: "unexpected" }, { status: 500 });
    });

    const req = new Request("https://gw.test/api/coord/onboard/installations/9002?login=attacker", {
      headers: { authorization: "Bearer test-api-token" },
    });
    const r = await handleOnboard(req, testGatewayEnv(), new URL(req.url));
    expect(r.status).toBe(403);
    const body = await r.json<Record<string, unknown>>();
    expect(body["error"]).toBe("not_a_member");
    expect(body).not.toHaveProperty("account");
    expect(body).not.toHaveProperty("permissions");
    expect(body).not.toHaveProperty("repos");
  });

  it("checkup：installation_id 是请求者自己的安装，但 owner/repo 是别人的仓库（mismatch）→ 403 not_admin，走完整 REST 路径（非仅单测）", async () => {
    stubGithub((url) => {
      if (url.includes("/repos/other-owner/other-repo/collaborators/legit-user/permission"))
        return Response.json({ message: "not found" }, { status: 404 }); // 请求者对这个别人的仓零关系
      return Response.json({ message: "unexpected" }, { status: 500 });
    });

    const req = new Request(
      "https://gw.test/api/coord/onboard/checkup?installation_id=9003&owner=other-owner&repo=other-repo&login=legit-user",
      { headers: { authorization: "Bearer test-api-token" } },
    );
    const r = await handleOnboard(req, testGatewayEnv(), new URL(req.url));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "not_admin" });
  });

  it("finalize：同一 mismatch 场景（own installation_id + 他人 repo）→ 403，目录 DO 未被写入", async () => {
    stubGithub((url) => {
      if (url.includes("/repos/other-owner/other-repo/collaborators/legit-user/permission"))
        return Response.json({ message: "not found" }, { status: 404 });
      return Response.json({ message: "unexpected" }, { status: 500 });
    });

    const gatewayEnv = testGatewayEnv();
    const req = new Request("https://gw.test/api/coord/onboard/finalize", {
      method: "POST",
      headers: { authorization: "Bearer test-api-token", "content-type": "application/json" },
      body: JSON.stringify({ full_name: "other-owner/other-repo", installation_id: 9003, login: "legit-user" }),
    });
    const r = await handleOnboard(req, gatewayEnv, new URL(req.url));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "not_admin" });

    // 目录 DO 里不应出现这个项目（拒绝发生在 registerProject 调用之前）
    const projects = await (
      await SELF.fetch("https://gw.test/api/coord/directory/projects", { headers: { authorization: "Bearer test-api-token" } })
    ).json<{ projects: { slug: string }[] }>();
    expect(projects.projects.some((p) => p.slug === "other-repo")).toBe(false);
  });

  it("finalize 成功路径：真实 admin 放行后，可见性以 GitHub 真实值为准——" +
    "客户端谎报 private:false，GitHub 说 private:true，注册结果以 GitHub 为准（#776 复审顺手项）", async () => {
    stubGithub((url) => {
      if (url.includes("/repos/usamshen/finalize-visibility-check/collaborators/usamshen/permission"))
        return Response.json({ permission: "admin" });
      if (url.endsWith("/repos/usamshen/finalize-visibility-check")) return Response.json({ private: true });
      return Response.json({ message: "unexpected" }, { status: 500 });
    });

    const req = new Request("https://gw.test/api/coord/onboard/finalize", {
      method: "POST",
      headers: { authorization: "Bearer test-api-token", "content-type": "application/json" },
      body: JSON.stringify({
        full_name: "usamshen/finalize-visibility-check",
        private: false, // 客户端谎报公开
        installation_id: 9004,
        login: "usamshen",
      }),
    });
    const r = await handleOnboard(req, testGatewayEnv(), new URL(req.url));
    expect(r.status).toBe(200);
    const finalizeSlug = await deriveProjectSlug("usamshen", "finalize-visibility-check");
    expect(await r.json()).toMatchObject({ project: { slug: finalizeSlug, registered: true } });

    const project = ((await (
      await SELF.fetch("https://gw.test/api/coord/directory/projects", { headers: { authorization: "Bearer test-api-token" } })
    ).json<{ projects: { slug: string; visibility: string }[] }>()).projects).find((p) => p.slug === finalizeSlug);
    expect(project?.visibility).toBe("private"); // 以 GitHub 真实值为准，不是客户端谎报的 false
  });
});

// ---------- #377：跨 owner 同名仓不得撞号 ----------
//
// 反证背景：slug 曾只由 repo 短名派生，而 directory 的 projects.slug 是**全局唯一索引**
// （schema.ts `uq_projects_slug`）。于是 owner-a/demo 与 owner-b/demo 必然算出同一个
// slug，第二个仓注册时撞 409；而 registerProject 把 409 当「幂等，已在册」吞掉，
// 于是 owner-b/demo 被静默并进 owner-a/demo 的项目行——跨租户身份混淆，不是重复注册。
describe("跨 owner 同名仓 slug 不撞号（#377）", () => {
  it("两个 owner 的同名仓各自注册成独立项目，第二个不被 409 吞成「已在册」", async () => {
    const a = await postWebhook(
      "installation_repositories",
      { action: "added", installation: { id: 9377 }, repositories_added: [{ full_name: "owner-a/demo", name: "demo", private: false }] },
      "dlv-377-a",
    );
    expect(a.status).toBe(202);
    const bodyA = await a.json<{ registered: { slug: string; registered: boolean }[] }>();

    const b = await postWebhook(
      "installation_repositories",
      { action: "added", installation: { id: 9378 }, repositories_added: [{ full_name: "owner-b/demo", name: "demo", private: false }] },
      "dlv-377-b",
    );
    expect(b.status).toBe(202);
    const bodyB = await b.json<{ registered: { slug: string; registered: boolean }[] }>();

    // 两个不同 owner 的同名仓：slug 必须不同
    expect(bodyA.registered[0]!.slug).not.toBe(bodyB.registered[0]!.slug);
    // 且第二个是真的新注册，而不是撞 409 被当成「已在册」
    expect(bodyA.registered[0]!.registered).toBe(true);
    expect(bodyB.registered[0]!.registered).toBe(true);

    // 目录里确实是两条独立项目，各自 name 指回自己的 full_name
    const list = await (
      await SELF.fetch("https://gw.test/api/coord/directory/projects", {
        headers: { authorization: "Bearer test-api-token" },
      })
    ).json<{ projects: { slug: string; name: string }[] }>();
    const demos = list.projects.filter((p) => p.name === "owner-a/demo" || p.name === "owner-b/demo");
    expect(demos.map((p) => p.name).sort()).toEqual(["owner-a/demo", "owner-b/demo"]);
    expect(new Set(demos.map((p) => p.slug)).size).toBe(2);
  });
});
