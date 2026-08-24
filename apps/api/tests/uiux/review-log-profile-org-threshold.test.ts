/**
 * F15（issue #1877）门控：`.harness/state/uiux-review-log.jsonl` 里 profile 与
 * org-admin 两个评审对象的**最新**记录总分均需 ≥9（人类已裁决收窄门槛，见
 * MEMORY『uiux-acceptance-bar-nine』，2026-08-10）。
 *
 * 「最新」= append-only 日志里同一 review_target 出现的最后一条（R7：更正走追加
 * 新记录，不改写旧行，所以最后一条就是当前有效结论）。
 *
 * ⚠ 不导入 `.harness/scripts/uiux-review-log.ts` 的 TS 模块——apps/api 的
 * tsconfig `include` 只覆盖 src/tests/scripts，跨包导入会让类型检查的可达范围
 * 变得含糊。同 `apps/api/tests/arch-gate.test.ts` 的做法：把 `.harness/state/`
 * 当成纯数据文件直接读，不当代码依赖。schema 校验本身已经由
 * `.harness/scripts/uiux-review-log-schema.test.ts` 覆盖，这里只做「门槛」这一件事，
 * 避免同一份 schema 校验逻辑出现第二份副本（AGENTS.md「同一事实不得声明在两处」）。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const LOG_PATH = join(ROOT, ".harness/state/uiux-review-log.jsonl");

interface LogEntry {
  review_target: string;
  total_score: number;
  scale: number;
  backfill_status: "parsed" | "unresolved" | "manual";
  source: "git-log-backfill" | "manual";
  rubric: string;
  review_date: string;
}

function readLogEntries(): LogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  const raw = readFileSync(LOG_PATH, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LogEntry);
}

/** 同一 review_target 的最后一条记录——R7 append-only 更正模型下的「当前结论」。 */
function latestFor(entries: LogEntry[], target: string): LogEntry | undefined {
  let latest: LogEntry | undefined;
  for (const entry of entries) {
    if (entry.review_target === target) latest = entry;
  }
  return latest;
}

describe("F15 门控：profile / org-admin 正式评审总分均 ≥9", () => {
  const entries = readLogEntries();

  it.each(["profile", "org-admin"] as const)(
    "review_target=%s 存在一条 rev-uiux 正式评审记录（非回填占位）",
    (target) => {
      const latest = latestFor(entries, target);
      expect(latest, `.harness/state/uiux-review-log.jsonl 里没有 review_target="${target}" 的记录`).toBeDefined();
      // 正式评审必须是 rev-uiux 角色手动登记的记录，不能是 git-log 回填出的、拿不到
      // 真实分数的占位行（这些行的 backfill_status 恒为 "unresolved"，total_score 恒为 0，
      // 会绕过下面的分数断言产生假绿）。
      expect(
        latest!.backfill_status,
        `review_target="${target}" 的最新记录 backfill_status=${latest!.backfill_status}，` +
          "不是正式评审登记（manual），不能作为门槛判定依据",
      ).toBe("manual");
    },
  );

  it.each(["profile", "org-admin"] as const)(
    "review_target=%s 最新记录总分 ≥9（十分制，人类裁决收窄门槛）",
    (target) => {
      const latest = latestFor(entries, target);
      expect(latest).toBeDefined();
      expect(latest!.scale, `review_target="${target}" 的 scale 应为 10`).toBe(10);
      expect(
        latest!.total_score,
        `review_target="${target}" 最新总分 ${latest!.total_score}/${latest!.scale}，未达 ≥9 门槛`,
      ).toBeGreaterThanOrEqual(9);
    },
  );
});
