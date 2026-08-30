/**
 * `readAgentRun` -- the authorized read behind `GET /agent-runs/:runId` (delta §5).
 *
 * ## Why authorization goes through the CHAT decision and not a new one
 *
 * A run is not an independently visible object: it exists because somebody wrote a message
 * in a thread, and §9's matrix puts the run-status row's decision in the same column as
 * the thread it is embedded in. So this uses `resolveVisibility`, the single implementation
 * every Chat read path already goes through. Writing a second rule here is how two answers
 * to "may this person see this thread" come to exist, and nobody is told the day they
 * start disagreeing.
 *
 * ## Two calls, not one, and why that is not a hole
 *
 * `findLocator` runs BEFORE the decision, because the decision needs the run's thread and
 * project to even be asked -- gating it on the answer would be circular in exactly the way
 * `pg-identity-repository`'s allowlist entry describes. It returns ids and nothing else.
 * The run's content is fetched separately and comes back `Guarded`, so it can only be
 * unwrapped by handing over the decision that was just made.
 */
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { resolveVisibility } from "../chat/resolve-visibility";
import { DEFAULT_STALE_RUNNING_THRESHOLD_MS, type AgentRunStore, type RunProjection } from "./ports";

/**
 * One exit for "no such run", "not your tenant" and "not your thread".
 *
 * Chat's I-3 rule applies here too: a distinguishable refusal turns this endpoint into an
 * oracle that confirms which run ids exist. The interface layer maps this to 404.
 */
export class AgentRunNotVisibleError extends Error {}

export interface ReadAgentRunDeps extends ResolveVisibilityDeps {
  readonly runs: AgentRunStore;
}

export async function readAgentRun(
  deps: ReadAgentRunDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly runId: string },
): Promise<RunProjection> {
  const locator = await deps.runs.findLocator(input.orgId, input.runId);
  if (locator === null) throw new AgentRunNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: locator.projectId,
    threadId: locator.threadId,
  });
  if (outcome.kind !== "allow") throw new AgentRunNotVisibleError();

  const guarded = await deps.runs.readRun(input.orgId, input.runId);
  if (guarded === null) throw new AgentRunNotVisibleError();
  let disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();

  /**
   * 2026-08-30（devapp 真栈复现）—— `AgentRunStore.reclaimStaleRunning`（该方法自己的
   * 文档有完整取证）此前只在 `AgentRunExecutor.tick()`（下一条消息触发的 kick）里跑。
   * 用户提交一条任务后**只刷新页面、不再发第二条消息**——前端 `useCopilotKitV2
   * RunRestore` 轮询的正是这条纯读端点——永远等不到下一次 kick，卡住的行因此永远
   * 等不到被捞回的那一刻。这里补上第二个触发点：读到 `status === "running"` 时顺手
   * 核实一次是否已经卡够久，单条只读请求就能让它自愈，不必等另一条消息。
   *
   * ⚠ 只在 `status === "running"` 时才付出这次额外 UPDATE 的代价——绝大多数轮询读到
   * 的是已经终态或压根不是 running 的行，这条早退让这个检查只落在真正可能是候选的
   * 那一小撮请求上，不是每次 GET 都无条件跑一遍。
   *
   * `reclaimStaleRunning` 是按 org 批量回收（不是只看这一个 runId）——顺带清掉同一个
   * org 里其它同样卡住的行，是这次读的良性副作用，不是本函数存心要做的事。回收真的
   * 发生时（`reclaimed > 0`）必须重读一遍：`guarded` 是回收前拍的快照，回收如果正好
   * 命中了这一行，状态已经在数据库里翻成 `failed`，原样吐出旧快照就是在撒谎。
   */
  if (disclosed.payload.status === "running") {
    const reclaimed = await deps.runs.reclaimStaleRunning(input.orgId, DEFAULT_STALE_RUNNING_THRESHOLD_MS);
    if (reclaimed > 0) {
      const refreshed = await deps.runs.readRun(input.orgId, input.runId);
      if (refreshed === null) throw new AgentRunNotVisibleError();
      disclosed = discloseDecided(refreshed, outcome.base);
      if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();
    }
  }

  return disclosed.payload;
}
