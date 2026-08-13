/**
 * rewrite-coverage-evidence.ts —— E1 验收，而不是 HMV2-066 本身。
 *
 * ⚠ 命名澄清（写代码时一度混淆，这里留痕免得别人重蹈）：`checklist.md` 里
 * HMV2-066 指的是**另一条**扫描（contract→route 覆盖，改读 TPL-CTR-001），
 * 那条仍未做。本文件做的是：把 #574 已经在跑的 rewrite-coverage（**route↔rewrite**
 * 门，HMV2-064/065/067 那条，与 HMV2-066 是两码事）判定结果，改写成一份符合
 * E1（PROP-HARNESS-MODEL-001）`InstanceMetadata` schema 的 TPL-EVD-001
 * （Evidence Manifest）实例，作为 E1 落地后我自己建议的"验收步骤"——用一个
 * 已完成的真实脚本证明 schema 立得住，而不是只有手写的 dogfood 例子撑着。
 *
 * 收编成本如果低（本文件 <100 行，纯函数，不碰判定逻辑本身），说明 E1 的
 * InstanceMetadata 形状对"机器生成的证据"这类场景也成立，不只是对人工撰写的
 * design-signoff/event 记录成立；如果发现削足适履，才是 schema 需要改的信号。
 * 目前看：**成本很低**——`analyzeRewriteCoverage` 的判定逻辑一行没动，本文件
 * 只是把它的输出重新包一层 InstanceMetadata 外壳。
 */
import type { CoverageReport } from "./rewrite-coverage";
import type { InstanceMetadata } from "./template-model";

export interface RewriteCoverageEvidenceInput {
  report: CoverageReport;
  staleAllowlistEntries: readonly string[];
  allowlistSize: number;
  /** 谁生成的这份证据——脚本文件名，不是 agent id（这是机器证据，不是人的产出）。 */
  generatedBy: string;
  /** 调用方传入，不在本文件里取——库函数不碰时钟/进程状态（保持纯函数、可单测）。 */
  generatedAt: string;
  /** 最佳努力：能拿到就带上，拿不到就留空，不因为拿不到 git sha 而让整份证据失败。 */
  commit: string | null;
}

/** 除 InstanceMetadata 标准字段外，本类型独有的证据载荷（未来若有第二种 Evidence
 *  Manifest 消费者，公共部分应该上提到 template-model.ts；现在只有一个消费者，
 *  提前抽象是猜测,不做。 */
export interface RewriteCoverageEvidencePayload {
  generated_by: string;
  generated_at: string;
  commit: string | null;
  gate: "rewrite-coverage";
  incomplete: boolean;
  incomplete_reason: string | null;
  routes_scanned: number;
  rewrites_covered: number;
  gaps_found: number;
  gaps: { head: string; kind: "bare" | "deep"; example: string }[];
  allowlist_size: number;
  stale_allowlist_entries: string[];
}

/**
 * 写盘形态**不含** `sourceFile`：那是 `template-scan.ts` 扫描时从文件路径派生的字段，
 * 不是 YAML 里手写/生成的内容（历史上 E1 的 EVT 示例文件同样没有这个 key，
 * 该示例已随 #422 双 schema 裁决迁往 .harness/events/）。塞一个空字符串进去只会让读到的人误以为这是本 schema 的一部分。
 */
export type RewriteCoverageEvidence = Omit<InstanceMetadata, "sourceFile"> & RewriteCoverageEvidencePayload;

/**
 * instance_id 固定不变（不按 run 生成新 id）——这是"最近一次真实运行"的活文档，
 * 不是历史存档；想看历史用 `git log`（如果哪天决定把它入库的话，见调用方注释里
 * 关于是否入库的取舍）。固定 id 也让 HMV2-010（instance_id 唯一性）门控在重复
 * 运行时不会把自己判成"重复"。
 */
export const REWRITE_COVERAGE_EVIDENCE_INSTANCE_ID = "EVD-rewrite-coverage";

export function buildRewriteCoverageEvidence(
  input: RewriteCoverageEvidenceInput,
): RewriteCoverageEvidence {
  const { report, staleAllowlistEntries: stale, allowlistSize, generatedBy, generatedAt, commit } = input;
  return {
    template_id: "TPL-EVD-001",
    template_version: 1,
    instance_id: REWRITE_COVERAGE_EVIDENCE_INSTANCE_ID,
    // incomplete 时判定被降级为 WARN（不下结论），实例状态仍然是 active——
    // "扫不全"本身也是一种真实的、值得记录的运行结果，不是没发生。
    status: "active",
    scope: { project: "workspacex", phase: null },
    refs: [],
    generated_by: generatedBy,
    generated_at: generatedAt,
    commit,
    gate: "rewrite-coverage",
    incomplete: report.incomplete,
    incomplete_reason: report.incompleteReason,
    routes_scanned: report.routes.length,
    rewrites_covered: report.coveredBare.size + report.coveredDeep.size,
    gaps_found: report.gaps.length,
    gaps: report.gaps.map((g) => ({ head: g.head, kind: g.kind, example: g.example })),
    allowlist_size: allowlistSize,
    stale_allowlist_entries: [...stale],
  };
}
