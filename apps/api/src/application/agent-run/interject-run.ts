/**
 * `interjectAgentRun` —— UC-4（`artifacts-steering` 契约束 usecases.md）：run 处于
 * `running` 时用户发一条新指令重新引导（R3'）。这是 `POST /agent-runs/:runId/interject`
 * 唯一的应用层实现。
 *
 * 可见性纪律沿用 `continueArtifact`/`decideAgentRun`（同目录/同束既有先例）：
 * locator → `resolveVisibility` → 用 `discloseDecided`/`isDisclosed` 守卫读到的投影。
 * R5 在此之上再收窄一层——"插话功能对 run 的发起者开放，不支持其他协作者插话"：
 * 通过可见性判定只说明调用者能看见这个 run（同组织内有权限访问），不代表调用者
 * 就是触发它的那个人，两者是两件事，契约把两者都揉进同一个 `NOT_VISIBLE`（usecases.md
 * UC-4 err 表只有 `NOT_VISIBLE`/`RUN_NOT_RUNNING` 两种，没有第三个"不是你发起的"码）。
 *
 * 状态先验：只接受 `running`。`usecases.md` UC-4 明写其余状态（`awaiting_tool_permission`
 * 或终态）"待人类在签核时确认"，人类签核 `design-signoff.md` 时已确认（status: confirmed），
 * 本函数的实现即该确认的落地——一律拒绝，不排队、不转换成其它交互。
 */
import type { OrgId } from "../../domain/org-id";
import type { artifactsSteering as AS } from "@repo/contracts";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { resolveVisibility } from "../chat/resolve-visibility";
import { AgentRunNotVisibleError } from "./read-run";
import type { AgentRunStore } from "./ports";
import type { InterjectionStore } from "./interjection-store";

export class AgentRunNotRunningError extends Error {
  constructor(readonly status: string) {
    super(`run is in "${status}", not running`);
  }
}

export interface InterjectAgentRunDeps extends ResolveVisibilityDeps {
  readonly runs: AgentRunStore;
  readonly interjections: InterjectionStore;
  readonly clock: { readonly now: () => Date };
}

export async function interjectAgentRun(
  deps: InterjectAgentRunDeps,
  input: { readonly userId: string; readonly orgId: OrgId } & AS.InterjectInput,
): Promise<AS.InterjectOutput> {
  const locator = await deps.runs.findLocator(input.orgId, input.runId);
  if (locator === null) throw new AgentRunNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId, orgId: input.orgId,
    projectId: locator.projectId, threadId: locator.threadId,
  });
  if (outcome.kind !== "allow") throw new AgentRunNotVisibleError();

  const guarded = await deps.runs.readRun(input.orgId, input.runId);
  if (guarded === null) throw new AgentRunNotVisibleError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new AgentRunNotVisibleError();

  // R5：只对发起者开放——可见性判定通过之后再收窄一层，"看得见"不等于"是你发起的"。
  const requesterUserId = (await deps.runs.findRequesterUserId?.(input.orgId, input.runId)) ?? null;
  if (requesterUserId === null || requesterUserId !== input.userId) throw new AgentRunNotVisibleError();

  if (disclosed.payload.status !== "running") {
    throw new AgentRunNotRunningError(disclosed.payload.status);
  }

  const interjectionId = deps.ids.next();
  const receivedAt = deps.clock.now().toISOString();
  await deps.interjections.submit(input.orgId, input.runId, { interjectionId, text: input.text, receivedAt });

  return { runId: input.runId, interjectionId, receivedAt };
}
