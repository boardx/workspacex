import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { contextPack as CP, filterAction as FA } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { IdentityRerank, TableEmbedding, addClaim, addEdge, indexSegment } from "../support/retrieval-fixtures";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgSegmentRetriever } from "../../src/infrastructure/retrieval/pg-segment-retriever";
import { retrieveCandidates, type RetrieveDeps } from "../../src/application/retrieval/retrieve-candidates";
import { finalizePack, ItemClaimsExclusionError } from "../../src/application/context-pack/finalize-pack";
import {
  filterActionTraces,
  itemsCarryingOmissionTracedAction,
  untracedActions,
} from "../../src/domain/context-pack/filter-action-trace";
import type { ContextItem } from "../../src/domain/context-pack/context-item";
import { toOrgId } from "../../src/domain/org-id";

/**
 * F11 -- the five filter actions leave a trace, and the trace can be found.
 *
 * ## What is actually at stake
 *
 * "五种筛选动作逐条留痕" is the sentence that makes a Context Pack auditable rather than
 * plausible. It has one structural hole, and this file is built around it:
 *
 *   **`exclude` cannot be traced in `items[].retrievalReasons`.** An excluded candidate is not
 *   an item -- there is no `retrievalReasons` array to put it in. Four actions can be traced
 *   there and the fifth cannot, and both wrong ways out are invisible:
 *     ① tag a surviving item `exclude` (a lie nothing downstream can detect), or
 *     ② trace four and let the acceptance sentence quietly become false.
 *
 * Registered as `KNOWN_CONTRACT_GAPS.G1`; handled by declaring, in the single source, WHERE each
 * action's trace lives (`filter-action.ts` `tracedIn`) and asserting on that.
 *
 * ## Why this test uses the database
 *
 * The reasons are assigned by `retrieveCandidates` from real row state -- `lifecycle: revoked`,
 * `in_scope: false`, a contested claim's two sides, a graph edge. A test that handed itself a
 * `retrievalReasons: ["downweight"]` literal would assert that arrays can hold strings.
 */

/**
 * ⚠ Fixture ids are prefixed per FILE, not per org.
 *
 * `artifacts.id` and `segments.id` are globally unique -- the primary key is the id alone, not
 * (org_id, id) -- so two test FILES using `a-for` / `s-open` collide the moment vitest runs them
 * in parallel, even under different organizations. The first version of this file used the same
 * plain ids as `retrieval-five-channels.test.ts` and broke THAT file's fixtures, which is a
 * particularly nasty failure: the file that goes red is not the file that changed.
 */
const ORG = "org-f11-actions";
const PROJECT = "proj-f11-actions";
const MODEL = { model: "fixture-embed", modelVersion: "1" };

let db: PgDatabase;
let deps: RetrieveDeps;

const EMB = { "预算 结论": [1, 0, 0, 0] } as const;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new CountingDecisionIdFactory(),
    retriever: new PgSegmentRetriever(db),
    embeddings: new TableEmbedding(MODEL.model, MODEL.modelVersion, EMB),
    rerank: new IdentityRerank(),
  } as RetrieveDeps;
});

afterAll(async () => {
  await db.close();
});

/**
 * One fixture in which all five actions genuinely happen.
 *
 * `withRevoked` exists for the counter-proof: with the revoked row gone, nothing is excluded,
 * and the `exclude` trace must go EMPTY. Without that arm, a trace function that returned a
 * constant would pass.
 */
async function seedActions(opts: { withRevoked: boolean }): Promise<void> {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-f11", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-f11", "facilitator", null);

  // One artifact per segment: `addSegment` always writes version 1, so two segments under one
  // artifact collide on `artifact_versions_uniq_number`. Same shape as the F10 fixtures.
  const base = { orgId: ORG, projectId: PROJECT };
  // recall: an ordinary in-scope, effective segment.
  await indexSegment({ ...base, segmentId: "f11a-seg-plain", artifactId: "f11a-art-plain", content: "本项目 预算 结论 一。" });
  // downweight: applicability mismatch -- kept, marked cross-scope.
  await indexSegment({ ...base, segmentId: "f11a-seg-scope", artifactId: "f11a-art-scope", content: "波兰 预算 结论。", inScope: false });
  // paired: two sides of a contested claim.
  await indexSegment({ ...base, segmentId: "f11a-seg-for", artifactId: "f11a-art-for", content: "支持的 预算 结论。" });
  await indexSegment({ ...base, segmentId: "f11a-seg-against", artifactId: "f11a-art-against", content: "反对的 预算 结论。" });
  // lead: reachable through the graph channel.
  await indexSegment({ ...base, segmentId: "f11a-seg-graph", artifactId: "f11a-art-graph", content: "图谱旁证 预算 结论。" });
  await addEdge({
    orgId: ORG, id: "edge-f11",
    src: { kind: "project", id: PROJECT }, dst: { kind: "segment", id: "f11a-seg-graph" },
    relation: "mentions",
  });
  await addClaim({
    orgId: ORG, id: "claim-f11", projectId: PROJECT,
    statement: "预算 结论 存在争议", status: "contested",
    supporting: ["f11a-seg-for"], contradicting: ["f11a-seg-against"],
  });

  if (opts.withRevoked) {
    // exclude: permanently excluded, and explained as `withdrawn` -- the only trace it can have.
    await indexSegment({
      ...base, segmentId: "f11a-seg-revoked", artifactId: "f11a-art-revoked",
      content: "已撤销的 预算 结论。", lifecycle: "revoked",
    });
  }
}

async function retrieve() {
  return retrieveCandidates(deps, {
    userId: "u-f11",
    orgId: toOrgId(ORG),
    projectId: PROJECT,
    task: "decision-support",
    query: "预算 结论",
    timeRange: null,
    limit: 50,
    graphSeeds: [{ kind: "project", id: PROJECT }],
  });
}

/**
 * Turn ranked candidates into items.
 *
 * ⚠ The anchor is fixture-supplied. Resolving a real anchor is `buildContextItems`' job (F09,
 * asserted in `context-pack-items-from-disclosure.test.ts`), and it needs the segment rows rather
 * than the candidate rows. What is real here -- and is what this file is about -- is
 * `retrievalReasons`: every one of them was decided by `retrieveCandidates` from row state.
 */
function itemsOf(ranked: Awaited<ReturnType<typeof retrieve>>["ranked"]): ContextItem[] {
  return ranked.map((r) => ({
    segmentId: r.row.segmentId,
    content: r.row.content,
    sourceType: r.row.sourceType,
    artifactVersionId: r.row.artifactVersionId,
    anchor: { page: 1 },
    retrievalReasons: [...r.retrievalReasons],
    channels: [...r.channels],
    score: r.score,
    permissionDecisionId: r.permissionDecisionId,
  }));
}

describe("五种筛选动作是封闭枚举，且只有一份", () => {
  it("契约的 FilterAction 取值 = 单一事实源的键（顺序也一致）", () => {
    expect(CP.FilterAction.options).toEqual(FA.FILTER_ACTION_KEYS);
  });

  /**
   * ⚠ 断言的是**封闭性**，不是成员数。
   *
   * `toHaveLength(5)` 会把一次经 ADR 评审的正当新增当成失败——丢弃原因枚举已经因为
   * 那种写法差点挡下 ADR-021（contract-design 硬规则 7）。这里守的是「表外的值进不来」。
   */
  it("枚举外的值进不来", () => {
    for (const k of FA.FILTER_ACTION_KEYS) {
      expect(CP.FilterAction.safeParse(k).success, `${k} 应当是合法取值`).toBe(true);
    }
    // 前端 mock 曾经用的就是这两个键，与契约对不上却谁都不报错——收敛前它们「合法」地存在着。
    for (const bogus of ["pair", "clue", "downrank", ""]) {
      expect(CP.FilterAction.safeParse(bogus).success, `${bogus} 不该被接受`).toBe(false);
    }
  });

  it("留痕位置这件事本身有单一事实源（四种在 items、exclude 在 omissions）", () => {
    expect(FA.OMISSION_TRACED_ACTIONS).toEqual(["exclude"]);
    expect(FA.ITEM_TRACED_ACTIONS).toEqual(
      FA.FILTER_ACTION_KEYS.filter((k) => k !== "exclude"),
    );
  });
});

describe("五种动作在一次真实装配里都留下了痕迹", () => {
  beforeEach(async () => {
    await seedActions({ withRevoked: true });
  });

  it("四种落在 items[].retrievalReasons，exclude 落在 omissions[]", async () => {
    const out = await retrieve();
    const items = itemsOf(out.ranked);
    const traces = filterActionTraces({ items, omissions: out.omissions });
    const by = (a: string) => traces.find((t) => t.action === a)!;

    expect(by("recall").refs).toContain("f11a-seg-plain");
    expect(by("downweight").refs).toEqual(["f11a-seg-scope"]);
    expect([...by("paired").refs].sort()).toEqual(["f11a-seg-against", "f11a-seg-for"]);
    expect(by("lead").refs).toContain("f11a-seg-graph");

    // The one that cannot live in items[]: its trace is the `withdrawn` omission.
    expect(by("exclude").tracedIn).toBe("omissions");
    expect(by("exclude").refs).toEqual(["f11a-seg-revoked"]);
    expect(items.map((i) => i.segmentId)).not.toContain("f11a-seg-revoked");
  });

  it("没有任何一种动作是无痕的", async () => {
    const out = await retrieve();
    expect(untracedActions({ items: itemsOf(out.ranked), omissions: out.omissions })).toEqual([]);
  });

  /**
   * 反证 ①：把 revoked 那一行拿掉，`exclude` 的痕迹必须**变空**。
   * 没有这一条，一个「无论如何都返回 seg-revoked」的投影函数照样全绿。
   */
  it("反证：没有被排除的条目时，exclude 的痕迹为空且被报为无痕", async () => {
    await seedActions({ withRevoked: false });
    const out = await retrieve();
    const traces = filterActionTraces({ items: itemsOf(out.ranked), omissions: out.omissions });
    expect(traces.find((t) => t.action === "exclude")!.refs).toEqual([]);
    expect(untracedActions({ items: itemsOf(out.ranked), omissions: out.omissions })).toEqual(["exclude"]);
  });

  /**
   * 反证 ②：G1 的第一条坏出路——给一条留下来的 item 打上 `exclude`。
   * 它必须被挡住，而不是安静地通过：那条 item 同时声称「我被排除了」和「我在包里」。
   */
  it("反证：给 item 打上 exclude 会被 finalizePack 拒绝", async () => {
    const out = await retrieve();
    const items = itemsOf(out.ranked);
    const forged = items.map((i, n) =>
      n === 0 ? { ...i, retrievalReasons: [...i.retrievalReasons, "exclude" as const] } : i,
    );

    expect(itemsCarryingOmissionTracedAction(forged)).toEqual([
      { segmentId: items[0]!.segmentId, action: "exclude" },
    ]);

    const base = {
      packId: "pack-f11", runId: "run-f11",
      query: {
        tenantId: ORG, principalId: "u-f11", projectIds: [PROJECT], task: "decision-support" as const,
        query: "预算 结论", timeRange: null, allowedSensitivity: ["internal"],
        tokenBudget: 120_000, freshnessRequirement: null, evidencePolicy: "all" as const,
      },
      retrievalPlan: out.plan, claims: out.claims, omissions: out.omissions,
      candidateIds: [...items.map((i) => i.segmentId), ...out.omissions.map((o) => o.ref)],
      tokensUsed: 100,
    };

    expect(() => finalizePack({ ...base, items: forged })).toThrow(ItemClaimsExclusionError);
    // 恢复：同样的输入、未被伪造的 items，必须通过——否则上面那条只是「什么都拒绝」。
    expect(() => finalizePack({ ...base, items })).not.toThrow();
  });
});
