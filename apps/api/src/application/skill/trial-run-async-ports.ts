/**
 * F962（design-delta `skill-sandbox-execution` §6.1）——试跑转异步的应用层端口。
 *
 * 形态照抄 `AgentRunStore` + `AgentRunExecutorPort`（提交 → kick → 认领 → 轮询），
 * **但不复用 `agent_runs` 那张表**：完整理由见迁移文件
 * `20260819120000_f962_skill_trial_runs_async.sql` 头注（一句话：那张表的
 * `thread_id`/`input_message_id` 是 NOT NULL FK 指向聊天线程与消息，
 * 而试跑既没有线程也没有消息，复用就得伪造聊天行并污染用户的对话列表）。
 *
 * ⚠ 端口定义在 application 层、实现在 infrastructure，与 `SkillSandboxPort` /
 *   `ORG_AGENT_MODEL_READER` 同一条洋葱约束（`lint-arch-deps` 机械门控）。
 */
import type { skills as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";

/** 由契约推导，绝不另写一份（ADR-020）。 */
export type TrialRunStatus = z.infer<typeof C.TrialRunStatus>;
export type TrialRunFailureCode = z.infer<typeof C.TrialRunFailure>["code"];
export type TrialRunArtifactRef = z.infer<typeof C.TrialRunArtifact>;

export interface TrialRunRow {
  readonly id: string;
  readonly actorId: string;
  readonly versionId: string;
  readonly sampleInput: string;
  readonly status: TrialRunStatus;
  readonly output: string | null;
  readonly durationMs: number | null;
  readonly tokens: number | null;
  readonly artifacts: readonly TrialRunArtifactRef[];
  readonly failureCode: TrialRunFailureCode | null;
  readonly failureStderr: string | null;
  readonly attempts: number;
}

/** 被认领到的一条待执行试跑。 */
export interface ClaimedTrialRun {
  readonly id: string;
  readonly actorId: string;
  readonly versionId: string;
  readonly sampleInput: string;
}

export interface SkillTrialRunStore {
  /** 提交：写一行 `queued`，返回它的 id。 */
  enqueue(input: {
    readonly orgId: OrgId;
    readonly id: string;
    readonly actorId: string;
    readonly versionId: string;
    readonly sampleInput: string;
  }): Promise<void>;

  /**
   * 认领最多 `limit` 条 `queued` 并置为 `running`（`FOR UPDATE SKIP LOCKED`）。
   * ⚠ 认领即已改状态：调用方**必须**为每一条走到终态，否则会留下永远 `running`
   *   的行——轮询端看不出它已经死了（同 `AgentRunStore.claimQueued` 的纪律）。
   */
  claimQueued(orgId: OrgId, limit: number): Promise<readonly ClaimedTrialRun[]>;

  succeed(input: {
    readonly orgId: OrgId;
    readonly id: string;
    readonly output: string;
    readonly durationMs: number;
    readonly tokens: number;
    readonly artifacts: readonly TrialRunArtifactRef[];
    readonly attempts: number;
  }): Promise<void>;

  /**
   * 置为 `failed`。
   * ⚠ `stderr` 传**原文**。不许在这一层加工成友好文案（#660）——
   *   加工要发生在渲染侧，且渲染侧也得能拿到原文。
   */
  fail(input: {
    readonly orgId: OrgId;
    readonly id: string;
    readonly code: TrialRunFailureCode;
    readonly stderr: string;
    readonly attempts: number;
  }): Promise<void>;

  /**
   * 轮询读。
   * ⚠ 只返回 `actorId` 本人提交的那条；别人的 / 不存在的一律 `null`，
   *   由 controller 翻成**裸 404**（不给存在性预言机，同 `agent-run.controller.ts`）。
   */
  findForActor(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly id: string;
  }): Promise<TrialRunRow | null>;
}

/**
 * 执行器。`kick` 是 fire-and-forget：提交后立刻推一下，不等它跑完。
 *
 * ⚠ 为什么是 kick 而不是定时扫表：`skill_trial_runs` 是 `FORCE ROW LEVEL SECURITY`，
 *   一个不带租户上下文的扫描**永远看到 0 行**（同 `agent-run-executor.ts` 头注记过的
 *   同一条）。所以推动力必须来自一个已经知道 orgId 的调用点。
 */
export interface SkillTrialRunExecutorPort {
  tick(orgId: OrgId): Promise<number>;
  kick(orgId: OrgId): void;
}

export const SKILL_TRIAL_RUN_STORE = Symbol("SkillTrialRunStore");
export const SKILL_TRIAL_RUN_EXECUTOR = Symbol("SkillTrialRunExecutor");
