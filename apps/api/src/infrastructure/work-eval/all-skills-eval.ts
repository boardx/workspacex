/**
 * EV05 `pnpm harness eval --all-skills [--baseline] [--write-back]` 的 IO 侧（04-eval-gates R3.9）。
 * 编排在 `application/work-eval/eval-all-skills.ts`。
 *
 * - 评测器：发现仓内全部 Skill 包（与门脚本同一发现逻辑）→ 逐个 `runEvalCommand`（写 reports/）→
 *   `runWorkStackGates --entity` 取 `WorkGateStatus`（同一判定、同一 digest 算法，不另算一份）。
 * - 目录端口：以平台运营凭据调真实 HTTP（GET /skills/catalog、POST …/gate-status、PATCH …/catalog/:id），
 *   服务端独立做鉴权与 G5 门检查；CLI 不直连数据库。
 * - 汇总写 `<evalsRoot>/_batch/<runId>.json`。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { WorkGateStatus } from "@repo/contracts/work-eval";
import {
  batchFailed,
  formatBatchSummary,
  runAllSkillsEval,
  type BatchCatalogEntry,
  type BatchCatalogPort,
  type BatchEntityEvaluator,
  type BatchSummary,
} from "../../application/work-eval/eval-all-skills";
import { EXIT, newRunId, runEvalCommand } from "./fs-eval-suite";
import { discoverWorkSkillPackages, runWorkStackGates } from "./fs-work-stack-gates";

export class FsBatchEntityEvaluator implements BatchEntityEvaluator {
  constructor(private readonly opts: { repoRoot: string; evalsRoot?: string; err?: (line: string) => void }) {}

  listSkillStableIds(): string[] {
    return discoverWorkSkillPackages(this.opts.repoRoot).filter(d => d.kind === "skill" && /^S\d{3}$/.test(d.stableId)).map(d => d.stableId);
  }

  async evaluate(stableId: string, o: { baseline: boolean }) {
    const quiet = () => {};
    const log = this.opts.err ?? quiet;
    const run = await runEvalCommand({ repoRoot: this.opts.repoRoot, entity: stableId, evalsRoot: this.opts.evalsRoot, baseline: o.baseline, out: quiet, err: l => log(`  ${stableId}: ${l}`) });
    const gates = runWorkStackGates({ repoRoot: this.opts.repoRoot, evalsRoot: this.opts.evalsRoot, entity: stableId, out: quiet, err: quiet });
    const judgement = gates.judgements[0] ?? null;
    return {
      status: judgement?.status ?? null,
      reportPath: run.reportPath ? relative(this.opts.repoRoot, run.reportPath).split("\\").join("/") : null,
      error: judgement === null ? `${stableId}: no gate judgement` : judgement.statusError,
    };
  }
}

class HttpCatalogError extends Error {}

/** 平台运营凭据的 HTTP 目录端口。`headers` 由调用方给（CLI = Bearer token；测试 = 测试主体头）。 */
export class HttpBatchCatalog implements BatchCatalogPort {
  constructor(private readonly opts: { baseUrl: string; headers: Record<string, string>; fetchImpl?: typeof fetch }) {}

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { ...this.opts.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => null)) as { code?: unknown } | null;
    if (!res.ok) throw new HttpCatalogError(`${method} ${path} → ${res.status}${typeof json?.code === "string" ? ` ${json.code}` : ""}`);
    return json;
  }

  async resolve(stableId: string): Promise<BatchCatalogEntry | null> {
    let cursor: string | null = null;
    do {
      const qs = new URLSearchParams({ q: stableId, limit: "100", includeDeprecated: "true" });
      if (cursor) qs.set("cursor", cursor);
      const page = (await this.call("GET", `/skills/catalog?${qs}`)) as { items: Array<{ skillId: string; stableId: string; channel: BatchCatalogEntry["channel"] }>; nextCursor: string | null };
      const hit = page.items.find(i => i.stableId === stableId);
      if (hit) return { skillId: hit.skillId, channel: hit.channel };
      cursor = page.nextCursor;
    } while (cursor);
    return null;
  }

  async writeBack(skillId: string, status: WorkGateStatus, idempotencyKey: string): Promise<void> {
    await this.call("POST", `/admin/skills/catalog/${encodeURIComponent(skillId)}/gate-status`, { status, idempotencyKey });
  }

  async markVerified(skillId: string, idempotencyKey: string): Promise<void> {
    await this.call("PATCH", `/admin/skills/catalog/${encodeURIComponent(skillId)}`, { expectedChannel: "candidate", channel: "verified", idempotencyKey });
  }
}

export interface AllSkillsCommandOptions {
  repoRoot: string;
  evalsRoot?: string;
  baseline: boolean;
  writeBack: boolean;
  /** --write-back 时必需 */
  catalog?: BatchCatalogPort;
  evaluator?: BatchEntityEvaluator;
  runId?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export async function runAllSkillsCommand(opts: AllSkillsCommandOptions): Promise<{ exitCode: number; summary: BatchSummary | null; summaryPath: string | null }> {
  const out = opts.out ?? (l => process.stdout.write(`${l}\n`));
  const err = opts.err ?? (l => process.stderr.write(`${l}\n`));
  if (opts.writeBack && !opts.catalog) {
    err("WRITE_BACK_FAILED --write-back needs WORK_EVAL_API_URL and WORK_EVAL_API_TOKEN (platform operator)");
    return { exitCode: EXIT.WRITE_BACK_FAILED, summary: null, summaryPath: null };
  }
  const evalsRoot = opts.evalsRoot ?? join(opts.repoRoot, "evals/work-stack");
  const runId = opts.runId ?? newRunId("ALL");
  const summary = await runAllSkillsEval({
    evaluator: opts.evaluator ?? new FsBatchEntityEvaluator({ repoRoot: opts.repoRoot, evalsRoot, err }),
    catalog: opts.catalog ?? null,
    baseline: opts.baseline,
    writeBack: opts.writeBack,
    runId,
  });
  const dir = join(evalsRoot, "_batch");
  mkdirSync(dir, { recursive: true });
  const summaryPath = join(dir, `${runId}.json`);
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  out(formatBatchSummary(summary));
  out(`  summary ${relative(opts.repoRoot, summaryPath)}`);
  const writeBackErrors = summary.rows.some(r => r.error?.startsWith("write-back failed"));
  const exitCode = writeBackErrors ? EXIT.WRITE_BACK_FAILED : batchFailed(summary) ? EXIT.CASE_FAILED_OR_ERROR : EXIT.OK;
  return { exitCode, summary, summaryPath };
}
