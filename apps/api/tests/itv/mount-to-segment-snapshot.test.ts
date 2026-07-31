/**
 * F81 —— 挂到项目环节：**固定快照绑定**（uc-6-0 R3步骤7 / A3 / V4，D-30 / I-30）。
 *
 * ## 这个文件要证的三件事，以及每一件的反证
 *
 * ① **挂上之后上游改了，已挂的那一条不跟着变。**
 *    反证：把 `SNAPSHOT_JOIN` 从「按 pinned_version_id 取」改成「按 artifact 取 head」，
 *    本文件必须当场红。文件末尾有一个**常驻**的反证版仓储把这件事跑出来 ——
 *    一条永远不可能红的断言与没有断言是同一回事。
 *    ⚠ 关键在于：只有一个版本时两种写法**结果完全一样**。所以每一条快照断言都必须在
 *    head 已经往前走过之后才做，否则这道门在写完的当天就是空转的。
 *
 * ② **不是固定快照的东西挂不上**（`REQUIRES_PINNED`）。
 *    反证：换一个没有任何 pinned 绑定钉住的版本，必须被拒；且**绕开 use case 直接写库**
 *    也要被拒 —— 门在数据库里，不只在用例里。
 *
 * ③ **挂载改变可见性走的是 F80 那一条谓词，解除后回到「不属于任何项目」且产出仍在。**
 *    反证：挂之前项目成员看不见（否则「挂上才可见」测的是个恒真命题）；
 *    解除之后项目成员又看不见，而创建者仍看得见。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { resetInterviews, seedInterview } from "../support/interview-db";
import { makeHarness, seedArtifact, enc, type Harness } from "../support/binding-fixture";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgInterviewAttachmentRepository } from "../../src/infrastructure/interview/pg-interview-attachment-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { attachToProjectStep } from "../../src/application/interview/attach-to-project-step";
import { detachFromProjectStep } from "../../src/application/interview/detach-from-project-step";
import { listInterviews } from "../../src/application/interview/list-interviews";
import { RequiresPinnedError, NoInterviewAccessError } from "../../src/application/interview/errors";
import { pinVersion } from "../../src/application/artifact/pin-version";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f81-mount";
const PROJECT = "proj-f81-mount";

const CREATOR = "u-f81m-creator";
/** 该项目的成员，但**不是**这场访谈的创建者也不是显式协作者。 */
const MEMBER = "u-f81m-member";

const ITV = "itv-f81m-1";
const ALL_ITV = [ITV];
const STEP = "step-f81m-1";

let db: PgDatabase;
let scope: PgInterviewScopeRepository;
let attachments: PgInterviewAttachmentRepository;
let provenance: PgProvenanceRepository;
let h: Harness;

const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();
const scopeNone = { kind: "none" as const, projectId: null, researchProjectId: null };
const scopeProject = { kind: "project" as const, projectId: PROJECT, researchProjectId: null };

const deps = () => ({ repo: scope, attachments, provenance, decisions, ids });

/** 直接把一条 pinned 绑定写进去。绑定本身怎么建是 F06 的事，本文件只需要「这一版被钉住了」。 */
async function pinBinding(artifactId: string, versionId: string, stepId: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO artifact_bindings
         (id, org_id, artifact_id, project_id, step_id, mode, pinned_version_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'pinned',$6,$7)`,
      [`bind-${versionId}-${stepId}`, ORG, artifactId, PROJECT, stepId, versionId, CREATOR],
    ),
  );
}

let artifactId: string;
let v1: string;
let v1Hash: string;

const hashOf = async (versionId: string): Promise<string> =>
  asApp(ORG, async (c) => {
    const r = await c.query<{ content_hash: string }>(
      "SELECT content_hash FROM artifact_versions WHERE id = $1",
      [versionId],
    );
    return r.rows[0]!.content_hash;
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  scope = new PgInterviewScopeRepository(db);
  attachments = new PgInterviewAttachmentRepository(db);
  provenance = new PgProvenanceRepository(db);
  h = await makeHarness("f81m");
  // ⚠ 与 F80 同因：hookTimeout 默认 10s，而这个 hook 要拉容器 + 跑迁移 + 建对象存储。
}, 120_000);

afterAll(async () => {
  await resetInterviews(ORG, ALL_ITV);
  await resetOrgs(ORG);
  await h?.close();
  await db?.close();
});

beforeEach(async () => {
  await resetInterviews(ORG, ALL_ITV);
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  for (const u of [CREATOR, MEMBER]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  // CREATOR 也在项目里：`pre` 要求「对该项目该环节有写权限」，而本仓能求值的那一半是项目成员身份。
  await addProjectMember(ORG, PROJECT, CREATOR, "facilitator", null);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", null);

  // 一场**不属于任何项目**的访谈 —— R4 的原话是「把一场无项目访谈挂到项目环节」。
  await seedInterview({ orgId: ORG, id: ITV, createdBy: CREATOR, projectId: null });

  const art = await seedArtifact(h, ORG, PROJECT, ["v1 的内容"], CREATOR);
  artifactId = art.artifactId;
  v1 = art.versionIds[0]!;
  v1Hash = await hashOf(v1);
  await pinBinding(artifactId, v1, "step-pin-source");
}, 90_000);

/** 让上游往前走一版。**每一条快照断言之前都要跑它**，否则那条断言在只有一版时恒真。 */
async function moveHead(body: string): Promise<{ versionId: string; hash: string }> {
  const r = await pinVersion(
    { store: h.store, repo: h.deps.artifacts, ids: h.ids, provenance: h.provenance },
    {
      orgId: toOrgId(ORG),
      artifactId,
      expectedHeadVersion: 1,
      source: "conversation",
      title: "a chat",
      actorId: CREATOR,
      parts: { "messages.jsonl": enc(body) },
    },
  );
  return { versionId: r.versionId, hash: await hashOf(r.versionId) };
}

const attach = () =>
  attachToProjectStep(deps(), {
    orgId: toOrgId(ORG),
    actorId: CREATOR,
    interviewId: ITV,
    projectId: PROJECT,
    stepId: STEP,
    pinnedVersionId: v1,
  });

/* ───────────── ① 固定快照：上游往前走，已挂的这一条不动 ───────────── */

describe("① 挂的是固定快照 —— 上游继续定版，已挂的那一条不跟着走（V4③ / D-30）", () => {
  it("head 换到 v2 之后，挂载读回来的仍是 v1 与 v1 的 content_hash", async () => {
    const a = await attach();
    const head = await moveHead("v2 的内容");

    // 前置：两版**确实不同**。若哈希相同，下面那条断言无论实现怎么写都会绿。
    expect(head.versionId).not.toBe(v1);
    expect(head.hash).not.toBe(v1Hash);

    // 仓储仍然找得到这条挂载（载荷是 `Guarded<T>`，只能经判定取出，所以这里只断言它在）。
    expect(await attachments.find(toOrgId(ORG), CREATOR, a.attachmentId)).not.toBeNull();

    // 读回来的快照身份 —— 与仓储的 `SNAPSHOT_JOIN` 逐字同一条。
    const row = await asApp(ORG, async (c) => {
      const r = await c.query<{ pinned_version_id: string; content_hash: string }>(
        `SELECT a.pinned_version_id, v.content_hash
           FROM interview_step_attachments a
           JOIN artifact_versions v ON v.id = a.pinned_version_id AND v.org_id = a.org_id
          WHERE a.id = $1`,
        [a.attachmentId],
      );
      return r.rows[0]!;
    });
    expect(row.pinned_version_id, "挂载跟着上游走了").toBe(v1);
    expect(row.content_hash, "挂载读到的是 head 的字节，不是当初那一份").toBe(v1Hash);
  });

  it("反证：同一条挂载若按「取该 artifact 的当前 head」解析，读到的是 v2 —— 上面那条断言有牙齿", async () => {
    const a = await attach();
    const head = await moveHead("v2 的内容");

    // 逐字就是「把读快照改成读当前值」那个改动。
    const asHead = await asApp(ORG, async (c) => {
      const r = await c.query<{ pinned_version_id: string; content_hash: string }>(
        `SELECT a.pinned_version_id, v.content_hash
           FROM interview_step_attachments a
           JOIN artifact_versions pinned ON pinned.id = a.pinned_version_id
           JOIN LATERAL (
             SELECT vv.content_hash FROM artifact_versions vv
              WHERE vv.artifact_id = pinned.artifact_id AND vv.org_id = a.org_id
              ORDER BY vv.version_number DESC LIMIT 1
           ) v ON true
          WHERE a.id = $1`,
        [a.attachmentId],
      );
      return r.rows[0]!;
    });
    expect(asHead.content_hash).toBe(head.hash);
    // 逐字重放真实断言的形状，并断言它**失败**。
    expect(() => expect(asHead.content_hash).toBe(v1Hash)).toThrow();
  });

  it("数据库拒绝把挂载改指到另一个版本（SNAPSHOT_IMMUTABLE）—— 不指望「没人会去改它」", async () => {
    const a = await attach();
    const head = await moveHead("v2 的内容");
    await expect(
      asApp(ORG, (c) =>
        c.query("UPDATE interview_step_attachments SET pinned_version_id = $2 WHERE id = $1", [
          a.attachmentId,
          head.versionId,
        ]),
      ),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
  });

  it("删除挂载被**两道**门各挡一次 —— 权限没给，且就算给了触发器也拒（A3）", async () => {
    const a = await attach();

    // ① 运行时角色根本没有 DELETE 权限（0030 的 GRANT 里没有它）。
    await expect(
      asApp(ORG, (c) =>
        c.query("DELETE FROM interview_step_attachments WHERE id = $1", [a.attachmentId]),
      ),
    ).rejects.toThrow(/permission denied/);

    // ② 权限与行级准入是两件事。以 owner 身份（即「哪天有人把 DELETE 授出去了」的等价物）
    //    再删一次，被触发器拒 —— 少了这一半，上面那条只证明了「现在没授权」。
    await expect(
      asOwner((c) =>
        c.query("DELETE FROM interview_step_attachments WHERE id = $1", [a.attachmentId]),
      ),
    ).rejects.toThrow(/cannot be deleted/);
  });
});

/* ───────────── ② REQUIRES_PINNED ───────────── */

describe("② 只有固定快照挂得上（REQUIRES_PINNED，与 artifact 束 I-14 同一条规则）", () => {
  it("一个没有任何 pinned 绑定钉住的版本被拒", async () => {
    const other = await seedArtifact(h, ORG, PROJECT, ["谁也没钉住我"], CREATOR);
    await expect(
      attachToProjectStep(deps(), {
        orgId: toOrgId(ORG),
        actorId: CREATOR,
        interviewId: ITV,
        projectId: PROJECT,
        stepId: STEP,
        pinnedVersionId: other.versionIds[0]!,
      }),
    ).rejects.toBeInstanceOf(RequiresPinnedError);
  });

  it("绕开 use case 直接写库同样被拒 —— 门在数据库里，不只在用例里", async () => {
    const other = await seedArtifact(h, ORG, PROJECT, ["谁也没钉住我"], CREATOR);
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO interview_step_attachments
             (id, org_id, interview_id, project_id, step_id, pinned_version_id, attached_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          ["att-bypass", ORG, ITV, PROJECT, STEP, other.versionIds[0]!, CREATOR],
        ),
      ),
    ).rejects.toThrow(/REQUIRES_PINNED/);
  });

  it("...而 v1（被 pinned 绑定钉住的那一版）挂得上 —— 拒绝不是「一律拒绝」", async () => {
    const a = await attach();
    expect(a.pinnedVersionId).toBe(v1);
    expect(a.interviewId).toBe(ITV);
    expect(a.stepId).toBe(STEP);
  });
});

/* ───────────── ③ 可见性与解除 ───────────── */

describe("③ 挂载 / 解除走的是 F80 那条谓词，产出不因解除而丢失（V4①②）", () => {
  const listAs = (user: string, s: typeof scopeNone | typeof scopeProject) =>
    listInterviews({ repo: scope, decisions }, { orgId: toOrgId(ORG), viewerUserId: user, scope: s });

  it("挂之前：项目成员在项目档位里看不见这场无项目访谈", async () => {
    const before = await listAs(MEMBER, scopeProject);
    expect(before.items.map((i) => i.interviewId)).not.toContain(ITV);
  });

  it("挂之后：同一个项目成员在项目档位里看得见了，且行上的 scope 是那个项目", async () => {
    await attach();
    const after = await listAs(MEMBER, scopeProject);
    const row = after.items.find((i) => i.interviewId === ITV);
    expect(row, "挂上之后项目成员仍看不见 —— V4① 不成立").toBeDefined();
    expect(row!.scope).toEqual({ kind: "project", projectId: PROJECT, researchProjectId: null });
  });

  it("解除之后：项目成员又看不见，创建者仍看得见，且行回到「不属于任何项目」（V4②）", async () => {
    const a = await attach();
    const out = await detachFromProjectStep(
      { repo: scope, attachments, provenance, decisions },
      { orgId: toOrgId(ORG), actorId: CREATOR, attachmentId: a.attachmentId },
    );
    expect(out.interviewStillExists).toBe(true);
    expect(out.detachedAt).toBeTruthy();

    expect((await listAs(MEMBER, scopeProject)).items.map((i) => i.interviewId)).not.toContain(ITV);

    const mine = await listAs(CREATOR, scopeNone);
    const row = mine.items.find((i) => i.interviewId === ITV);
    expect(row, "解除把访谈本身带走了 —— A3 明确禁止").toBeDefined();
    expect(row!.scope.kind).toBe("none");
  });

  it("解除是打标记不是删行：挂载行还在，且带着解除时间与解除人（留痕）", async () => {
    const a = await attach();
    await detachFromProjectStep(
      { repo: scope, attachments, provenance, decisions },
      { orgId: toOrgId(ORG), actorId: CREATOR, attachmentId: a.attachmentId },
    );
    const row = await asApp(ORG, async (c) => {
      const r = await c.query<{ detached_at: Date | null; detached_by: string | null }>(
        "SELECT detached_at, detached_by FROM interview_step_attachments WHERE id = $1",
        [a.attachmentId],
      );
      return r.rows[0];
    });
    expect(row, "行没了 —— 那是删除不是解除").toBeDefined();
    expect(row!.detached_at).not.toBeNull();
    expect(row!.detached_by).toBe(CREATOR);
  });

  it("同一条挂载不能解除两次 —— 第二次与「不存在」同一个答案", async () => {
    const a = await attach();
    const args = { orgId: toOrgId(ORG), actorId: CREATOR, attachmentId: a.attachmentId };
    const d = { repo: scope, attachments, provenance, decisions };
    await detachFromProjectStep(d, args);
    await expect(detachFromProjectStep(d, args)).rejects.toBeInstanceOf(NoInterviewAccessError);
  });

  it("挂载与解除都写审计，且明细里带着**当初那一份**快照的哈希 —— head 已经走过一版（V9）", async () => {
    const a = await attach();
    /**
     * ⚠ `moveHead` 必须在**解除之前**跑。
     *
     * 这一行是第一次写这个文件时漏掉的，代价是整条断言空转：只有一个版本时，
     * 「按 pinned_version_id 取」与「取 head」返回同一行，于是把仓储的 `SNAPSHOT_JOIN`
     * 改成取 head，13 条断言**全部照绿**。反证跑出来是绿的那一刻才发现。
     * 解除时的那次回查走的是生产读路径，head 已在别处，所以这条断言现在真的分得开两种实现。
     */
    const head = await moveHead("v2 的内容");
    expect(head.hash).not.toBe(v1Hash);

    await detachFromProjectStep(
      { repo: scope, attachments, provenance, decisions },
      { orgId: toOrgId(ORG), actorId: CREATOR, attachmentId: a.attachmentId },
    );
    const page = await provenance.query(toOrgId(ORG), { types: ["bound", "unbound"] });
    const mine = page.events.filter(
      (e) => (e.detail as { attachmentId?: string }).attachmentId === a.attachmentId,
    );
    expect(mine.map((e) => e.type).sort()).toEqual(["bound", "unbound"]);
    for (const e of mine) {
      const got = (e.detail as { pinnedContentHash?: string }).pinnedContentHash;
      expect(got, `${e.type} 记的是 head 的字节，不是挂上去的那一份`).toBe(v1Hash);
      expect(got).not.toBe(head.hash);
    }
  });
});
