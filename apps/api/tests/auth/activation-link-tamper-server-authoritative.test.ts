/**
 * **F10 的核心安全不变量（I-2 / AC5 / V5）：篡改激活链接里的身份参数，服务端仍按它自己
 * 记录的身份授予。**
 *
 * ## 这条为什么必须单独一个文件
 *
 * 它的失败**长得和成功一模一样**。受邀人激活成功，界面显示他的角色，
 * `org_memberships` 里有一行，日志干净，没有异常、没有约束冲突。
 * 唯一的区别是那一行里的 `org_role` 是他自己在链接里写的 `admin`。
 * 一个把主流程测绿的测试文件不会碰到这件事，所以它在这里，
 * 并且带着一次**反证**：把仓储里那次查表拆掉、改成信任链接参数，
 * 下面第一条断言当场变红。
 *
 * ## 反证是**在源码上做的**，不是在假件上做的
 *
 * 假 repository 上的反证只能证明「如果实现是这样，测试会红」——
 * 而实现恰恰是唯一可能出错的东西。所以第三个 describe 读
 * `pg-org-invite-repository.ts` 的真实源码，把授予那两个参数替换成
 * `input.untrustedClaims.*`，用 `tsx` 跑一遍真的激活，断言授予变成了篡改值。
 * 那次运行**证明的是这条防线是活的**：拆掉它，越权真的发生。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { activateOrgMember } from "../../src/application/auth/activate-org-member";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { fakeHasher, fakeSessions, fakeTokens, NO_CLAIMS } from "../support/org-invite";

const ORG = "org-f10-tamper";
/** 攻击者在链接里想切过去的那个组织。真实存在，所以「组织不存在」不是本条通过的原因。 */
const VICTIM_ORG = "org-f10-tamper-victim";
const ADMIN = "u-f10-tamper-admin";

const REPO_SRC = fileURLToPath(
  new URL("../../src/infrastructure/auth/pg-org-invite-repository.ts", import.meta.url),
);
const API_DIR = fileURLToPath(new URL("../..", import.meta.url));

/** 见文件尾的注释：钩子不吃 vitest 默认的 10 秒。 */
const HOOK_TIMEOUT_MS = 60_000;

let db: PgDatabase;
let repo: PgOrgInviteRepository;
let fixture: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgInviteRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, VICTIM_ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f10tamper.test'"));
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, VICTIM_ORG);
  await asOwner((c) => c.query("DELETE FROM credentials WHERE email LIKE '%@f10tamper.test'"));
  fixture = await seedOrg({ orgId: ORG, teamNames: ["energy", "platform"], projectId: `${ORG}-p` });
  await seedOrg({ orgId: VICTIM_ORG, teamNames: ["secret"], projectId: `${VICTIM_ORG}-p` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
}, HOOK_TIMEOUT_MS);

async function inviteConsultant(email: string) {
  return inviteOrgMember(
    { repo },
    {
      orgId: toOrgId(ORG),
      actorId: ADMIN,
      actorOrgRole: "admin",
      email,
      // 服务端记录的身份：顾问 · energy 组。下面所有篡改都想把它变成别的。
      orgRole: "consultant",
      teamId: fixture.teams.energy!,
    },
  );
}

function activateWith(token: string, claims: { orgId: string | null; orgRole: string | null; teamId: string | null }) {
  return activateOrgMember(
    { repo, hasher: fakeHasher, sessions: fakeSessions(), tokens: fakeTokens() },
    {
      token,
      mode: "new-account",
      profile: { name: "Mallory", password: "correct-horse-battery-staple" },
      existingUserId: null,
      untrustedClaims: claims,
    },
  );
}

async function membershipsOfUser(userId: string, orgId: string) {
  return asApp(orgId, async (c) => {
    const r = await c.query(
      "SELECT org_id, org_role, team_id FROM org_memberships WHERE user_id = $1",
      [userId],
    );
    return r.rows;
  });
}

describe("篡改链接里的身份参数：实际授予恒为服务端记录值", () => {
  it("🔴 把 role 改成 admin、team 改成别的组、org 改成别的组织 —— 三样全部无效", async () => {
    const invited = await inviteConsultant("mallory@f10tamper.test");

    const out = await activateWith(invited.token!, {
      orgId: VICTIM_ORG,
      orgRole: "admin",
      teamId: fixture.teams.platform!,
    });

    // 返回值：服务端记录值，一个字段都没被链接里的声明改动。
    expect(out.orgId).toBe(ORG);
    expect(out.orgRole).toBe("consultant");
    expect(out.teamId).toBe(fixture.teams.energy);

    // 库里落下的那一行 —— 真正决定他能做什么的东西。
    const rows = await membershipsOfUser(out.userId, ORG);
    expect(rows).toHaveLength(1);
    expect(rows[0].org_id).toBe(ORG);
    expect(rows[0].org_role).toBe("consultant");
    expect(rows[0].team_id).toBe(fixture.teams.energy);

    // 而且他**没有**在受害组织里落下任何东西。
    const victim = await membershipsOfUser(out.userId, VICTIM_ORG);
    expect(victim).toHaveLength(0);
  });

  it("篡改尝试被写进安全审计（否则「篡改无效」只证明到「我们没读」）", async () => {
    const invited = await inviteConsultant("m2@f10tamper.test");
    const out = await activateWith(invited.token!, {
      orgId: null,
      orgRole: "admin",
      teamId: null,
    });
    expect(out.tamperRecorded).toBe(true);

    const audit = await asApp(ORG, (c) =>
      c.query(
        "SELECT claimed_org_role, actual_org_role, claimed_team_id, actual_team_id FROM org_invite_tamper_attempts WHERE org_id = $1",
        [ORG],
      ),
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].claimed_org_role).toBe("admin");
    expect(audit.rows[0].actual_org_role).toBe("consultant");
  });

  it("没篡改就不留噪音：链接里带的是真值、或者什么都没带，都不写审计", async () => {
    const a = await inviteConsultant("m3@f10tamper.test");
    const outA = await activateWith(a.token!, NO_CLAIMS);
    expect(outA.tamperRecorded).toBe(false);

    const b = await inviteConsultant("m4@f10tamper.test");
    const outB = await activateWith(b.token!, {
      orgId: ORG,
      orgRole: "consultant",
      teamId: fixture.teams.energy!,
    });
    expect(outB.tamperRecorded).toBe(false);

    const audit = await asApp(ORG, (c) =>
      c.query("SELECT count(*)::int AS n FROM org_invite_tamper_attempts WHERE org_id = $1", [ORG]),
    );
    expect(audit.rows[0].n).toBe(0);
  });
});

describe("契约面：那三个字段在 activateOrgMember.in 里根本不存在", () => {
  it("`in` 是 strict 的，且没有 orgId / orgRole / teamId 三个键", async () => {
    const { orgAdmin } = await import("@repo/contracts");
    const shape = orgAdmin.operations.activateOrgMember.in.shape;
    expect(Object.keys(shape).sort()).toEqual(["mode", "profile", "sessionId", "token"]);
    // 「忽略一个字段」是实现纪律（会被忘）；「字段不存在」是契约事实。
    const parsed = orgAdmin.operations.activateOrgMember.in.safeParse({
      token: "t",
      mode: "new-account",
      profile: { name: "n", password: "p" },
      sessionId: null,
      orgRole: "admin",
    });
    expect(parsed.success).toBe(false);
  });
});

/* ───────────────────────────── 反证 ───────────────────────────── */

/**
 * 把仓储里那次查表**真的**去掉，跑一次真的激活，断言越权真的发生。
 *
 * ⚠ 改的是源码的副本、跑在同一个数据库上，跑完文件即删。
 *   不改工作区里的文件：反证的意义是「这条防线是活的」，不是「留下一个坏掉的仓库」。
 */
describe("反证：把服务端那次查表改成信任链接参数，第一条断言当场红", () => {
  it("授予变成链接里写的 admin / 别的团队", async () => {
    const src = readFileSync(REPO_SRC, "utf8");
    // 这就是 I-2 的那一行：INSERT 的第 3、4 个参数。
    const GRANT = "[userId, orgId, actual.orgRole, actual.teamId]";
    expect(
      src.includes(GRANT),
      "授予语句的形状变了；反证必须跟着改，否则它会在什么都没验的情况下通过",
    ).toBe(true);

    const broken = src.replace(
      GRANT,
      "[userId, orgId, input.untrustedClaims.orgRole ?? actual.orgRole, input.untrustedClaims.teamId ?? actual.teamId]",
    );
    expect(broken).not.toBe(src);

    const dir = mkdtempSync(join(tmpdir(), "f10-counterproof-"));
    const brokenPath = join(API_DIR, "src/infrastructure/auth/__counterproof-tampered-repo.ts");
    const runner = join(dir, "run.ts");
    try {
      writeFileSync(brokenPath, broken);
      writeFileSync(
        runner,
        `
import { PgOrgInviteRepository } from ${JSON.stringify(brokenPath)};
import { PgDatabase } from ${JSON.stringify(join(API_DIR, "src/infrastructure/db/pg-database.ts"))};
import { appConfig } from ${JSON.stringify(join(API_DIR, "src/infrastructure/db/pg-config.ts"))};

// ⚠ 包一层 async IIFE 而不是用顶层 await：tsx 在这个仓库的配置下按 cjs 输出，
// 顶层 await 会 transform 失败——而失败信息是「不支持」，看起来完全不像反证本身出了问题。
void (async () => {
  const db = new PgDatabase(appConfig());
  const repo = new PgOrgInviteRepository(db);
  const [token, claimedRole, claimedTeam] = process.argv.slice(2);
  const r = await repo.activate({
    token: token!,
    now: new Date(),
    newAccount: { userId: "u-f10-counterproof", displayName: "x", passwordHash: ${JSON.stringify(fakeHasher.canned)} },
    existingUserId: null,
    untrustedClaims: { orgId: null, orgRole: claimedRole!, teamId: claimedTeam! },
  });
  console.log(JSON.stringify(r));
  await db.close();
})();
`,
      );

      const invited = await inviteConsultant("counterproof@f10tamper.test");
      const stdout = execFileSync(
        "node",
        [join(API_DIR, "../../node_modules/tsx/dist/cli.mjs"), runner, invited.token!, "admin", fixture.teams.platform!],
        { cwd: API_DIR, encoding: "utf8", env: { ...process.env, PGDATABASE: process.env.PGDATABASE } },
      );
      const result = JSON.parse(stdout.trim().split("\n").pop()!);

      expect(result.ok).toBe(true);

      // 🔴 防线被拆掉之后真的发生的事：库里那一行的 org_role 是**链接里写的 admin**。
      const rows = await membershipsOfUser("u-f10-counterproof", ORG);
      expect(rows).toHaveLength(1);
      expect(rows[0].org_role).toBe("admin");
      expect(rows[0].team_id).toBe(fixture.teams.platform);

      /**
       * ⚠ 这次反证顺手证明了另一件事，而且它比反证本身更值得写下来：
       *
       * **返回值仍然是 `consultant`。** 因为拆掉的是 INSERT 的参数，
       * 而 `grant` 是从 `actual` 里组出来的——两者在正确实现下恒等，
       * 在被拆掉的实现下分叉。所以一个**只断言返回值**的测试会在越权已经落库的情况下
       * 全绿。上面主断言里那三行读 `org_memberships` 的 SQL 不是补充证据，
       * 它们是唯一真正能失败的证据。
       */
      expect(result.grant.orgRole).toBe("consultant");
    } finally {
      rmSync(brokenPath, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * ⚠ 三个钩子都显式给了 60 秒，而不是吃 vitest 默认的 10 秒。
 *
 * `vitest.config.ts` 已经把 `testTimeout` 抬到 60 秒并写明了理由（要起 Nest、要 shell out），
 * 但 `hookTimeout` 当时没跟着抬。这里的 `beforeEach` 要 `resetOrgs`（级联删）
 * 加 `seedOrg`（四张表、多次连接），在这台机器同时跑着好几个 worker 时轻松超过 10 秒——
 * 于是**整个文件一起红**，红的理由是 `Hook timed out`，与被测的行为毫无关系。
 * 那种红比不跑还糟：它会把真实的失败淹掉，而且看起来像是本 feature 坏了。
 *
 * 只改本文件、不动共享的 `vitest.config.ts`：那份配置有别的 worker 正在同时依赖，
 * 抬全局超时是一次跨 feature 的改动，该由谁做是另一件事。
 */
