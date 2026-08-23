/**
 * F13（issue #1875）：rev-uiux 评审结果结构化落盘 —— 单一事实源。
 *
 * `.harness/state/uiux-review-log.jsonl` 是评审记录的权威存储，append-only（R7：
 * 更正走追加一条新记录，不静默改写历史行）。本文件只提供“怎么读/怎么校验/怎么追加”
 * 三件事的共享实现，供：
 *   - uiux-review-log-schema.test.ts（结构校验的反证）
 *   - uiux-review-log-backfill.ts（从 git log 尽力回填历史记录）
 *   - uiux-review-log-stats.ts（Top5 反复扣分维度统计）
 * 三处消费，避免 schema 定义出现第二份副本。
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

/** 单条评审记录。字段对应需求 R3：评审对象/日期/评分卡/各维得分/总分/扣分说明/issue-PR 链接。 */
export interface UiuxReviewLogEntry {
  /** 评审对象（页面/域），如 "chat-main"、"profile"、"org-admin"、"chat-ux-track-b"。 */
  review_target: string;
  /** 评审日期，YYYY-MM-DD。 */
  review_date: string;
  /** 使用的评分卡文件名/相对路径；无法确定时填 "unknown"。 */
  rubric: string;
  /**
   * 各维度得分。key 是维度标识（"D1"/"D2".../"1".../自定义），value 是该维得分。
   * R4-A1：某次评审可能用了不完全对应现有 rubric 的自定义维度——结构不强制套用固定
   * 的十维 schema，只要求 key/value 都是字符串/数字。历史记录若只回填出总分、拿不到
   * 各维明细，此字段为 null（不得为了“看起来完整”编造维度分）。
   */
  dimensions: Record<string, number> | null;
  /** 总分。 */
  total_score: number;
  /** 满分基准，本仓评分卡目前统一是 10。 */
  scale: number;
  /** 扣分项说明；没有可解析的扣分文本时为 null。 */
  deductions: string | null;
  /** 对应的 GitHub issue 号，如 "#728"；查不到为 null。 */
  issue_ref: string | null;
  /** 对应的 GitHub PR 号；查不到为 null。 */
  pr_ref: string | null;
  /** 记录来源的 commit SHA（git-log 回填）；人工登记可为 null。 */
  commit_sha: string | null;
  /** 记录怎么来的。 */
  source: "git-log-backfill" | "manual";
  /**
   * 回填状态：
   *   - "parsed"：脚本从历史记录里可靠解析出结构化字段。
   *   - "unresolved"：命中了关键词但格式无法可靠解析，字段多为 null/占位，
   *     `notes` 里必须写清楚原始文本，供人工判断是否值得补录（R4-E1，不编造）。
   *   - "manual"：人工登记（非回填脚本产出）。
   */
  backfill_status: "parsed" | "unresolved" | "manual";
  /** 附注（如原始 commit subject、无法解析的原因、人工更正说明）。 */
  notes: string | null;
}

export const UIUX_REVIEW_LOG_PATH = ".harness/state/uiux-review-log.jsonl";

const REQUIRED_STRING_FIELDS: (keyof UiuxReviewLogEntry)[] = [
  "review_target",
  "review_date",
  "rubric",
  "source",
  "backfill_status",
];

/** 校验一条记录是否符合 R3 的最小 schema。返回违反项列表；空数组即合法。 */
export function validateEntry(entry: unknown): string[] {
  const problems: string[] = [];
  if (typeof entry !== "object" || entry === null) {
    return ["记录不是一个对象"];
  }
  const e = entry as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof e[field] !== "string" || (e[field] as string).length === 0) {
      problems.push(`字段 ${field} 缺失或不是非空字符串`);
    }
  }

  if (typeof e.review_date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(e.review_date)) {
    problems.push(`review_date 不是 YYYY-MM-DD 格式：${e.review_date}`);
  }

  if (typeof e.total_score !== "number" || Number.isNaN(e.total_score)) {
    problems.push("total_score 缺失或不是数字");
  }
  if (typeof e.scale !== "number" || e.scale <= 0) {
    problems.push("scale 缺失或不是正数");
  }
  if (
    typeof e.total_score === "number" &&
    typeof e.scale === "number" &&
    (e.total_score < 0 || e.total_score > e.scale)
  ) {
    problems.push(`total_score (${e.total_score}) 超出 [0, scale=${e.scale}] 区间`);
  }

  if (e.dimensions !== null && typeof e.dimensions !== "object") {
    problems.push("dimensions 必须是对象或 null");
  }
  if (e.dimensions && typeof e.dimensions === "object") {
    for (const [dim, score] of Object.entries(e.dimensions as Record<string, unknown>)) {
      if (typeof score !== "number" || Number.isNaN(score)) {
        problems.push(`dimensions.${dim} 不是数字`);
      }
    }
  }

  for (const nullableStringField of ["deductions", "issue_ref", "pr_ref", "commit_sha", "notes"] as const) {
    const v = e[nullableStringField];
    if (v !== null && typeof v !== "string") {
      problems.push(`字段 ${nullableStringField} 必须是字符串或 null`);
    }
  }

  if (typeof e.source === "string" && !["git-log-backfill", "manual"].includes(e.source)) {
    problems.push(`source 值非法：${e.source}`);
  }
  if (
    typeof e.backfill_status === "string" &&
    !["parsed", "unresolved", "manual"].includes(e.backfill_status)
  ) {
    problems.push(`backfill_status 值非法：${e.backfill_status}`);
  }
  // unresolved 记录允许 total_score/dimensions 缺省真实值，但不能假装 parsed。
  if (e.backfill_status === "unresolved" && (e.notes === null || e.notes === "")) {
    problems.push("backfill_status=unresolved 的记录必须在 notes 里写清楚原始文本，不能留空");
  }

  return problems;
}

/** 逐行读取并 JSON.parse；空行跳过。抛出的错误里带行号，方便定位坏行。 */
export function readEntries(path: string = UIUX_REVIEW_LOG_PATH): UiuxReviewLogEntry[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as UiuxReviewLogEntry;
    } catch (err) {
      throw new Error(`${path}:${i + 1} 不是合法 JSON —— ${(err as Error).message}`);
    }
  });
}

/**
 * 追加一条或多条记录。append-only：从不改写/删除已有行（R7）。
 * 对每条记录先跑 validateEntry，任何一条不合法就整体拒绝（不写入半截数据）。
 */
export function appendEntries(entries: UiuxReviewLogEntry[], path: string = UIUX_REVIEW_LOG_PATH): void {
  for (const entry of entries) {
    const problems = validateEntry(entry);
    if (problems.length > 0) {
      throw new Error(`拒绝写入非法记录（${entry.review_target ?? "?"}）：${problems.join("; ")}`);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  const body = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(path, body, "utf8");
}

/** 去重键：同一次回填脚本重复跑不应该在日志里堆出重复行。 */
export function dedupeKey(entry: UiuxReviewLogEntry): string {
  return [entry.commit_sha ?? "", entry.review_target, entry.review_date, entry.total_score].join("|");
}
