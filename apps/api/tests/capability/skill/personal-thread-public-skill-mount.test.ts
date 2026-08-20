/**
 * #1693 —— **个人对话可以挂载公共 skill**，且「谁能挂」放开没有把「能挂到什么」一起放开。
 *
 * ## 依据：人类产品裁决 2026-08-21（逐字）
 *
 * > 「个人对话必须要可以使用公共的 skills」
 * > 「所有的人都可以用」
 *
 * 裁决之前，服务端**两道闸**明确拒绝这件事（实测基线 origin/main
 * `5c7c3f30e49a4f3d6cb91159996f1b1dfca56b9b`）：
 *
 *   闸一 `skill-mount.controller.ts` 的 `requireProjectId(projectId)`——个人对话
 *        `project_id IS NULL`，没有 projectId 可传 ⇒ 422，连用例层都到不了。
 *   闸二 `domain/skill/thread-mount.ts` 的 `isSelfMountAllowed(role) => role === "引导师"`
 *        ——`引导师` 是**项目**角色，个人对话没有项目 ⇒ 没有角色 ⇒ 必然被拒。
 *
 * 佐证：devapp 上 `thread_skill_mounts` 计数至今为 0。
 *
 * ## 真栈，不打桩
 *
 * 真实 HTTP（`createApp()`）+ 真实 Postgres。T1 不止看 201，还回数据库确认
 * `thread_skill_mounts` **真落了行**——一个只断言状态码的挂载测试，无法把
 * 「挂上了」与「返回了一个像样的 JSON」区分开。
 *
 * ## ⚠ 红 ≠ 反证成立（这条比下面任何一格断言都重要）
 *
 * 本文件四条反证都实测变红。但 **T3 的第一版反证是「因为错误的原因」红的**：
 * 当时的改法是把 `visibilityPort()` 里的 `discloseDecided` 整段摘掉、直接交出
 * `loadMountableRow` 的行——它顺手弄坏了 `status` 映射，于是 T3 以
 * `SKILL_NOT_ENABLED`（422）失败。**它确实红了，但它没有证明任何关于可见性的事**：
 * 挂载在够到范围判定之前就已经因为另一个原因失败了。
 *
 * 换成现在这条外科式反证（令 `decideCapabilityVisibility` 恒收
 * `scope: "org-wide"`，其余管线一个字不动）之后，T3 变成 **201 ≠ 404**——
 * 这才是「范围判定被绕过」该有的形状，且其余六条**全部保持绿**，
 * 说明这一刀精确地只切在 T3 守的那条边界上。
 *
 * ⇒ **写反证时要看的不是「有没有变红」，是「红的原因是不是你要证的那件事」，
 *   以及「有没有连累到不该红的格子」**。一条因为副作用而红的反证，
 *   与一条根本没有守住任何东西的断言，在 CI 上长得一模一样。
 *   本仓已九次栽在「全绿但空转」上；这是它的镜像版本：**全红但空证**。
 *
 * ## ⭐ T3 是这份文件里最重要的一格
 *
 * 放开的是**谁能挂**，不是**能挂到什么**。可见性过滤（I-14：不存在与不可见
 * 同一出口 `SKILL_NOT_FOUND`，不泄露存在性）是安全边界，本次一个字没动。
 * T3 就是那条边界的守卫：授权已经通过的人，去挂一个对他不可见的 skill，
 * 仍然只能得到 `SKILL_NOT_FOUND`。
 */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { skills as C } from "@repo/contracts";
import { mountListFingerprint } from "../../../src/domain/skill/thread-mount";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1693-personal-mount";
const PROJECT = "proj-i1693-personal-mount";
const OTHER_PROJECT = "proj-i1693-other";

/** 个人对话的主人。**不是**任何项目的引导师——裁决前他挂不了任何东西。 */
const OWNER = "u-i1693-owner";
/** 项目里的普通组员。裁决前恒 `MEMBER_CANNOT_SELF_MOUNT`。 */
const MEMBER = "u-i1693-member";
/** 项目里的观察者：只读角色，放开之后**仍然**不能写。 */
const OBSERVER = "u-i1693-observer";

let app: NestExpressApplication;
let base = "";
let teams: Record<string, string> = {};

/** 空挂载列表的确定指纹——从 domain 取，不在测试里重算一份（同一事实不写两处）。 */
const EMPTY_LIST_FINGERPRINT = mountListFingerprint([]);

const authFor = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

/**
 * ⚠ 刻意**不传** `?projectId=`：#1693 之后它对授权毫无影响（项目从线程反查）。
 *   T4 里有一条专门证明「传了也没用」。
 */
function mount(userId: string, threadId: string, skillId: string): Promise<Response> {
  return fetch(`${base}/threads/${threadId}/skill-mounts`, {
    method: "POST",
    headers: authFor(userId),
    body: JSON.stringify(
      C.operations.mountSkillToThread.in.parse({
        threadId,
        skillIds: [skillId],
        expectedVersion: EMPTY_LIST_FINGERPRINT,
      }),
    ),
  });
}

/** 个人对话：`project_id IS NULL`，仅创建者可读（`resolvePersonalVisibility` 的分支）。 */
async function seedPersonalThread(ownerUserId: string): Promise<string> {
  const threadId = `thread-i1693-personal-${randomUUID()}`;
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO chat_threads
         (id, org_id, project_id, group_id, visibility_scope, created_by, created_at, last_activity_at)
       VALUES ($1,$2,NULL,NULL,'private',$3,now(),now())`,
      [threadId, ORG, ownerUserId],
    );
  });
  return threadId;
}

async function seedProjectThread(projectId: string): Promise<string> {
  const threadId = `thread-i1693-project-${randomUUID()}`;
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO chat_threads
         (id, org_id, project_id, group_id, visibility_scope, created_by, created_at, last_activity_at)
       VALUES ($1,$2,$3,NULL,'plenary',$4,now(),now())`,
      [threadId, ORG, projectId, OWNER],
    );
  });
  return threadId;
}

/**
 * 一条「公共」skill：`visibility='org-wide'`，全组织可见——正是裁决里
 * 「公共的 skills」指的那种。
 */
async function seedPublicSkill(): Promise<string> {
  return seedSkill("org-wide", null);
}

/**
 * 一条**对 MEMBER 不可见**的 skill：`team-only` 且属于他不在的那个团队。
 * T3 用它证明可见性边界没被放宽。
 */
async function seedTeamOnlySkill(ownerTeamId: string): Promise<string> {
  return seedSkill("team-only", ownerTeamId);
}

async function seedSkill(visibility: string, ownerTeamId: string | null): Promise<string> {
  const skillId = `skill-i1693-${randomUUID()}`;
  const versionId = `skill-version-i1693-${randomUUID()}`;
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO skill_contracts
         (id, org_id, name, duty, source, status, visibility, owner_team_id,
          current_version_id, archived, created_by, tags)
       VALUES ($1,$2,$3,'i1693 fixture duty','自建','已启用',$4,$5,$6,false,$7,'{}')`,
      [skillId, ORG, skillId, visibility, ownerTeamId, versionId, OWNER],
    );
  });
  return skillId;
}

/** 回数据库数真行数——「挂上了」的判据，不是「返回了一个像样的 JSON」。 */
async function countMounts(threadId: string): Promise<number> {
  let count = 0;
  await asApp(ORG, async (c) => {
    const r = await c.query(
      "SELECT count(*)::int AS n FROM thread_skill_mounts WHERE thread_id = $1 AND removed_at IS NULL",
      [threadId],
    );
    count = r.rows[0]?.n ?? 0;
  });
  return count;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT });
  teams = fixture.teams;

  // 第二个项目：T4 用它证明「别的项目的线程挂不进来」。
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [
      OTHER_PROJECT,
      ORG,
      OTHER_PROJECT,
    ]),
  );

  // 三个人都在组织里，且都在 energy 团队 —— 于是 T3 的 `team-only`（platform）
  // 对他们不可见的原因**只能是**可见性判定，不是「他压根不在这个组织」。
  await addOrgMember(ORG, OWNER, "consultant", teams.energy ?? null);
  await addOrgMember(ORG, MEMBER, "consultant", teams.energy ?? null);
  await addOrgMember(ORG, OBSERVER, "consultant", teams.energy ?? null);

  await addProjectMember(ORG, PROJECT, MEMBER, "member", null, false);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null, false);
  // ⚠ OWNER 刻意**不是** PROJECT 的成员：T1 要证明的是「不靠任何项目角色也能挂」。

  const { createApp } = await import("../../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

describe("#1693 · 个人对话可挂载公共 skill（人类裁决 2026-08-21）", () => {
  /**
   * T1 —— 裁决的正面断言。
   * 反证：恢复 `requireProjectId` ⇒ 这一条变 422（无 projectId 可传）。
   */
  it("T1 · 个人对话所有者挂组织可见 skill ⇒ 201，且 thread_skill_mounts 真落行", async () => {
    const threadId = await seedPersonalThread(OWNER);
    const skillId = await seedPublicSkill();

    expect(await countMounts(threadId)).toBe(0);

    const response = await mount(OWNER, threadId, skillId);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);

    const parsed = C.operations.mountSkillToThread.out.parse(body);
    expect(parsed.mounts).toHaveLength(1);
    expect(parsed.mounts[0]?.skillId).toBe(skillId);

    // 🔴 真落库。devapp 上这个计数至今为 0，正是本 issue 的起点。
    expect(await countMounts(threadId)).toBe(1);
  });

  /**
   * T2 —— 「所有的人都可以用」。
   * 反证：恢复 `isSelfMountAllowed(role) => role === "引导师"` ⇒ 这一条变 403。
   */
  it("T2 · 项目对话里的普通组员（非引导师）也能挂载 ⇒ 201", async () => {
    const threadId = await seedProjectThread(PROJECT);
    const skillId = await seedPublicSkill();

    const response = await mount(MEMBER, threadId, skillId);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(201);
    expect(await countMounts(threadId)).toBe(1);
  });

  /**
   * ⭐ T3 —— 安全边界没有被一起放宽。
   * 反证：把 `visibilityPort()` 里的 `decideCapabilityVisibility`/`discloseDecided`
   * 摘掉（直接返回 `loadMountableRow` 的行）⇒ 这一条变 201。
   */
  it("⭐ T3 · 挂一个对该用户不可见的 skill ⇒ 仍然 404 SKILL_NOT_FOUND，且不落行", async () => {
    const threadId = await seedProjectThread(PROJECT);
    // platform 团队私有；MEMBER 在 energy。
    const invisible = await seedTeamOnlySkill(teams.platform ?? "team-missing");

    const response = await mount(MEMBER, threadId, invisible);
    const body = (await response.json()) as { readonly reasonCode?: string };
    expect(response.status, JSON.stringify(body)).toBe(404);
    expect(body.reasonCode).toBe("SKILL_NOT_FOUND");
    expect(await countMounts(threadId)).toBe(0);
  });

  /**
   * ⭐ T4 —— 跨线程仍被拒。
   * 这一条在**裁决之前是红的**（既有越权洞）：当时授权只看调用方自传的
   * `?projectId=`，MEMBER 带上自己项目的 id 就能挂到别人的个人线程上。
   * 反证：恢复「信任 query 里的 projectId」⇒ 这一条变 201。
   */
  it("⭐ T4a · 挂到别人的个人线程 ⇒ 403，且不落行", async () => {
    const ownersThread = await seedPersonalThread(OWNER);
    const skillId = await seedPublicSkill();

    const response = await mount(MEMBER, ownersThread, skillId);
    expect(response.status).toBe(403);
    expect(await countMounts(ownersThread)).toBe(0);
  });

  it("⭐ T4b · 挂到自己不是成员的那个项目的线程 ⇒ 403，且不落行", async () => {
    const foreignThread = await seedProjectThread(OTHER_PROJECT);
    const skillId = await seedPublicSkill();

    const response = await mount(MEMBER, foreignThread, skillId);
    expect(response.status).toBe(403);
    expect(await countMounts(foreignThread)).toBe(0);
  });

  /**
   * ⭐ T4c —— 「传了 projectId 也没用」。这一条钉住的是**修法本身**：
   * 授权不再有任何一条通路会读请求里的 `projectId`。
   */
  it("⭐ T4c · 带上自己有权限的 ?projectId= 去挂别人的个人线程 ⇒ 仍然 403", async () => {
    const ownersThread = await seedPersonalThread(OWNER);
    const skillId = await seedPublicSkill();

    const response = await fetch(
      // MEMBER 确实是 PROJECT 的成员——旧代码正是据此放行的。
      `${base}/threads/${ownersThread}/skill-mounts?projectId=${PROJECT}`,
      {
        method: "POST",
        headers: authFor(MEMBER),
        body: JSON.stringify(
          C.operations.mountSkillToThread.in.parse({
            threadId: ownersThread,
            skillIds: [skillId],
            expectedVersion: EMPTY_LIST_FINGERPRINT,
          }),
        ),
      },
    );
    expect(response.status).toBe(403);
    expect(await countMounts(ownersThread)).toBe(0);
  });

  /**
   * 观察者 —— 「所有的人都可以用」放开的是组员，**不包括只读角色**。
   * 给只读角色一个写入口，等于取消了这个角色。同发消息路径的判据。
   */
  it("T4d · 项目里的观察者（只读）⇒ 403，且不落行", async () => {
    const threadId = await seedProjectThread(PROJECT);
    const skillId = await seedPublicSkill();

    const response = await mount(OBSERVER, threadId, skillId);
    expect(response.status).toBe(403);
    expect(await countMounts(threadId)).toBe(0);
  });
});
