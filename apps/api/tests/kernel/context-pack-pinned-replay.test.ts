import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contextPack as CP, thresholds as TH } from "@repo/contracts";
import {
  addBinding,
  addOrgMember,
  addProjectMember,
  addSegment,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { PgBindingRepository } from "../../src/infrastructure/artifact/pg-binding-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgContextPackStore } from "../../src/infrastructure/context-pack/pg-context-pack-store";
import { IdentityModelConstraint } from "../../src/infrastructure/context-pack/identity-model-constraint";
import { pinContextPack } from "../../src/application/context-pack/pin-pack";
import { RunNotFoundError } from "../../src/application/context-pack/list-omissions";
import { PinRequiresSnapshotError } from "../../src/application/context-pack/ports";
import {
  assembleFromRecorded,
  replayContextPack,
} from "../../src/application/context-pack/replay-pack";
import { listOmissions } from "../../src/application/context-pack/list-omissions";
import { canonicalJson, packContentHash, ReplayDivergedError } from "../../src/domain/context-pack/pack-hash";
import type { ContextPack } from "../../src/domain/context-pack/pack-structure";
import type { RecordedCandidate, RecordedRun } from "../../src/domain/context-pack/recorded-run";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F13 -- 随定版固化 + 可重放, as something that can fail.
 *
 * ## The one thing this file is really about
 *
 * I-5 says `replay(runId).items` deep-equals the original items. **Two implementations satisfy
 * that sentence and only one of them is a replay**:
 *
 *   A. store the pack, return it
 *   B. store the run's inputs, re-run assembly over them, check against a recorded digest
 *
 * On the I-5 assertion they are indistinguishable -- both green, forever. So the assertions
 * that carry the weight here are the ones that TELL THEM APART, and there are three:
 *
 *   1. structural -- `context_packs` has no column able to hold an item (A is not storable)
 *   2. perturbation -- change a recorded INPUT and the replayed items change with it; A's
 *      output would not move, and this file builds A's output alongside to show it does not
 *   3. divergence -- every replay is checked against the digest, so nondeterminism anywhere in
 *      steps ⑦-⑧ turns the audit path red instead of quietly rewriting history
 *
 * ⚠ Every fixture id is prefixed `f13-`: `artifacts.id` and `segments.id` are GLOBALLY unique
 * (their PK is the id alone), so an unprefixed id fails somebody else's file when vitest runs
 * them in parallel.
 */

const ORG = "org-f13-replay";
const PROJECT = "proj-f13-replay";
const USER = "u-f13-replay";
const OTHER = "u-f13-other";

let db: PgDatabase;
let store: PgContextPackStore;
let otherStore: PgContextPackStore;
let artifacts: PgArtifactRepository;
let bindings: PgBindingRepository;

/* ────────────────────────── fixtures ────────────────────────── */

const prov = "fixture: hand-set relevance, F13 replay";

function cand(over: Partial<RecordedCandidate> & { segmentId: string }): RecordedCandidate {
  return {
    content: `content of ${over.segmentId}`,
    sourceType: "file",
    artifactVersionId: `${over.segmentId}-v1`,
    anchor: { page: 1 },
    retrievalReasons: ["recall"],
    channels: ["fts"],
    score: 0.5,
    permissionDecisionId: `dec-${over.segmentId}`,
    relevance: 0.9,
    relevanceProvenance: prov,
    tokens: 10,
    fingerprint: over.segmentId,
    confidential: false,
    ...over,
  };
}

function run(over: Partial<RecordedRun> & { runId: string }): RecordedRun {
  return {
    packId: `${over.runId}-pack`,
    orgId: ORG,
    query: {
      tenantId: ORG,
      principalId: USER,
      projectIds: [PROJECT],
      task: "decision-support",
      query: "波兰储能补贴",
      timeRange: null,
      allowedSensitivity: ["internal"],
      tokenBudget: 1000,
      freshnessRequirement: null,
      evidencePolicy: "all",
    },
    retrievalPlan: [{ channel: "fts", weight: 1, hitCount: 2 }],
    candidates: [],
    withheld: [],
    unanchorable: [],
    claims: [],
    thresholdUsed: 0.45,
    ...over,
  };
}

/** Record a run and return the digest that was recorded with it. */
async function record(r: RecordedRun): Promise<string> {
  const hash = packContentHash(assembleFromRecorded(r, null));
  await store.record(r, hash);
  return hash;
}

/** Read the stored recording straight out of the row, as the owner. Fixture inspection only. */
async function storedRecording(runId: string): Promise<RecordedRun> {
  return asOwner(async (c) => {
    const r = await c.query<{ recorded: RecordedRun }>(
      "SELECT recorded FROM context_packs WHERE run_id = $1",
      [runId],
    );
    return r.rows[0]!.recorded;
  });
}

async function seedSegment(segmentId: string, opts: { confidential?: boolean; content?: string } = {}) {
  const artifactId = `f13-art-${segmentId}`;
  const { versionId } = await addSegment({
    orgId: ORG,
    segmentId,
    artifactId,
    versionId: `${segmentId}-v1`,
  });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO segment_text
         (segment_id, org_id, artifact_id, artifact_version_id, project_id, source_type,
          layer, private, lifecycle, confidential, content, tsv)
       VALUES ($1,$2,$3,$4,$5,'file','project',false,'effective',$6,$7,''::tsvector)`,
      [
        segmentId, ORG, artifactId, versionId, PROJECT,
        opts.confidential ?? false, opts.content ?? `content of ${segmentId}`,
      ],
    ),
  );
  return { artifactId, versionId };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  artifacts = new PgArtifactRepository(db);
  bindings = new PgBindingRepository(db);
  const constraints = new IdentityModelConstraint(new PgIdentityRepository(db));
  store = new PgContextPackStore(db, toOrgId(ORG), constraints, USER);
  otherStore = new PgContextPackStore(db, toOrgId(ORG), constraints, OTHER);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", null);
  await addProjectMember(ORG, PROJECT, USER, "member", null);
});

/* ══════════════════ ① replay is a RECOMPUTATION, not a read-back ══════════════════ */

describe("重放是重新算出来的，不是把存起来的那份还回去", () => {
  /**
   * The structural half. "We chose not to read it from storage" is a promise; "it is not
   * storable" is a property, and only the second one survives the next person.
   */
  it("context_packs 里没有任何一列装得下 items[]", async () => {
    const cols = await asOwner(async (c) => {
      const r = await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'context_packs' ORDER BY column_name`,
      );
      return r.rows.map((x) => x.column_name);
    });
    // Non-vacuity first: if the table were missing, the "no items column" claim below would be
    // trivially true and would say nothing at all.
    expect(cols).toContain("recorded");
    expect(cols).toContain("content_hash");
    // The answer has no home. Asserted as "no column whose name could plausibly hold one"
    // rather than as an exact list, so that a future `pack jsonb` / `items jsonb` /
    // `frozen_pack` column is caught whatever it is called.
    expect(cols.filter((n) => /(^|_)(pack|items|omissions|claims)$/.test(n))).toEqual([]);
  });

  /**
   * ⚠ **The decisive assertion of this file.**
   *
   * Both implementations agree that `replay(runId).items` equals the original. They disagree
   * the moment a recorded INPUT moves -- and only a recomputation can move with it. So the
   * read-back implementation is built here, side by side, and shown to be stuck.
   */
  it("反证：改一条**输入**，重放的 items 跟着变；「返回存起来的那份」不会变", async () => {
    const r = run({
      runId: "f13-run-perturb",
      candidates: [cand({ segmentId: "f13-a" }), cand({ segmentId: "f13-b", relevance: 0.6 })],
    });
    await record(r);

    const before = await replayContextPack({ store }, { runId: "f13-run-perturb" });
    expect(before.items.map((i) => i.segmentId)).toEqual(["f13-a", "f13-b"]);

    // This is implementation A, materialised: the pack as it was, kept in a variable, handed
    // back on request. Everything below is the same question asked of both.
    const storedPack: ContextPack = JSON.parse(JSON.stringify(before)) as ContextPack;
    const readBackReplay = (): ContextPack => storedPack;

    // Perturb ONE input: f13-b's relevance drops under the run's own threshold.
    const perturbed: RecordedRun = {
      ...r,
      candidates: [r.candidates[0]!, { ...r.candidates[1]!, relevance: 0.2 }],
    };
    await store.record(perturbed, (await store.findRecorded("f13-run-perturb"))!.contentHash);

    // B: the recomputation notices, and says so through the digest.
    await expect(replayContextPack({ store }, { runId: "f13-run-perturb" })).rejects.toThrow(
      ReplayDivergedError,
    );
    const recomputed = assembleFromRecorded(perturbed, null);
    expect(recomputed.items.map((i) => i.segmentId)).toEqual(["f13-a"]);
    expect(recomputed.omissions.find((o) => o.ref === "f13-b")!.reason).toBe("low-confidence");

    // A: unmoved. Same assertion, same fixture, and it learns nothing.
    expect(readBackReplay().items.map((i) => i.segmentId)).toEqual(["f13-a", "f13-b"]);
    // Spelled out so the difference cannot be read as an accident of this fixture:
    expect(recomputed.items).not.toEqual(readBackReplay().items);
  });

  it("反证：摘要校验是活的——把重放结果改一个字节，摘要立刻对不上", async () => {
    const r = run({ runId: "f13-run-digest", candidates: [cand({ segmentId: "f13-c" })] });
    const hash = await record(r);
    const pack = await replayContextPack({ store }, { runId: "f13-run-digest" });
    expect(packContentHash(pack)).toBe(hash);

    // One character of one item's content.
    const tampered: ContextPack = {
      ...pack,
      items: [{ ...pack.items[0]!, content: `${pack.items[0]!.content}.` }],
    };
    expect(packContentHash(tampered)).not.toBe(hash);
  });

  it("同一 runId 重放两次，逐字节相同（I-5）", async () => {
    const r = run({
      runId: "f13-run-stable",
      candidates: [cand({ segmentId: "f13-d" }), cand({ segmentId: "f13-e" })],
    });
    await record(r);
    const first = await replayContextPack({ store }, { runId: "f13-run-stable" });
    const second = await replayContextPack({ store }, { runId: "f13-run-stable" });
    expect(canonicalJson(second)).toBe(canonicalJson(first));
    expect(packContentHash(second)).toBe(packContentHash(first));
  });

  /**
   * The digest must not depend on how the object was BUILT, or a refactor of the item builder
   * invalidates every pinned pack on a day nothing about the data changed -- and an audit
   * trail that cries wolf gets switched off.
   */
  it("摘要与键的书写顺序无关，与值有关", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] })); // 顺序是数据
    // 反证：`JSON.stringify` 会把 undefined 的键删掉，于是「丢了一个字段」和「本来就没有」
    // 会哈希成同一个值——锚点全是可选字段，正是这个错误可用的地方。
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson([1, undefined])).toThrow(/undefined/);
  });
});

/* ══════════════════ ② 阈值是读回来的，不是重新算的 ══════════════════ */

describe("重放施加的是这次 run 自己的阈值", () => {
  it("旧 run 的阈值即使与今天的默认值不同，也照旧生效", async () => {
    // 0.9 is deliberately NOT today's configured value; if anything looked the threshold up at
    // read time, this run would be re-screened at 0.45 and f13-mid would survive.
    const today = TH.relevanceThresholdFor("decision-support");
    expect(today).toBeLessThan(0.9);

    const r = run({
      runId: "f13-run-threshold",
      thresholdUsed: 0.9,
      candidates: [cand({ segmentId: "f13-hi", relevance: 0.95 }), cand({ segmentId: "f13-mid", relevance: 0.6 })],
    });
    await record(r);

    const pack = await replayContextPack({ store }, { runId: "f13-run-threshold" });
    expect(pack.items.map((i) => i.segmentId)).toEqual(["f13-hi"]);
    const dropped = pack.omissions.find((o) => o.ref === "f13-mid")!;
    expect(dropped.reason).toBe("low-confidence");
    expect(dropped.explain).toContain("0.9");

    // The audit read reports the same number, from the same place.
    const audit = await listOmissions({ store }, { runId: "f13-run-threshold" });
    expect(audit.thresholdUsed).toBe(0.9);
  });

  it("反证：若在读取时按今天的配置重新求阈值，这条 run 的结果当场改变", () => {
    const r = run({
      runId: "f13-run-threshold-cp",
      thresholdUsed: 0.9,
      candidates: [cand({ segmentId: "f13-hi", relevance: 0.95 }), cand({ segmentId: "f13-mid", relevance: 0.6 })],
    });
    const honest = assembleFromRecorded(r, null);
    // 这一行就是错误实现：把记录下来的阈值换成 `relevanceThresholdFor(task)`。
    const recomputed = assembleFromRecorded(
      { ...r, thresholdUsed: TH.relevanceThresholdFor(r.query.task) },
      null,
    );
    expect(honest.items.map((i) => i.segmentId)).toEqual(["f13-hi"]);
    expect(recomputed.items.map((i) => i.segmentId)).toEqual(["f13-hi", "f13-mid"]);
    // ⚠ 差别不止是多一条：那条 run 的丢弃清单会写「相关度 0.6 < 0.45」——一句自相矛盾的解释。
    expect(recomputed.omissions.some((o) => o.ref === "f13-mid")).toBe(false);
  });
});

/* ══════════════════ ③ 固化：定版之后上游改不动它 ══════════════════ */

describe("PinContextPack：随固定快照固化（I-7）", () => {
  /** Seed a segment, an artifact version, and a binding in the requested mode. */
  async function pinnableVersion(mode: "pinned" | "live", segmentId: string) {
    const { artifactId, versionId } = await seedSegment(segmentId);
    await addBinding({
      orgId: ORG,
      subject: { kind: "user", id: USER },
      object: { kind: "artifact", id: artifactId },
      scope: "org-wide",
    });
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO artifact_bindings
           (id, org_id, artifact_id, project_id, step_id, mode, pinned_version_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `f13-bind-${segmentId}`, ORG, artifactId, PROJECT, "step-1", mode,
          mode === "pinned" ? versionId : null, USER,
        ],
      ),
    );
    return { artifactId, versionId };
  }

  it("定版为固定快照时固化，返回 snapshotId / contentHash / frozenItemCount", async () => {
    const { versionId } = await pinnableVersion("pinned", "f13-seg-pin");
    const r = run({
      runId: "f13-run-pin",
      candidates: [cand({ segmentId: "f13-seg-pin", artifactVersionId: versionId })],
    });
    await record(r);

    const out = await pinContextPack(
      { store, artifacts, bindings },
      { runId: "f13-run-pin", orgId: toOrgId(ORG), artifactVersionId: versionId },
    );
    expect(out.snapshotId).toBe(versionId);
    expect(out.frozenItemCount).toBe(1);
    expect(out.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const parsed = CP.operations.pinContextPack.out.safeParse(out);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(out)).toBeNull();

    // Replay now reports the pack as frozen.
    const pack = await replayContextPack({ store }, { runId: "f13-run-pin" });
    expect(pack.pinnedSnapshotId).toBe(versionId);
  });

  it("目标不是固定快照 ⇒ PIN_REQUIRES_SNAPSHOT；改成 pinned 绑定后同一调用通过", async () => {
    const { artifactId, versionId } = await pinnableVersion("live", "f13-seg-live");
    const r = run({
      runId: "f13-run-live",
      candidates: [cand({ segmentId: "f13-seg-live", artifactVersionId: versionId })],
    });
    await record(r);

    const call = () =>
      pinContextPack(
        { store, artifacts, bindings },
        { runId: "f13-run-live", orgId: toOrgId(ORG), artifactVersionId: versionId },
      );
    await expect(call()).rejects.toThrow(PinRequiresSnapshotError);

    // ⚠ 反证的另一半：门不是「一律拒」。把绑定升级成 pinned，同一次调用通过——
    // 只测拒绝，一个恒拒的实现也是绿的（verify-rls.sh 的文件头讲的是同一件事）。
    await asApp(ORG, (c) =>
      c.query(
        "UPDATE artifact_bindings SET mode = 'pinned', pinned_version_id = $2 WHERE artifact_id = $1",
        [artifactId, versionId],
      ),
    );
    await expect(call()).resolves.toMatchObject({ snapshotId: versionId, frozenItemCount: 1 });
  });

  it("固化之后改上游材料，重取这份快照的 contentHash 与 items 都不变", async () => {
    const { versionId } = await pinnableVersion("pinned", "f13-seg-frozen");
    const r = run({
      runId: "f13-run-frozen",
      candidates: [
        cand({
          segmentId: "f13-seg-frozen",
          artifactVersionId: versionId,
          content: "波兰储能补贴细则 2023 —— 原文",
        }),
      ],
    });
    await record(r);
    const pinned = await pinContextPack(
      { store, artifacts, bindings },
      { runId: "f13-run-frozen", orgId: toOrgId(ORG), artifactVersionId: versionId },
    );

    // Change the upstream material. The fixture is checked to have really changed -- otherwise
    // "the pack did not move" would be a statement about a no-op.
    await asApp(ORG, (c) =>
      c.query("UPDATE segment_text SET content = $2 WHERE segment_id = $1", [
        "f13-seg-frozen",
        "改写后的正文，与定版时完全不同",
      ]),
    );
    const upstream = await asApp(ORG, async (c) => {
      const q = await c.query<{ content: string }>(
        "SELECT content FROM segment_text WHERE segment_id = $1",
        ["f13-seg-frozen"],
      );
      return q.rows[0]!.content;
    });
    expect(upstream).toBe("改写后的正文，与定版时完全不同");

    const after = await replayContextPack({ store }, { runId: "f13-run-frozen" });
    expect(after.items[0]!.content).toBe("波兰储能补贴细则 2023 —— 原文");
    expect(packContentHash(after)).toBe(pinned.contentHash);
  });

  /**
   * The application-level rule is one repository method away from being false, so the one that
   * counts is the database's. Asserted as the runtime role, which is what serves traffic.
   */
  it("固化之后，运行时角色改不动这条记录，也删不掉它", async () => {
    const { versionId } = await pinnableVersion("pinned", "f13-seg-locked");
    await record(run({ runId: "f13-run-locked", candidates: [cand({ segmentId: "f13-seg-locked" })] }));
    await pinContextPack(
      { store, artifacts, bindings },
      { runId: "f13-run-locked", orgId: toOrgId(ORG), artifactVersionId: versionId },
    );

    await expect(
      asApp(ORG, (c) =>
        c.query("UPDATE context_packs SET recorded = '{}'::jsonb WHERE run_id = $1", ["f13-run-locked"]),
      ),
    ).rejects.toThrow(/CONTEXT_PACK_PINNED/);
    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM context_packs WHERE run_id = $1", ["f13-run-locked"])),
    ).rejects.toThrow(/CONTEXT_PACK_PINNED/);

    // ⚠ 隔离不是瘫痪：**未**固化的 run 仍然可改可删。只断言「被拒」的话，
    // 一条 `RAISE EXCEPTION` 无条件写在触发器里也是绿的。
    await record(run({ runId: "f13-run-open", candidates: [cand({ segmentId: "f13-seg-locked" })] }));
    await expect(
      asApp(ORG, (c) =>
        c.query("UPDATE context_packs SET threshold_used = 0.5 WHERE run_id = $1", ["f13-run-open"]),
      ),
    ).resolves.toBeDefined();
    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM context_packs WHERE run_id = $1", ["f13-run-open"])),
    ).resolves.toBeDefined();
  });

  it("同一条 run 不能被固化两次（换个快照重指一次也不行）", async () => {
    const { versionId } = await pinnableVersion("pinned", "f13-seg-twice");
    const second = await pinnableVersion("pinned", "f13-seg-twice-b");
    await record(run({ runId: "f13-run-twice", candidates: [cand({ segmentId: "f13-seg-twice" })] }));

    await pinContextPack(
      { store, artifacts, bindings },
      { runId: "f13-run-twice", orgId: toOrgId(ORG), artifactVersionId: versionId },
    );
    await expect(
      pinContextPack(
        { store, artifacts, bindings },
        { runId: "f13-run-twice", orgId: toOrgId(ORG), artifactVersionId: second.versionId },
      ),
    ).rejects.toThrow(/CONTEXT_PACK_PINNED/);
    // ⚠ 契约里没有「已固化」这个错误码（KNOWN_CONTRACT_GAPS.G9）。不发明一个，
    // 也不复用 RUN_NOT_FOUND / PIN_REQUIRES_SNAPSHOT —— 两个都会把这件事说错。
    expect(CP.operations.pinContextPack.err).toEqual(["RUN_NOT_FOUND", "PIN_REQUIRES_SNAPSHOT"]);
    expect(Object.keys(CP.KNOWN_CONTRACT_GAPS)).toContain("G9");
  });
});

/* ══════════════════ ④ RUN_NOT_FOUND 与「谁能读回去」 ══════════════════ */

describe("找不到的 run，和不属于你的 run", () => {
  it("未知 runId ⇒ RUN_NOT_FOUND（重放与固化都是）", async () => {
    await expect(replayContextPack({ store }, { runId: "f13-nope" })).rejects.toThrow(RunNotFoundError);
    await expect(
      pinContextPack(
        { store, artifacts, bindings },
        { runId: "f13-nope", orgId: toOrgId(ORG), artifactVersionId: "whatever" },
      ),
    ).rejects.toThrow(RunNotFoundError);
  });

  /**
   * This is the ENFORCED PREMISE of the `lint-permission-paths` allowlist entry. If it goes,
   * the exemption goes with it: the recording holds segment text that was disclosed to one
   * principal under recorded decisions, and nothing else in the read path re-checks it.
   */
  it("别人的 run 读不回来，且与「不存在」不可区分", async () => {
    await record(run({ runId: "f13-run-mine", candidates: [cand({ segmentId: "f13-mine" })] }));

    // Same tenant, same table, different principal.
    await expect(replayContextPack({ store: otherStore }, { runId: "f13-run-mine" })).rejects.toThrow(
      RunNotFoundError,
    );
    await expect(otherStore.findRecorded("f13-run-mine")).resolves.toBeNull();
    await expect(otherStore.findAudit("f13-run-mine")).resolves.toBeNull();

    // 反证：这道检查是活的——同一份数据、同一个 store 类，换回本人就读得到。
    await expect(replayContextPack({ store }, { runId: "f13-run-mine" })).resolves.toMatchObject({
      runId: "f13-run-mine",
    });

    // 反证的第二半：拿掉这条检查（直接比对存储行）之后，别人是读得到内容的——
    // 说明拦住他的正是这条，不是 RLS 也不是 org_id 谓词。
    const raw = await storedRecording("f13-run-mine");
    expect(raw.candidates[0]!.content).toContain("f13-mine");
    expect(raw.query.principalId).toBe(USER);
  });

  it("检索失败的 run 有行、但没有可重放的 pack", async () => {
    await store.recordFailure({ runId: "f13-run-down", orgId: toOrgId(ORG) });
    await expect(store.findStatus("f13-run-down")).resolves.toBe("retrieval-unavailable");
    // 有状态可答（F12 的闸门要用它），但没有 pack——两者不能混为一谈。
    await expect(store.pack("f13-run-down")).resolves.toBeUndefined();
    await expect(replayContextPack({ store }, { runId: "f13-run-down" })).rejects.toThrow(RunNotFoundError);

    // 反证：一次失败不许覆盖掉一次成功的装配——否则真 pack 会变成一个阻断原因。
    await record(run({ runId: "f13-run-ok", candidates: [cand({ segmentId: "f13-ok" })] }));
    await store.recordFailure({ runId: "f13-run-ok", orgId: toOrgId(ORG) });
    await expect(store.findStatus("f13-run-ok")).resolves.toBe("assembled");
  });
});

/* ══════════════════ ⑤ 契约响应体 ══════════════════ */

describe("重放的返回体受契约校验（硬规则 6）", () => {
  it("replayContextPack.out 逐字段通过，且多一个字段就被拒", async () => {
    await record(
      run({
        runId: "f13-run-contract",
        candidates: [cand({ segmentId: "f13-ct" }), cand({ segmentId: "f13-ct-low", relevance: 0.1 })],
      }),
    );
    const pack = await replayContextPack({ store }, { runId: "f13-run-contract" });
    const parsed = CP.operations.replayContextPack.out.safeParse(pack);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(pack)).toBeNull();

    // `.strict()` 不传播到嵌套 object 与数组元素，所以三层都试。
    expect(CP.operations.replayContextPack.out.safeParse({ ...pack, extra: 1 }).success).toBe(false);
    expect(
      CP.operations.replayContextPack.out.safeParse({
        ...pack,
        items: pack.items.map((i) => ({ ...i, confidential: true })),
      }).success,
    ).toBe(false);
    expect(
      CP.operations.replayContextPack.out.safeParse({
        ...pack,
        omissions: pack.omissions.map((o) => ({ ...o, title: "被丢弃的那条叫什么" })),
      }).success,
    ).toBe(false);
  });
});
