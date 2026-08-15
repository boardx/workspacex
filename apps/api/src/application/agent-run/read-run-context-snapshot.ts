/**
 * F157 —— `readAgentRunContextSnapshot`：按 `run_id` 检索一条可审计上下文快照。
 *
 * ## 可见性判定复用 `readAgentRun` 同一条，不新开第二套
 *
 * 一条快照记录的是「这次 run 到底喂了什么」——它的可见性天然等于它所属 run 本身的可见性，
 * 不是一个独立可见的对象。`read-run.ts` 自己的头注已经把理由写清楚：§9 的判权矩阵把
 * run-status 行的决策放进它所在线程那一列，第二次为「谁能看这条快照」写一遍同样的规则，
 * 正是 AGENTS.md 点名的「同一事实不得声明在两处」。所以这里走完全相同的两步——
 * `findLocator` 在判权之前只问 ids，`resolveVisibility` 给出唯一的决策——只是最后一步换成
 * 读快照而不是读 run 投影。
 */
import type { OrgId } from "../../domain/org-id";
import { resolveVisibility, type ResolveVisibilityDeps } from "../chat/resolve-visibility";
import type { AgentRunStore } from "./ports";
import type { AgentRunContextSnapshot, AgentRunContextSnapshotPort } from "./context-snapshot";

/** 同 `AgentRunNotVisibleError`（`read-run.ts`）一条纪律：不区分「不存在」与「无权」。 */
export class AgentRunContextSnapshotNotVisibleError extends Error {}

export interface ReadAgentRunContextSnapshotDeps extends ResolveVisibilityDeps {
  readonly runs: AgentRunStore;
  readonly snapshots: AgentRunContextSnapshotPort;
}

/**
 * `null` 返回值只代表「这个 run 存在、你也能看，但它还没有快照」（例如 run 早于 F157 上线，
 * 或组装从未走到写快照那一步——见 `context-snapshot.ts` 头注列出的几种未组装到底的路径）。
 * 与「不可见」是两码事：后者一律抛 `AgentRunContextSnapshotNotVisibleError`，不区分
 * 「不存在」与「无权」（同 `readAgentRun` 的 I-3 纪律：可区分的拒绝会把这个用例变成一个
 * 能探测 run id 是否存在的 oracle）。
 */
export async function readAgentRunContextSnapshot(
  deps: ReadAgentRunContextSnapshotDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly runId: string },
): Promise<AgentRunContextSnapshot | null> {
  const locator = await deps.runs.findLocator(input.orgId, input.runId);
  if (locator === null) throw new AgentRunContextSnapshotNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: locator.projectId,
    threadId: locator.threadId,
  });
  if (outcome.kind !== "allow") throw new AgentRunContextSnapshotNotVisibleError();

  return deps.snapshots.findByRunId(input.orgId, input.runId);
}
