/**
 * 组织首页配置（ad-hoc feature，Refs #4634）—— 真实 Postgres。
 *
 * 反证：
 *   · 未建过行的组织 → 返回固定默认值（不是编出来的组织专属文案）；
 *   · 非成员读 → `NO_ORG_MEMBERSHIP`；
 *   · 非 admin 写 → `FORBIDDEN`，库内未变（独立 re-read 验证）；
 *   · admin 写 → 真的落库（独立 re-read 验证），且能再读回同一份；
 *   · controller 响应 key 集合逐字等于契约 out。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { homeConfig as C } from "@repo/contracts";
import { getHomeConfig, DEFAULT_HOME_CONFIG_TITLE } from "../../src/application/home/get-home-config";
import { updateHomeConfig } from "../../src/application/home/update-home-config";
import { PgHomeConfigRepository } from "../../src/infrastructure/home/pg-home-config-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { HomeConfigController } from "../../src/interface/controllers/home-config.controller";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addCredential, addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-4634-home-config";
const ADMIN = "u-4634-home-admin";
const MEMBER = "u-4634-home-member";

let db: PgDatabase;
let repo: PgHomeConfigRepository;
let identity: PgIdentityRepository;
let controller: HomeConfigController;

const HOOK_TIMEOUT_MS = 60_000;

const QUICK_ACTIONS = [
  { key: "chat" as const, enabled: true, order: 0 },
  { key: "projects" as const, enabled: false, order: 1 },
];

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgHomeConfigRepository(db);
  identity = new PgIdentityRepository(db);
  controller = new HomeConfigController(repo, identity);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
});

async function readRow(orgId: string): Promise<{ title: string } | undefined> {
  return asOwner(async (c) => {
    const r = await c.query<{ title: string }>(`SELECT title FROM org_home_configs WHERE org_id = $1`, [orgId]);
    return r.rows[0];
  });
}

describe("getHomeConfig", () => {
  it("未建过行 —— 返回固定默认值，库里没有行（不编一份示例数据）", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });

    const out = await getHomeConfig({ repo }, toOrgId(ORG));
    expect(out.title).toBe(DEFAULT_HOME_CONFIG_TITLE);
    expect(out.recommendedCapabilities).toEqual([]);

    expect(await readRow(ORG)).toBeUndefined();
  });

  it("controller 路由层：非成员读 —— NO_ORG_MEMBERSHIP", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });

    await expect(
      controller.get(ORG, { userId: "u-not-a-member", orgId: toOrgId(ORG) }),
    ).rejects.toMatchObject(new ForbiddenException({ reasonCode: "NO_ORG_MEMBERSHIP" }));
  });
});

describe("updateHomeConfig", () => {
  it("admin 调用 —— 真的落库，独立 re-read 验证（不只看响应体）", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });

    const out = await updateHomeConfig(
      { repo },
      {
        orgId: toOrgId(ORG),
        title: "海尔法务",
        tagline: "AI 法务团队",
        bannerHeadline: "让创造更有人性",
        bannerTagline: "AI + Real Work",
        bannerPreset: "forest",
        quickActions: QUICK_ACTIONS,
        recommendedCapabilities: [
          { kind: "skill", refId: "skill-rec-1", name: "录音转写", note: "会议记录直接转文字" },
        ],
        updatedBy: ADMIN,
      },
    );
    expect(out.title).toBe("海尔法务");
    expect(out.recommendedCapabilities).toHaveLength(1);

    const reread = await getHomeConfig({ repo }, toOrgId(ORG));
    expect(reread.title).toBe("海尔法务");
    expect(reread.bannerPreset).toBe("forest");
    expect(reread.quickActions).toEqual(QUICK_ACTIONS);
  });

  it("controller 路由层：非 admin 写 —— FORBIDDEN，库内未变", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await addCredential(MEMBER, "member@4634-home.test", "Member");
    await addOrgMember(ORG, MEMBER, "consultant", null);

    const body = {
      title: "Hijacked",
      tagline: null,
      bannerHeadline: "x",
      bannerTagline: "",
      bannerPreset: "ocean" as const,
      quickActions: [],
      recommendedCapabilities: [],
    };

    await expect(
      controller.update(ORG, body, { userId: MEMBER, orgId: toOrgId(ORG) }),
    ).rejects.toMatchObject(new ForbiddenException({ reasonCode: "FORBIDDEN" }));

    expect(await readRow(ORG)).toBeUndefined();
  });

  it("controller 响应 key 集合逐字等于契约 out", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await addCredential(ADMIN, "admin@4634-home.test", "Admin");
    await addOrgMember(ORG, ADMIN, "admin", null);

    const out = await controller.update(
      ORG,
      {
        title: "Key Set Check",
        tagline: null,
        bannerHeadline: "h",
        bannerTagline: "t",
        bannerPreset: "midnight",
        quickActions: [],
        recommendedCapabilities: [],
      },
      { userId: ADMIN, orgId: toOrgId(ORG) },
    );

    expect(Object.keys(out).sort()).toEqual(Object.keys(C.HomeConfig.shape).sort());
    expect(() => C.HomeConfig.parse(out)).not.toThrow();
  });
});
