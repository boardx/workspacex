/**
 * F13（issue #1875）反证套件：uiux-review-log.jsonl 的 schema 校验。
 *
 * 覆盖两件事：
 *   1. 合法/非法记录分别应该 pass/fail validateEntry（反证：故意写坏记录，确认门控真的红）。
 *   2. 仓库里真实的 uiux-review-log.jsonl（若已存在）每一行都必须合法、可解析——
 *      这是防止未来有人手改/脚本写坏文件后混进仓库的机械门控。
 */
import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UIUX_REVIEW_LOG_PATH,
  appendEntries,
  dedupeKey,
  readEntries,
  validateEntry,
  type UiuxReviewLogEntry,
} from "./uiux-review-log";

function validEntry(overrides: Partial<UiuxReviewLogEntry> = {}): UiuxReviewLogEntry {
  return {
    review_target: "chat-main",
    review_date: "2026-08-10",
    rubric: "chat-main-fidelity-rubric.md",
    dimensions: { D1: 9, D2: 8 },
    total_score: 9,
    scale: 10,
    deductions: "D2 扣 1 分：卡片内边距偏窄",
    issue_ref: "#728",
    pr_ref: "#873",
    commit_sha: "aa772c79aa004c8d03717a97e8c4699b9cf27933",
    source: "git-log-backfill",
    backfill_status: "parsed",
    notes: null,
    ...overrides,
  };
}

describe("validateEntry: 合法记录放行", () => {
  it("完整记录（有维度明细）通过", () => {
    expect(validateEntry(validEntry())).toEqual([]);
  });

  it("R4-A1：dimensions 为 null（回填拿不到明细）也通过——不强行套用固定十维", () => {
    expect(validateEntry(validEntry({ dimensions: null }))).toEqual([]);
  });

  it("R4-A1：自定义非标准维度 key 也通过", () => {
    expect(
      validateEntry(validEntry({ dimensions: { "流式反馈": 1, "多轮上下文": 0 } })),
    ).toEqual([]);
  });

  it("manual 来源、无 commit_sha 也通过", () => {
    expect(
      validateEntry(validEntry({ source: "manual", commit_sha: null, backfill_status: "manual" })),
    ).toEqual([]);
  });
});

describe("validateEntry: 反证——非法记录必须被拦住", () => {
  it("缺 review_target 报错", () => {
    const e = validEntry();
    // @ts-expect-error 故意构造非法记录
    delete e.review_target;
    expect(validateEntry(e).length).toBeGreaterThan(0);
  });

  it("review_date 格式错误报错", () => {
    expect(validateEntry(validEntry({ review_date: "2026/08/10" })).length).toBeGreaterThan(0);
  });

  it("total_score 超出 [0, scale] 报错", () => {
    expect(validateEntry(validEntry({ total_score: 11, scale: 10 })).length).toBeGreaterThan(0);
  });

  it("total_score 不是数字报错", () => {
    // @ts-expect-error 故意构造非法记录
    expect(validateEntry(validEntry({ total_score: "9" })).length).toBeGreaterThan(0);
  });

  it("dimensions 里混入非数字值报错", () => {
    // @ts-expect-error 故意构造非法记录
    expect(validateEntry(validEntry({ dimensions: { D1: "high" } })).length).toBeGreaterThan(0);
  });

  it("source 值非法报错", () => {
    // @ts-expect-error 故意构造非法记录
    expect(validateEntry(validEntry({ source: "made-up" })).length).toBeGreaterThan(0);
  });

  it("backfill_status=unresolved 但 notes 为空报错——不能假装解析成功却不留原始文本", () => {
    expect(
      validateEntry(validEntry({ backfill_status: "unresolved", notes: null })).length,
    ).toBeGreaterThan(0);
  });

  it("backfill_status=unresolved 且 notes 有内容则放行", () => {
    expect(
      validateEntry(
        validEntry({ backfill_status: "unresolved", notes: "commit abc123：格式无法可靠解析出总分" }),
      ),
    ).toEqual([]);
  });
});

describe("appendEntries / readEntries：append-only 往返", () => {
  it("写入后能原样读回，且拒绝写入非法记录（不写半截数据）", () => {
    const dir = mkdtempSync(join(tmpdir(), "uiux-review-log-"));
    const path = join(dir, "log.jsonl");
    try {
      appendEntries([validEntry({ review_target: "a" }), validEntry({ review_target: "b" })], path);
      let entries = readEntries(path);
      expect(entries.map((e) => e.review_target)).toEqual(["a", "b"]);

      // 反证：批次里混入一条非法记录，整批拒绝，不应该把合法的那条也写进去。
      expect(() =>
        appendEntries(
          [validEntry({ review_target: "c" }), validEntry({ review_target: "d", total_score: 99 })],
          path,
        ),
      ).toThrow();
      entries = readEntries(path);
      expect(entries.map((e) => e.review_target)).toEqual(["a", "b"]); // 未变

      // 再追加一条合法记录，确认 append 不覆写已有行。
      appendEntries([validEntry({ review_target: "e" })], path);
      entries = readEntries(path);
      expect(entries.map((e) => e.review_target)).toEqual(["a", "b", "e"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R7：更正走追加新记录而不是改写旧行——同一 review_target 允许出现两条不同总分的记录", () => {
    const dir = mkdtempSync(join(tmpdir(), "uiux-review-log-"));
    const path = join(dir, "log.jsonl");
    try {
      appendEntries([validEntry({ review_target: "chat-main", total_score: 8 })], path);
      appendEntries(
        [
          validEntry({
            review_target: "chat-main",
            total_score: 9,
            notes: "更正：round 16 记录误按 8 分登记，round 17 独立复核确认 9 分",
          }),
        ],
        path,
      );
      const entries = readEntries(path);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.total_score)).toEqual([8, 9]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("坏 JSON 行会在 readEntries 里报出行号，不静默跳过", () => {
    const dir = mkdtempSync(join(tmpdir(), "uiux-review-log-"));
    const path = join(dir, "log.jsonl");
    try {
      appendEntries([validEntry()], path);
      appendFileSync(path, "{not json\n");
      expect(() => readEntries(path)).toThrow(/:2 /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dedupeKey", () => {
  it("同一 commit + 同一评审对象 + 同一日期 + 同一总分 产生相同 key", () => {
    const a = validEntry();
    const b = validEntry();
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });

  it("总分不同则 key 不同（视为不同事件，即便同一 commit）", () => {
    const a = validEntry({ total_score: 9 });
    const b = validEntry({ total_score: 8 });
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });
});

describe("仓库真实数据（若已存在）：每一行都必须合法", () => {
  it(`${UIUX_REVIEW_LOG_PATH} 的每一行都通过 validateEntry`, () => {
    const entries = readEntries(UIUX_REVIEW_LOG_PATH);
    const allProblems = entries.flatMap((e, i) => {
      const problems = validateEntry(e);
      return problems.map((p) => `line ${i + 1} (${e.review_target}): ${p}`);
    });
    expect(allProblems).toEqual([]);
  });
});
