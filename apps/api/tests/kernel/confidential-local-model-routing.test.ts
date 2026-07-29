import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { contextPack as CP, identity as IC } from "@repo/contracts";
import {
  addCapability,
  addOrgMember,
  addProjectMember,
  addSegment,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgContextPackStore } from "../../src/infrastructure/context-pack/pg-context-pack-store";
import { IdentityModelConstraint } from "../../src/infrastructure/context-pack/identity-model-constraint";
import { gateAiCall } from "../../src/application/context-pack/gate-ai-call";
import {
  resolvePackModelConstraint,
  selectableModelsForPack,
} from "../../src/application/context-pack/resolve-pack-model-constraint";
import { assembleFromRecorded } from "../../src/application/context-pack/replay-pack";
import { RunNotFoundError } from "../../src/application/context-pack/list-omissions";
import { selectableModels } from "../../src/domain/context-pack/model-routing";
import { resolveModelConstraintRule } from "../../src/domain/identity/model-constraint";
import { packContentHash } from "../../src/domain/context-pack/pack-hash";
import type { RecordedCandidate, RecordedRun } from "../../src/domain/context-pack/recorded-run";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F13 -- 机密材料本地模型路由 (V9 / D-U1 / I-10).
 *
 * ## What has to be true, and what looks like it but is not
 *
 * The acceptance is 「Context Pack 含标记为客户机密的条目时，模型选择接口**只返回自托管模型**」.
 * A verdict object saying `localOnly: true` is NOT that. F16 makes this argument about
 * `invokeLocalModel` and it applies verbatim here: the failure this acceptance names is a pack
 * that is correctly judged confidential while a cloud model stays clickable next to it. So the
 * assertions are on the PICKER's output and on the AI gate, not only on the verdict.
 *
 * ## The three ways this can be implemented wrong, each with its counter-proof here
 *
 *   1. judge again locally  -- `source` splits 产品承诺 from 组织策略 and the two differ in
 *      whether an admin can switch them off. Counter-proved by comparing field-for-field with
 *      `identity`'s own rule, and by the personal-local case, where a pack with ZERO
 *      confidential items must still be local-only.
 *   2. write a second "is this endpoint local" predicate -- the drift that costs the promise.
 *      Counter-proved by a source scan and by the LAN address, which a naive predicate admits.
 *   3. read confidentiality from ONE side -- recorded-only ignores reclassification,
 *      current-only lets an index rebuild declassify a historical run. Both directions asserted.
 *
 * ⚠ Fixture ids are prefixed `f13c-`: `segments.id` is globally unique.
 */

const ORG = "org-f13c-routing";
const LOCAL_ORG = "org-f13c-local";
const POLICY_ORG = "org-f13c-policy";
const PROJECT = "proj-f13c";
const USER = "u-f13c";

let db: PgDatabase;
let constraints: IdentityModelConstraint;

const prov = "fixture: hand-set relevance, F13 routing";

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

function run(orgId: string, over: Partial<RecordedRun> & { runId: string }): RecordedRun {
  return {
    packId: `${over.runId}-pack`,
    orgId,
    query: {
      tenantId: orgId,
      principalId: USER,
      projectIds: [],
      task: "answer",
      query: "客户机密材料",
      timeRange: null,
      allowedSensitivity: ["confidential"],
      tokenBudget: 1000,
      freshnessRequirement: null,
      evidencePolicy: "all",
    },
    retrievalPlan: [{ channel: "fts", weight: 1, hitCount: 1 }],
    candidates: [],
    withheld: [],
    unanchorable: [],
    claims: [],
    thresholdUsed: 0.45,
    ...over,
  };
}

function storeFor(orgId: string): PgContextPackStore {
  return new PgContextPackStore(db, toOrgId(orgId), constraints, USER);
}

async function record(orgId: string, r: RecordedRun): Promise<PgContextPackStore> {
  const store = storeFor(orgId);
  await store.record(r, packContentHash(assembleFromRecorded(r, null)));
  return store;
}

/** A segment that exists in the retrieval index, so `confidentialNow` has something to read. */
async function seedSegment(orgId: string, projectId: string | null, segmentId: string, confidential: boolean) {
  const artifactId = `f13c-art-${segmentId}`;
  const { versionId } = await addSegment({
    orgId,
    segmentId,
    artifactId,
    versionId: `${segmentId}-v1`,
  });
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO segment_text
         (segment_id, org_id, artifact_id, artifact_version_id, project_id, source_type,
          layer, private, lifecycle, confidential, content, tsv)
       VALUES ($1,$2,$3,$4,$5,'file','project',false,'effective',$6,$7,''::tsvector)`,
      [segmentId, orgId, artifactId, versionId, projectId, confidential, `content of ${segmentId}`],
    ),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  constraints = new IdentityModelConstraint(new PgIdentityRepository(db));
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG, LOCAL_ORG, POLICY_ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", null);
  await addProjectMember(ORG, PROJECT, USER, "member", null);

  await seedOrg({ orgId: LOCAL_ORG, kind: "personal-local", ownerUserId: USER, projectId: `${LOCAL_ORG}-p` });
  await addOrgMember(LOCAL_ORG, USER, "consultant", null);

  await seedOrg({ orgId: POLICY_ORG, projectId: `${POLICY_ORG}-p` });
  await addOrgMember(POLICY_ORG, USER, "consultant", null);
  await asApp(POLICY_ORG, (c) =>
    c.query("UPDATE organizations SET model_policy = 'self-hosted-only' WHERE id = $1", [POLICY_ORG]),
  );
});

/* ══════════════════ ① 判定是委托来的，不是这里重新做的 ══════════════════ */

describe("ResolvePackModelConstraint 委托给 identity（X-5）", () => {
  it("含机密条目 ⇒ localOnly，source 是 promise（D-U1，不是策略）", async () => {
    await seedSegment(ORG, PROJECT, "f13c-secret", true);
    await seedSegment(ORG, PROJECT, "f13c-plain", false);
    const store = await record(
      ORG,
      run(ORG, {
        runId: "f13c-run-secret",
        candidates: [
          cand({ segmentId: "f13c-plain" }),
          cand({ segmentId: "f13c-secret", confidential: true }),
        ],
      }),
    );

    const out = await resolvePackModelConstraint(
      { store, constraints },
      { runId: "f13c-run-secret", orgId: toOrgId(ORG) },
    );
    expect(out.localOnly).toBe(true);
    expect(out.source).toBe("promise");
    expect(out.confidentialItemCount).toBe(1);

    const parsed = CP.operations.resolvePackModelConstraint.out.safeParse(out);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(out)).toBeNull();

    // ⚠ 这一条才是「委托」的断言：三个字段与 identity 自己那条规则**逐字**相同。
    // 只断言 localOnly=true 的话，一份写在本束里的第二判定也是绿的。
    const identityAnswer = resolveModelConstraintRule({
      orgKind: "organization",
      modelPolicy: "any",
      dataScope: [
        { itemId: "f13c-plain", confidential: false },
        { itemId: "f13c-secret", confidential: true },
      ],
    });
    expect({ localOnly: out.localOnly, source: out.source, reason: out.reason }).toEqual(identityAnswer);
  });

  /**
   * The shortcut that a second implementation always takes -- "no confidential item, no
   * constraint" -- and the case that makes it wrong.
   */
  it("反证：本地组织里，一条机密都没有的 Pack 依然 localOnly（承诺来自组织类型）", async () => {
    await seedSegment(LOCAL_ORG, null, "f13c-local-seg", false);
    const store = await record(
      LOCAL_ORG,
      run(LOCAL_ORG, { runId: "f13c-run-local", candidates: [cand({ segmentId: "f13c-local-seg" })] }),
    );
    const out = await resolvePackModelConstraint(
      { store, constraints },
      { runId: "f13c-run-local", orgId: toOrgId(LOCAL_ORG) },
    );
    expect(out.confidentialItemCount).toBe(0);
    // 「没有机密就放行」的实现在这里会返回 false —— 而这正是把数据交给云端的那一步。
    expect(out.localOnly).toBe(true);
    expect(out.source).toBe("promise");
  });

  it("组织策略 self-hosted-only ⇒ localOnly，但 source 是 policy（两者不可抹平）", async () => {
    await seedSegment(POLICY_ORG, null, "f13c-policy-seg", false);
    const store = await record(
      POLICY_ORG,
      run(POLICY_ORG, { runId: "f13c-run-policy", candidates: [cand({ segmentId: "f13c-policy-seg" })] }),
    );
    const out = await resolvePackModelConstraint(
      { store, constraints },
      { runId: "f13c-run-policy", orgId: toOrgId(POLICY_ORG) },
    );
    expect(out.localOnly).toBe(true);
    // promise 与 policy 的差别是「管理员能不能关掉」。抹平它，界面就没法说实话。
    expect(out.source).toBe("policy");
    expect(IC.ConstraintSource.options).toContain("policy");
  });

  it("既非本地组织、也无机密、也无策略 ⇒ 不加约束", async () => {
    await seedSegment(ORG, PROJECT, "f13c-free", false);
    const store = await record(
      ORG,
      run(ORG, { runId: "f13c-run-free", candidates: [cand({ segmentId: "f13c-free" })] }),
    );
    const out = await resolvePackModelConstraint(
      { store, constraints },
      { runId: "f13c-run-free", orgId: toOrgId(ORG) },
    );
    // 「隔离不是瘫痪」的这一束版本：一个恒返回 localOnly 的实现同样能过上面三条。
    expect(out).toMatchObject({ localOnly: false, source: "none", confidentialItemCount: 0 });
  });

  it("未知 runId ⇒ RUN_NOT_FOUND", async () => {
    const store = storeFor(ORG);
    await expect(
      resolvePackModelConstraint({ store, constraints }, { runId: "f13c-nope", orgId: toOrgId(ORG) }),
    ).rejects.toThrow(RunNotFoundError);
  });
});

/* ══════════════════ ② 机密性取「记录 ∪ 当前」，两个方向都要 ══════════════════ */

describe("机密性判定同时看记录下来的和现在的", () => {
  it("装配之后才被标为机密的材料，仍然把这轮关进本地", async () => {
    await seedSegment(ORG, PROJECT, "f13c-later", false);
    const store = await record(
      ORG,
      run(ORG, { runId: "f13c-run-later", candidates: [cand({ segmentId: "f13c-later" })] }),
    );
    const before = await resolvePackModelConstraint(
      { store, constraints },
      { runId: "f13c-run-later", orgId: toOrgId(ORG) },
    );
    expect(before.localOnly).toBe(false);

    // 重新分级：这是一次合规动作，不是一次检索配置变更。
    await asApp(ORG, (c) =>
      c.query("UPDATE segment_text SET confidential = true WHERE segment_id = $1", ["f13c-later"]),
    );

    const after = await resolvePackModelConstraint(
      { store, constraints },
      { runId: "f13c-run-later", orgId: toOrgId(ORG) },
    );
    // 反证：只看记录下来的那一份，这里会仍然是 false —— 分级正确地写在库里、
    // 而唯一据此行动的代码看不见它。
    expect(after.localOnly).toBe(true);
    expect(after.confidentialItemCount).toBe(1);
    const recordedOnly = (await store.findRecorded("f13c-run-later"))!.run.candidates[0]!.confidential;
    expect(recordedOnly).toBe(false);
  });

  it("检索投影被重建/删行，也降不了一条历史 run 的级", async () => {
    await seedSegment(ORG, PROJECT, "f13c-gone", true);
    const store = await record(
      ORG,
      run(ORG, {
        runId: "f13c-run-gone",
        candidates: [cand({ segmentId: "f13c-gone", confidential: true })],
      }),
    );
    // `segment_text` 是可重建的投影（0009 明写），删掉一行不是解密决定。
    await asApp(ORG, (c) => c.query("DELETE FROM segment_text WHERE segment_id = $1", ["f13c-gone"]));

    const after = await resolvePackModelConstraint(
      { store, constraints },
      { runId: "f13c-run-gone", orgId: toOrgId(ORG) },
    );
    // 反证：只看「当前」的实现在这里会返回 false —— 一次索引重建把一轮机密对话放上云端。
    expect(after.localOnly).toBe(true);
    expect(after.confidentialItemCount).toBe(1);
  });

  it("机密条目若被丢弃、没进 items[]，就不据它收紧（I-10 说的是 items[]）", async () => {
    await seedSegment(ORG, PROJECT, "f13c-dropped", true);
    await seedSegment(ORG, PROJECT, "f13c-kept", false);
    const store = await record(
      ORG,
      run(ORG, {
        runId: "f13c-run-dropped",
        candidates: [
          cand({ segmentId: "f13c-kept" }),
          // 低于阈值 ⇒ 进丢弃清单，模型从来没看见它。
          cand({ segmentId: "f13c-dropped", confidential: true, relevance: 0.1 }),
        ],
      }),
    );
    const pack = assembleFromRecorded((await store.findRecorded("f13c-run-dropped"))!.run, null);
    expect(pack.items.map((i) => i.segmentId)).toEqual(["f13c-kept"]);
    expect(pack.omissions.some((o) => o.ref === "f13c-dropped")).toBe(true);

    const out = await resolvePackModelConstraint(
      { store, constraints },
      { runId: "f13c-run-dropped", orgId: toOrgId(ORG) },
    );
    expect(out).toMatchObject({ localOnly: false, confidentialItemCount: 0 });
  });
});

/* ══════════════════ ③ 模型选择接口真的只返回自托管模型 ══════════════════ */

describe("V9：含机密时，可选模型里没有云端项", () => {
  const LOOPBACK = "http://127.0.0.1:11434";
  const CLOUD = "https://api.vendor.example/v1";
  const LAN = "http://192.168.1.50:11434";

  async function seedModels(orgId: string) {
    await addCapability({ orgId, id: `f13c-m-local-${orgId}`, kind: "model", name: "local", endpoint: LOOPBACK });
    await addCapability({ orgId, id: `f13c-m-cloud-${orgId}`, kind: "model", name: "cloud", endpoint: CLOUD });
    await addCapability({ orgId, id: `f13c-m-lan-${orgId}`, kind: "model", name: "lan", endpoint: LAN });
    await addCapability({ orgId, id: `f13c-m-null-${orgId}`, kind: "model", name: "nowhere", endpoint: null });
  }

  it("含机密 ⇒ 只剩 loopback 的那一个；不含机密 ⇒ 四个都在", async () => {
    await seedModels(ORG);
    await seedSegment(ORG, PROJECT, "f13c-sel-secret", true);
    await seedSegment(ORG, PROJECT, "f13c-sel-plain", false);

    const confidential = await record(
      ORG,
      run(ORG, {
        runId: "f13c-run-sel-secret",
        candidates: [cand({ segmentId: "f13c-sel-secret", confidential: true })],
      }),
    );
    const picked = await selectableModelsForPack(
      { store: confidential, constraints },
      { runId: "f13c-run-sel-secret", orgId: toOrgId(ORG) },
    );
    expect(picked.localOnly).toBe(true);
    expect(picked.models.map((m) => m.id)).toEqual([`f13c-m-local-${ORG}`]);
    // ⚠ 逐项说清楚被挡的理由，而不是只断言数量：
    //   · 云端 —— 显然
    //   · **局域网** —— 「同一网段的另一台机器」也是另一台机器（F16 的判定，本束复用）
    //   · endpoint 为空 —— 「不知道它在哪」不等于「它在这里」，未知一律走关闭那一侧
    expect(picked.models.map((m) => m.endpoint)).not.toContain(CLOUD);
    expect(picked.models.map((m) => m.endpoint)).not.toContain(LAN);
    expect(picked.models.some((m) => m.endpoint === null)).toBe(false);

    // 反证：门不是「一律只留 loopback」。同一批模型、同一个组织，
    // 换一个不含机密的 Pack，四个全都回来。
    const plain = await record(
      ORG,
      run(ORG, { runId: "f13c-run-sel-plain", candidates: [cand({ segmentId: "f13c-sel-plain" })] }),
    );
    const all = await selectableModelsForPack(
      { store: plain, constraints },
      { runId: "f13c-run-sel-plain", orgId: toOrgId(ORG) },
    );
    expect(all.localOnly).toBe(false);
    expect(all.models).toHaveLength(4);
  });

  it("过滤规则本身：localOnly 时判据是契约的 isLocalModelEndpoint，不是另写的一份", () => {
    const models = [
      { id: "l", endpoint: LOOPBACK },
      { id: "c", endpoint: CLOUD },
      { id: "lan", endpoint: LAN },
      { id: "n", endpoint: null },
    ];
    expect(selectableModels(models, { localOnly: true }).map((m) => m.id)).toEqual(["l"]);
    expect(selectableModels(models, { localOnly: false }).map((m) => m.id)).toEqual(["l", "c", "lan", "n"]);
    // 与契约的单一判定对齐（同一组输入，同一组答案）。
    for (const m of models) {
      expect(selectableModels([m], { localOnly: true }).length === 1).toBe(
        IC.isLocalModelEndpoint(m.endpoint),
      );
    }
  });

  /**
   * F16 collapsed the local-org judgement to one place after finding three copies. The
   * endpoint judgement has the same property and the same cost, so the scan is extended to it
   * for this bundle's code -- a `startsWith("http://localhost")` here would pass every
   * assertion above and admit `http://localhost.attacker.example`.
   */
  it("context-pack 这一束的源码里没有第二份「是不是本机」判定", () => {
    const roots = [
      join(__dirname, "..", "..", "src", "domain", "context-pack"),
      join(__dirname, "..", "..", "src", "application", "context-pack"),
      join(__dirname, "..", "..", "src", "infrastructure", "context-pack"),
    ];
    const files: string[] = [];
    for (const root of roots) {
      (function walk(dir: string) {
        for (const n of readdirSync(dir)) {
          const p = join(dir, n);
          statSync(p).isDirectory() ? walk(p) : n.endsWith(".ts") && files.push(p);
        }
      })(root);
    }
    // 非空性先断言：目录读空的话，下面这条「没有违规」是恒真的。
    expect(files.length).toBeGreaterThan(8);

    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // 注释解释规则，不违反规则
        if (/127\.0\.0|localhost|::1|loopback/i.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits, `这些行自己判定了「是不是本机」，应当调用 isLocalEndpoint()：\n  ${hits.join("\n  ")}`).toEqual([]);
  });
});

/* ══════════════════ ④ 闸门：没有本地模型时，整轮被阻断 ══════════════════ */

describe("含机密但没有可用本地模型 ⇒ AI 调用被阻断（不是降级）", () => {
  it("配置里只有云端模型时阻断，加一个 loopback 模型后放行", async () => {
    await seedSegment(ORG, PROJECT, "f13c-gate", true);
    const store = await record(
      ORG,
      run(ORG, {
        runId: "f13c-run-gate",
        candidates: [cand({ segmentId: "f13c-gate", confidential: true })],
      }),
    );
    await addCapability({
      orgId: ORG, id: "f13c-m-cloud-only", kind: "model", name: "cloud",
      endpoint: "https://api.vendor.example/v1",
    });

    const blocked = await gateAiCall({ runs: store }, { runId: "f13c-run-gate" });
    expect(blocked).toEqual({ allowed: false, blockReason: "CONFIDENTIAL_REQUIRES_LOCAL_MODEL" });

    // ⚠ 反证：闸门不是恒关。补一个 loopback 端点的模型，同一个 run 当场放行——
    // 只断言「被拦」的话，一个永远返回 false 的闸门也是绿的，而它会让产品不可用。
    await addCapability({
      orgId: ORG, id: "f13c-m-local-gate", kind: "model", name: "local",
      endpoint: "http://127.0.0.1:11434",
    });
    const allowed = await gateAiCall({ runs: store }, { runId: "f13c-run-gate" });
    expect(allowed).toEqual({ allowed: true, blockReason: null });
  });

  it("阻断原因用的是契约里已有的那一个，没有新造", () => {
    expect(CP.ContextPackReason.options).toContain("CONFIDENTIAL_REQUIRES_LOCAL_MODEL");
    expect(CP.operations.gateAiCall.out.safeParse({
      allowed: false, blockReason: "CONFIDENTIAL_REQUIRES_LOCAL_MODEL",
    }).success).toBe(true);
    // strict：多返一个字段会让「拒绝」在调用方看起来像「通过但有提示」。
    expect(CP.operations.gateAiCall.out.safeParse({
      allowed: false, blockReason: "CONFIDENTIAL_REQUIRES_LOCAL_MODEL", hint: "试试云端",
    }).success).toBe(false);
  });
});

/* ══════════════════ ⑤ 契约缺口如实登记 ══════════════════ */

describe("实现期查出的契约缺口，登记而不是自行发明字段", () => {
  it("ContextItem 至今说不出「这条是机密」（G7）", () => {
    expect(Object.keys(CP.ContextItem.shape)).not.toContain("confidential");
    expect(Object.keys(CP.ContextItem.shape)).not.toContain("sensitivity");
    // 于是拿到一个 ContextPack 的客户端无法自行判定 I-10，只能拿到一个计数。
    expect(Object.keys(CP.operations.resolvePackModelConstraint.out.shape)).toContain(
      "confidentialItemCount",
    );
    expect(CP.KNOWN_CONTRACT_GAPS.G7).toMatch(/confidentiality marker/);
  });
});
