#!/usr/bin/env -S pnpm exec tsx
/**
 * F13（issue #1875）：git log commit subject 级别的回填（uiux-review-log-backfill.ts）
 * 拿不到「十维/十项各自得分」——commit message 从来不写这么细。真正的逐维明细活在
 * `.harness/state/chat-ux-scoring-log.md` 这类评分日志正文里（Markdown 表格）。
 *
 * 本脚本手工搬运**已经在仓库里存在的、有完整逐维明细的评审记录**，不是编造数据——
 * 每条记录的 dimensions 都能对照 `.harness/state/chat-ux-scoring-log.md` 逐字核对。
 * 目前仓库里只有 2026-08-23 这一轮 track B 评审留了完整的 10 项判定表；早期轮次
 * （如 #728 round 1-17）的十维分数散落在 commit subject 里，只有总分没有逐维明细，
 * 由 uiux-review-log-backfill.ts 覆盖（backfill_status=unresolved 或只有 total_score）。
 *
 * 幂等：写入前检查是否已有同 key 记录，重复跑不会重复写入。
 */
import { appendEntries, dedupeKey, readEntries, UIUX_REVIEW_LOG_PATH, type UiuxReviewLogEntry } from "./uiux-review-log";

/**
 * 逐字对照 `.harness/state/chat-ux-scoring-log.md`「## 2026-08-23 · UX-9 Line A/B/C/D
 * 合并后重评」一节的表格：judgement 列 1=得分、0=未得分，key 用文件里的原始序号+判据名，
 * 不改写措辞。
 */
const KNOWN_DETAILED_ENTRIES: UiuxReviewLogEntry[] = [
  {
    review_target: "chat-ux-track-b",
    review_date: "2026-08-23",
    rubric: ".harness/instructions/chat-ux-acceptance-criteria.md",
    dimensions: {
      "1-流式反馈": 1,
      "2-可见的规划步骤": 1,
      "3-工具调用可见": 1,
      "4-真实的多步能力": 0,
      "5-语音输入体验": 0,
      "6-多轮上下文": 0,
      "7-错误处理透明度": 0,
      "8-消息呈现质量": 1,
      "9-控制感": 1,
      "10-整体连贯性": 0,
    },
    total_score: 5,
    scale: 10,
    deductions:
      "4/5/6 三项按判据文件说明「本地取证路径上结构性不可得分」（桩上游+无头浏览器无真实麦克风），" +
      "7 项为回归（裸错误码 MODEL_CALL_FAILED + 消息流内无失败呈现 + 失败行挂成功勾 + 无重试入口），" +
      "10 项因 agent 身份中途漂移/发送后短暂空态矛盾/顶栏自相矛盾/终态计划面板未清零未得分。",
    issue_ref: null,
    pr_ref: "#1859",
    commit_sha: "ef9dffe9b7a745fef76a2a96d12e7974ae1e1fbe",
    source: "manual",
    backfill_status: "manual",
    notes:
      "手工搬运自 .harness/state/chat-ux-scoring-log.md『2026-08-23 · UX-9 Line A/B/C/D 合并后重评』一节，" +
      "实测 SHA c284e1073b65f9f606cf32b4dd34f950e5c46ad，独立评分（非实现者自评），总分 5/10（上一轮 1/10）。" +
      "该文件是本条记录的权威来源，本行只是把它结构化进统一日志，不是另一份事实源。",
  },
];

function main(): void {
  const existing = readEntries(UIUX_REVIEW_LOG_PATH);
  const existingKeys = new Set(existing.map(dedupeKey));
  const fresh = KNOWN_DETAILED_ENTRIES.filter((e) => !existingKeys.has(dedupeKey(e)));

  if (fresh.length === 0) {
    console.log("没有新的手工明细记录需要写入（已存在或列表为空）。");
    return;
  }
  appendEntries(fresh, UIUX_REVIEW_LOG_PATH);
  console.log(`已追加 ${fresh.length} 条带逐维明细的手工记录到 ${UIUX_REVIEW_LOG_PATH}`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
