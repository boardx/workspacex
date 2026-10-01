/**
 * 组织首页配置（ad-hoc feature，Refs #4634 / #4698）—— 真实 Postgres + 内存对象存储。
 *
 * 反证：
 *   · 未建过行的组织 → 返回固定默认值（不是编出来的组织专属文案），库里没有行；
 *   · 非成员读 → `NO_ORG_MEMBERSHIP`；
 *   · 非 admin 写 / 传横幅 → `FORBIDDEN`，库内未变、对象存储未写；
 *   · admin 写 → 真的落库（独立 re-read 验证），含自定义色、推荐数字人、板块开关、10 个入口；
 *   · 选「自定义」却没给色值 → `BANNER_COLOR_REQUIRED`，库内未变；
 *   · 横幅图：伪造字节（声明 png 实为文本）被嗅探拒绝且不落对象存储；超限被拒；
 *     引用不存在/别的组织的图 → `BANNER_ARTIFACT_NOT_OWNED`；上传→引用→读回字节一致；
 *   · controller 响应 key 集合逐字等于契约 out。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException, HttpException } from "@nestjs/common";
import type { Request } from "express";
import { homeConfig as C } from "@repo/contracts";
import { getHomeConfig, DEFAULT_HOME_CONFIG_TITLE } from "../../src/application/home/get-home-config";
import { updateHomeConfig } from "../../src/application/home/update-home-config";
import { uploadHomeBanner } from "../../src/application/home/upload-home-banner";
import { HomeConfigDomainError } from "../../src/application/home/home-config-errors";
import type { UpsertHomeConfigInput } from "../../src/application/home/home-config-ports";
import { MAX_AVATAR_BYTES } from "../../src/application/auth/upload-org-avatar";
import { PgHomeConfigRepository } from "../../src/infrastructure/home/pg-home-config-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { HomeConfigController } from "../../src/interface/controllers/home-config.controller";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { FakeObjectStore } from "../support/artifact-fakes";
import { addCredential, addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-4634-home-config";
const OTHER_ORG = "org-4634-home-config-other";
const ADMIN = "u-4634-home-admin";
const MEMBER = "u-4634-home-member";

let db: PgDatabase;
let store: FakeObjectStore;
let repo: PgHomeConfigRepository;
let identity: PgIdentityRepository;
let controller: HomeConfigController;

const HOOK_TIMEOUT_MS = 60_000;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const QUICK_ACTIONS = [
  { key: "chat" as const, enabled: true, order: 0 },
  { key: "projects" as const, enabled: false, order: 1 },
];

function input(over: Partial<UpsertHomeConfigInput> = {}): UpsertHomeConfigInput {
  return {
    title: "海尔法务",
    tagline: "AI 法务团队",
    bannerHeadline: "让创造更有人性",
    bannerTagline: "AI + Real Work",
    bannerPreset: "forest",
    bannerColor: null,
    bannerImageArtifactId: null,
    quickActions: QUICK_ACTIONS,
    recommendedCapabilities: [{ kind: "skill", refId: "skill-rec-1", name: "录音转写", note: "会议记录直接转文字" }],
    recommendedAgents: [{ agentId: "agent-1", name: "小研", roleLabel: "研究员", avatarKey: null, note: null }],
    sections: { recentWork: true, currentTasks: false },
    updatedBy: ADMIN,
    ...over,
  };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  store = new FakeObjectStore();
  repo = new PgHomeConfigRepository(db, store);
  identity = new PgIdentityRepository(db);
  controller = new HomeConfigController(repo, identity);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
});

async function readRow(orgId: string): Promise<{ title: string } | undefined> {
  return asOwner(async (c) => {
    const r = await c.query<{ title: string }>(`SELECT title FROM org_home_configs WHERE org_id = $1`, [orgId]);
    return r.rows[0];
  });
}

async function asMember(orgId: string, userId: string, role: "admin" | "consultant"): Promise<void> {
  await addCredential(userId, `${userId}@4634-home.test`, userId);
  await addOrgMember(orgId, userId, role, null);
}

describe("getHomeConfig", () => {
  it("未建过行 —— 返回固定默认值（含 8 个默认入口），库里没有行（不编一份示例数据）", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });

    const out = await getHomeConfig({ repo }, toOrgId(ORG));
    expect(out.title).toBe(DEFAULT_HOME_CONFIG_TITLE);
    expect(out.recommendedCapabilities).toEqual([]);
    expect(out.recommendedAgents).toEqual([]);
    expect(out.bannerImageUrl).toBeNull();
    expect(out.quickActions.filter((a) => a.enabled).map((a) => a.key)).toEqual([
      "chat", "projects", "research", "interview", "survey", "recording", "design", "brain",
    ]);
    expect(out.sections).toEqual({ recentWork: true, currentTasks: true });

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

    const out = await updateHomeConfig({ repo }, { orgId: toOrgId(ORG), ...input() });
    expect(out.title).toBe("海尔法务");
    expect(out.recommendedCapabilities).toHaveLength(1);

    const reread = await getHomeConfig({ repo }, toOrgId(ORG));
    expect(reread.title).toBe("海尔法务");
    expect(reread.bannerPreset).toBe("forest");
    expect(reread.bannerColor).toBeNull();
    expect(reread.quickActions).toEqual(QUICK_ACTIONS);
    expect(reread.recommendedAgents).toEqual(input().recommendedAgents);
    expect(reread.sections).toEqual({ recentWork: true, currentTasks: false });
  });

  it("自定义色：#RRGGBB 落库；切回预设后库里不残留旧色值", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });

    await updateHomeConfig({ repo }, { orgId: toOrgId(ORG), ...input({ bannerPreset: "custom", bannerColor: "#1A2b3C" }) });
    expect((await getHomeConfig({ repo }, toOrgId(ORG))).bannerColor).toBe("#1A2b3C");

    await updateHomeConfig({ repo }, { orgId: toOrgId(ORG), ...input({ bannerPreset: "rose", bannerColor: "#1A2b3C" }) });
    const back = await getHomeConfig({ repo }, toOrgId(ORG));
    expect(back.bannerPreset).toBe("rose");
    expect(back.bannerColor).toBeNull();
  });

  it("选「自定义」却没给色值 —— BANNER_COLOR_REQUIRED，库内未变", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });

    await expect(
      updateHomeConfig({ repo }, { orgId: toOrgId(ORG), ...input({ bannerPreset: "custom", bannerColor: null }) }),
    ).rejects.toMatchObject({ reasonCode: "BANNER_COLOR_REQUIRED" });
    expect(await readRow(ORG)).toBeUndefined();
  });

  it("契约：非法色值（#FFF、缺 #、非十六进制）一律被 zod 拒绝", () => {
    for (const bad of ["#FFF", "1A2B3C", "#GGGGGG", "#1A2B3C4D", ""]) {
      expect(C.BannerColor.safeParse(bad).success, bad).toBe(false);
    }
    expect(C.BannerColor.safeParse("#a1B2c3").success).toBe(true);
  });

  it("controller 路由层：非 admin 写 —— FORBIDDEN，库内未变", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await asMember(ORG, MEMBER, "consultant");

    const { updatedBy: _u, ...body } = input({ title: "Hijacked" });
    await expect(
      controller.update(ORG, { orgId: ORG, ...body } as never, { userId: MEMBER, orgId: toOrgId(ORG) }),
    ).rejects.toMatchObject(new ForbiddenException({ reasonCode: "FORBIDDEN" }));

    expect(await readRow(ORG)).toBeUndefined();
  });

  it("controller 响应 key 集合逐字等于契约 out", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await asMember(ORG, ADMIN, "admin");

    const { updatedBy: _u, ...body } = input({ title: "Key Set Check", bannerPreset: "midnight" });
    const out = await controller.update(ORG, { orgId: ORG, ...body } as never, { userId: ADMIN, orgId: toOrgId(ORG) });

    expect(Object.keys(out).sort()).toEqual(Object.keys(C.HomeConfig.shape).sort());
    expect(() => C.HomeConfig.parse(out)).not.toThrow();
  });
});

describe("横幅图片", () => {
  it("上传 → 引用 → 读回：URL 出现在配置里，字节与上传的一致", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });

    const up = await uploadHomeBanner(
      { repo },
      { orgId: toOrgId(ORG), actorId: ADMIN, bytes: PNG, declaredContentType: "image/png", declaredSha256: "x" },
    );
    const cfg = await updateHomeConfig(
      { repo },
      { orgId: toOrgId(ORG), ...input({ bannerImageArtifactId: up.bannerImageArtifactId }) },
    );
    expect(cfg.bannerImageUrl).toBe(up.bannerImageUrl);

    const bytes = await repo.readBannerBytes(toOrgId(ORG), up.bannerImageArtifactId);
    expect(bytes?.contentType).toBe("image/png");
    expect(Array.from(bytes?.bytes ?? [])).toEqual(Array.from(PNG));
  });

  it("伪造字节（声明 png 实为文本）—— UNSUPPORTED_CONTENT_TYPE，对象存储没有落地", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    const before = store.putCount;

    await expect(
      uploadHomeBanner(
        { repo },
        {
          orgId: toOrgId(ORG),
          actorId: ADMIN,
          bytes: new TextEncoder().encode("not an image at all"),
          declaredContentType: "image/png",
          declaredSha256: "x",
        },
      ),
    ).rejects.toMatchObject({ reasonCode: "UNSUPPORTED_CONTENT_TYPE" });
    expect(store.putCount).toBe(before);
  });

  it("超过 5MB / 空文件 —— FILE_TOO_LARGE，对象存储没有落地", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    const before = store.putCount;
    const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
    big.set(PNG);

    for (const bytes of [big, new Uint8Array(0)]) {
      await expect(
        uploadHomeBanner(
          { repo },
          { orgId: toOrgId(ORG), actorId: ADMIN, bytes, declaredContentType: "image/png", declaredSha256: "x" },
        ),
      ).rejects.toBeInstanceOf(HomeConfigDomainError);
    }
    expect(store.putCount).toBe(before);
  });

  it("引用不存在的图 / 别的组织的图 —— BANNER_ARTIFACT_NOT_OWNED，库内未变", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await seedOrg({ orgId: OTHER_ORG, teamNames: [], projectId: `${OTHER_ORG}-p` });

    const foreign = await uploadHomeBanner(
      { repo },
      { orgId: toOrgId(OTHER_ORG), actorId: ADMIN, bytes: PNG, declaredContentType: "image/png", declaredSha256: "x" },
    );

    for (const id of ["home-banner-does-not-exist", foreign.bannerImageArtifactId]) {
      await expect(
        updateHomeConfig({ repo }, { orgId: toOrgId(ORG), ...input({ bannerImageArtifactId: id }) }),
      ).rejects.toMatchObject({ reasonCode: "BANNER_ARTIFACT_NOT_OWNED" });
    }
    expect(await readRow(ORG)).toBeUndefined();
    // 别的组织读不到这张图（RLS）。
    expect(await repo.readBannerBytes(toOrgId(ORG), foreign.bannerImageArtifactId)).toBeNull();
  });

  it("controller 路由层：非 admin 传横幅 —— FORBIDDEN，对象存储没有落地", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await asMember(ORG, MEMBER, "consultant");
    const before = store.putCount;

    await expect(
      controller.uploadBanner(ORG, "a.png", "12", "x", "image/png", {} as Request, {
        userId: MEMBER,
        orgId: toOrgId(ORG),
      }),
    ).rejects.toMatchObject(new ForbiddenException({ reasonCode: "FORBIDDEN" }));
    expect(store.putCount).toBe(before);
  });

  it("controller 路由层：声明的 sizeBytes 超限 / contentType 不合法 —— 413 / 415 同形状", async () => {
    await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
    await asMember(ORG, ADMIN, "admin");
    const principal = { userId: ADMIN, orgId: toOrgId(ORG) };

    const tooBig = await controller
      .uploadBanner(ORG, "a.png", String(MAX_AVATAR_BYTES + 1), "x", "image/png", {} as Request, principal)
      .catch((e: unknown) => e);
    expect(tooBig).toBeInstanceOf(HttpException);
    expect((tooBig as HttpException).getStatus()).toBe(413);

    const badType = await controller
      .uploadBanner(ORG, "a.gif", "10", "x", "image/gif", {} as Request, principal)
      .catch((e: unknown) => e);
    expect((badType as HttpException).getStatus()).toBe(415);
  });
});
