/**
 * issue #4350 —— 抽取 worker 的 watchdog：一轮 tick 里某个 await 永不 settle（模型 / 连接池卡住）时，
 * `running` 不能永远攥着——否则**所有 org** 的抽取从此停摆（devapp 2026-09-27「整理中（1 条）」一直不动）。
 *
 * 纯内存桩：队列、数据源、抽取器都是假的，只看 worker 自己的调度语义。
 * 迟到的 complete / fail 不会动到别人重新认领的行，由真实数据库的围栏测试证明（extraction-agent.test.ts）。
 */
import { describe, expect, it } from "vitest";
import type {
  KgExtractionJob, KgExtractionQueuePort, KgExtractionSourcePort, KnowledgeExtractorPort,
} from "../../src/application/knowledge-graph/ports";
import { EMPTY_EXTRACTION, type ExtractionResult } from "../../src/domain/knowledge-graph/extraction";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { KgExtractionWorker, kgExtractionWatchdogMs } from "../../src/infrastructure/knowledge-graph/kg-extraction-worker";

const A = toOrgId("org-wd-a");
const B = toOrgId("org-wd-b");

function harness(opts: { orgs: () => readonly OrgId[]; extract: () => Promise<ExtractionResult> }) {
  const claims: OrgId[] = [];
  const completes: { orgId: OrgId; messageId: string; attempts: number | undefined }[] = [];
  const errors: string[] = [];
  const queue: KgExtractionQueuePort = {
    enable: async () => undefined,
    pendingOrgs: async () => opts.orgs(),
    claim: async (orgId): Promise<readonly KgExtractionJob[]> => {
      claims.push(orgId);
      return [{ orgId, messageId: `m-${orgId}`, threadId: `t-${orgId}`, attempts: 1 }];
    },
    complete: async (orgId, messageId, attempts) => { completes.push({ orgId, messageId, attempts }); },
    fail: async () => undefined,
  };
  const source: KgExtractionSourcePort = {
    loadMessage: async (_o, id) => ({ message: { id, threadId: "t", body: "b", authorKind: "human" }, context: [] }),
    knownObjects: async () => [],
    projectAnswerOutsideRecallCount: async () => 0,
  };
  const extractor: KnowledgeExtractorPort = { extract: opts.extract };
  const logger = { info: () => undefined, error: (msg: string) => { errors.push(msg); } };
  const conflicts = { pendingCloseOrgs: async () => [], drainCloseOne: async () => false } as never;
  // B3-T1（#4495）：证据回填的两个端口——个人线程（`chatThreadProject` 回 null）⇒ 批次原样交执行器，不碰证据仓储。
  const evidenceSources = { chatThreadProject: async () => null } as never;
  const worker = new KgExtractionWorker(
    { enabled: true, provider: "loopback", modelId: "m" }, queue, source, extractor, {} as never, conflicts, {} as never, logger,
    {} as never, evidenceSources, 40,
  );
  return { worker, claims, completes, errors };
}

describe("issue #4350: kg extraction worker watchdog", () => {
  it("一个永不 settle 的抽取：超过上限后记 error、释放 running，下一轮照常开始", async () => {
    let orgs: readonly OrgId[] = [A];
    const h = harness({ orgs: () => orgs, extract: () => new Promise<ExtractionResult>(() => undefined) });
    const first = await h.worker.runOnce();
    expect(first).toBeNull();
    expect(h.errors).toContain("kg extraction tick exceeded watchdog; abandoned so the next tick can run");
    // 下一轮不被卡住的那一轮挡住（修之前：runOnce 在 running=true 时直接返回 null，永远）
    orgs = [];
    expect(await h.worker.runOnce()).toEqual({ processed: 0, written: 0, empty: 0, skipped: 0, failed: 0 });
  });

  it("被放弃的那一轮后来又动起来：做完手里已认领的任务（带围栏令牌），但不再认领下一个 org", async () => {
    let release!: (r: ExtractionResult) => void;
    const hung = new Promise<ExtractionResult>((r) => { release = r; });
    const h = harness({ orgs: () => [A, B], extract: () => hung });
    expect(await h.worker.runOnce()).toBeNull();
    expect(h.claims).toEqual([A]);
    release(EMPTY_EXTRACTION);
    await new Promise((r) => setTimeout(r, 20));
    // 手里那一条照常出队，带着自己认领时的 attempts（PgKgExtraction 据此围栏）
    expect(h.completes).toEqual([{ orgId: A, messageId: `m-${A}`, attempts: 1 }]);
    // 没有再去认领 B：B 留给下一轮（放弃之后还在认领，就会和下一轮抢同一批 org）
    expect(h.claims).toEqual([A]);
  });

  it("正常的一轮不受 watchdog 影响", async () => {
    const h = harness({ orgs: () => [A], extract: async () => EMPTY_EXTRACTION });
    expect(await h.worker.runOnce()).toEqual({ processed: 1, written: 0, empty: 1, skipped: 0, failed: 0 });
    expect(h.errors).toEqual([]);
  });

  it("上限 = max(租约 300 秒, 模型超时 + 60 秒余量)", () => {
    expect(kgExtractionWatchdogMs({})).toBe(300_000);
    expect(kgExtractionWatchdogMs({ KERNEL_MODEL_TIMEOUT_MS: "600000" })).toBe(660_000);
    expect(kgExtractionWatchdogMs({ KERNEL_MODEL_TIMEOUT_MS: "nonsense" })).toBe(300_000);
  });
});
