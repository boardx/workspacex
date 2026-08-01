/**
 * F106 — AVA 角标与轮次级原子回滚（D-10 / I-24）。
 *
 * 两条不变量,纯函数层面可断言（不依赖 Postgres,见 issue #74 的本地跑法约定）：
 *
 *   · **I-24 原子回滚**：回滚后源码内容与该轮落笔前版本**逐字节一致**,不留半撤销状态。
 *     底座是 file-first——`rollbackAiRound` 只把「当前版本指针」指回 `baseVersion`,
 *     从不编辑、不合并、不部分恢复。若该轮之后已有更新的版本（他人改动或后续轮次）,
 *     直接回滚会静默吞掉那些改动,所以拒绝并给 `AI_ROUND_SUPERSEDED`
 *     （契约 `rollbackAiRound.err` 已声明此码；本束把「回滚边界」当作替 UC 做的判断，
 *     见 packages/contracts/src/canvas.ts 的 `KNOWN_CONTRACT_GAPS.C_CANVAS_2`）。
 *
 *   · **AVA 角标**：一轮 AI 落笔产生的每一条便签,`authorRef` 都带着具体 agent 的标记
 *     （`ava:<agentId>`）,与人工便签（`authorRef` 无此前缀）在同一份 `stickies` 列表里
 *     可逐条分辨——角标是数据形状的一部分,不是界面画的一层皮。
 *
 *   · **部分成功即整轮不落笔**（契约 `draftFromContextPack` 注释：「一轮内若有便签写入
 *     失败,整轮回滚为「未落笔」」）：`applyAiRound` 对一轮内的全部便签写入做 all-or-
 *     nothing 判定,任何一条写入失败,整轮返回 `baseVersion` 原样,不产生半写状态。
 */
import { createHash } from "node:crypto";

/** 便签落笔请求。`text` 为空视为该条写入失败（供测试构造「一条失败,整轮不落笔」）。 */
export interface AiRoundWrite {
  readonly stickyId: string;
  readonly agentId: string;
  readonly text: string;
}

/** 版本快照里的一条便签——足以分辨 AVA 角标（`authorRef` 前缀）与人工便签。 */
export interface AiRoundSticky {
  readonly stickyId: string;
  readonly authorRef: string;
  readonly aiGenerated: boolean;
  readonly text: string;
}

/** 一个不可变版本快照。`content` 是该版本的完整 markdown 源码（逐字节比对的对象）。 */
export interface AiRoundVersionSnapshot {
  readonly versionId: string;
  readonly content: string;
  readonly contentHash: string;
  readonly stickies: readonly AiRoundSticky[];
}

/** `AVA_AUTHOR_PREFIX` 之外没有第二处拼 `ava:` 前缀的地方——角标的唯一构造点。 */
const AVA_AUTHOR_PREFIX = "ava:";

export function isAvaAuthored(sticky: AiRoundSticky): boolean {
  return sticky.aiGenerated && sticky.authorRef.startsWith(AVA_AUTHOR_PREFIX);
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function renderContent(stickies: readonly AiRoundSticky[]): string {
  return stickies.map((s) => `${s.stickyId}\t${s.authorRef}\t${s.text}`).join("\n");
}

export type ApplyAiRoundResult =
  | { readonly outcome: "applied"; readonly version: AiRoundVersionSnapshot }
  /** 一条写入失败 ⟹ 整轮不落笔，`version` 与传入的 `baseVersion` 逐字节一致（同引用）。 */
  | { readonly outcome: "rolled-back"; readonly version: AiRoundVersionSnapshot };

/**
 * 应用一轮 AI 落笔。`writes` 里任意一条 `text` 为空视为该条写入失败——
 * 整轮判定为 all-or-nothing：要么全部落笔（每条都带 AVA 角标），要么一条都不落笔，
 * 绝不出现「补了 2 张、第 3 张失败」的半成品。
 */
export function applyAiRound(
  baseVersion: AiRoundVersionSnapshot,
  roundId: string,
  writes: readonly AiRoundWrite[],
): ApplyAiRoundResult {
  const hasFailedWrite = writes.some((w) => w.text.trim().length === 0);
  if (hasFailedWrite) {
    // 不产生任何新对象、不部分应用——直接把传入的 baseVersion 原样交还。
    return { outcome: "rolled-back", version: baseVersion };
  }

  const newStickies: AiRoundSticky[] = [
    ...baseVersion.stickies,
    ...writes.map((w) => ({
      stickyId: w.stickyId,
      authorRef: `${AVA_AUTHOR_PREFIX}${w.agentId}`,
      aiGenerated: true,
      text: w.text,
    })),
  ];
  const content = renderContent(newStickies);
  return {
    outcome: "applied",
    version: {
      versionId: `${roundId}-applied`,
      content,
      contentHash: hashContent(content),
      stickies: newStickies,
    },
  };
}

export type RollbackAiRoundResult =
  | { readonly ok: true; readonly restoredVersionId: string; readonly contentHash: string; readonly content: string }
  /** 该轮之后已有更新的版本（他人改动 / 后续轮次）——拒绝直接回滚，不静默吞掉那些改动。 */
  | { readonly ok: false; readonly code: "AI_ROUND_SUPERSEDED" };

/**
 * 轮次级一键回滚（I-24）。`currentHeadVersionId` 必须仍是该轮产出的版本，回滚才会执行——
 * 否则说明这轮之后已经有更新的东西盖在上面，直接回滚会把那部分也吞掉，因此拒绝
 * （`AI_ROUND_SUPERSEDED`），不是回滚到「介于两者之间」的某个折中状态。
 *
 * 回滚成功时返回的 `content`/`contentHash` 与 `baseVersion` **逐字段相等**——这不是靠
 * 断言凑出来的，是因为这里从不对 `baseVersion.content` 做任何变换，只是原样读出。
 */
export function rollbackAiRound(
  baseVersion: AiRoundVersionSnapshot,
  appliedVersion: AiRoundVersionSnapshot,
  currentHeadVersionId: string,
): RollbackAiRoundResult {
  if (currentHeadVersionId !== appliedVersion.versionId) {
    return { ok: false, code: "AI_ROUND_SUPERSEDED" };
  }
  return {
    ok: true,
    restoredVersionId: baseVersion.versionId,
    contentHash: baseVersion.contentHash,
    content: baseVersion.content,
  };
}
