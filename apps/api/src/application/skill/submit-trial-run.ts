/**
 * F962 —— 试跑的**提交**与**轮询读**两端（design-delta `skill-sandbox-execution` §6.1）。
 *
 * 执行那一半在 `execute-trial-run.ts`。这里只做两件小事，刻意保持薄：
 * 提交 = 授权 + 写一行 `queued` + kick；轮询 = 按提交者读一行。
 *
 * ## 授权口径**不变**（contract §6.3：不改授权）
 *
 * 与同步实现 `trial-run-skill.ts` 逐字相同：只要求「是这个组织的成员」，不要求 admin。
 * 理由见那个文件的头注（契约的 `err` 里没有任何角色/权限码）。⚠ 不在转异步这次
 * 顺手收紧或放宽它 —— 那会让一次形态改造夹带一个没人签核的权限变更。
 */
import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { TrialRunSkillError } from "./trial-run-skill";
import type {
  SkillTrialRunExecutorPort,
  SkillTrialRunStore,
  TrialRunRow,
} from "./trial-run-async-ports";

export interface SubmitTrialRunDeps {
  readonly identities: IdentityRepository;
  readonly store: SkillTrialRunStore;
  readonly executor: SkillTrialRunExecutorPort;
  /** 测试注入可预期的 id。 */
  readonly idFor?: () => string;
}

export interface SubmitTrialRunInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly versionId: string;
  readonly sampleInput: string;
}

/**
 * 提交一次试跑，返回它的 id（= 契约 `runTrialRun.out.asyncTaskId`）。
 *
 * ⚠ **不在这里做任何模型/沙箱调用**。提交必须是快的：R9 要求超 10s 转后台任务，
 *   而实测单次模型调用就要 33.5s～300s。任何"先试一下同步、慢了再转异步"的折中都会
 *   把这条 HTTP 重新拖回超时区。
 */
export async function submitTrialRun(
  deps: SubmitTrialRunDeps,
  input: SubmitTrialRunInput,
): Promise<{ readonly asyncTaskId: string }> {
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership) throw new TrialRunSkillError("DEPENDENCY_UNAVAILABLE");

  const id = deps.idFor ? deps.idFor() : `tr_${randomUUID()}`;
  await deps.store.enqueue({
    orgId: input.orgId,
    id,
    actorId: input.actorId,
    versionId: input.versionId,
    sampleInput: input.sampleInput,
  });

  /**
   * fire-and-forget。⚠ 刻意**不 await**：提交端点的响应时间不该取决于一次可能
   * 长达数分钟的模型调用。执行失败会落成终态行，由轮询端看见 —— 不会因为这里
   * 不等待而丢失。
   */
  deps.executor.kick(input.orgId);

  return { asyncTaskId: id };
}

export interface ReadTrialRunDeps {
  readonly store: SkillTrialRunStore;
}

/**
 * 轮询读。
 *
 * ⚠ 返回 `null` 有**三种**成因：不存在、别人的、别的组织的。三者**必须**在调用方
 *   收敛成同一个裸 404 —— 区分它们等于提供一个存在性预言机（同
 *   `agent-run.controller.ts` 的纪律）。所以这里刻意不区分，也不返回原因。
 */
export async function readTrialRun(
  deps: ReadTrialRunDeps,
  input: { readonly orgId: OrgId; readonly actorId: string; readonly trialRunId: string },
): Promise<TrialRunRow | null> {
  return deps.store.findForActor({
    orgId: input.orgId,
    actorId: input.actorId,
    id: input.trialRunId,
  });
}
