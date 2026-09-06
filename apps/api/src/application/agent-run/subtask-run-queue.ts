/**
 * 异步子任务 run 队列（issue #2664）—— 复用 `execute-run.ts` 的
 * `executeQueuedRuns`/`claimQueued`「领取一批 → 逐条执行 → 各自写回终态，一条失败不
 * 拖累同批其它条」节奏，但载体是**独立的**子任务 run 记录（`@repo/contracts`
 * `subtaskRun.SubtaskRun`），不是 `agent_runs` 表本身。
 *
 * ## 为什么不直接把子任务塞进 `agent_runs`
 *
 * `agent_runs` 一行的"可执行"语义绑定着一整套主 agent 身份：`agentVersionId`、
 * `skillVersionIds`、`modelProvider`/`modelId`、`threadId`/`inputMessageId`——`executeClaimed`
 * 读的是"这个已批准配置的 Agent 收到这条消息该怎么答"。一个由主 agent 在对话中途
 * `spawn_async_task` 出来的子任务，没有自己的"消息"、不需要走 HITL/plan-control/
 * canvas-template 这一整套主对话专属的上下文装配——把它硬套进 `agent_runs` 的形状，
 * 要么让那些字段变成没有真实意义的占位符，要么逼子任务也拥有一个"消息"（凭空捏造）。
 * 所以这里新开一张独立的账本，只携带子任务真正需要的东西：目标描述、上下文、父 run id、
 * 状态与结果——同一套"排队 → 领取 → 执行 → 终态"**机制**（issue #2664 原文用词），
 * 不是同一张表。
 *
 * ## `execute` 依赖注入，而不是这个文件自己决定"怎么执行一个子任务"
 *
 * 子任务具体怎么跑（调用哪个模型、要不要走 deep-agent-service 的另一次子代理委托）是
 * 部署期的选择，不是队列机制本身的关注点——同 `execute-run.ts` 把"模型怎么调"钉在
 * `ModelCallPort` 端口而不是 `executeQueuedRuns` 内联的纪律。生产合成把 `execute` 接到
 * 一次真实模型调用（复用 `ModelCallPort`）；测试用一个纯函数 fake 验证"领取 → 执行 →
 * 写回"这条链路本身，不需要真实模型或数据库。
 *
 * ## issue #2666：`get`/`listByParentRun` 供前端查询接口用
 *
 * `SubtaskRunStore.listByParentRun` 是本次（#2666）新增——issue #2664 原始范围只要求
 * `get`（单条读，供测试断言）。前端后台任务面板需要"这个父 run 下所有子任务当前状态"
 * 一次性列出来，而不是逐条按 id 轮询（父 run 派发了几个子任务、id 是什么，前端事先并
 * 不知道），所以补一个按 `parentRunId` 查的方法——与 `get` 同一个只读端口，未破坏既有
 * 接口形状（新增方法，非修改）。
 */
import type { OrgId } from "../../domain/org-id";
import type { subtaskRun as SubtaskRunContract } from "@repo/contracts";

export type SubtaskRun = SubtaskRunContract.SubtaskRun;
export type SubtaskRunStatus = SubtaskRunContract.SubtaskRunStatus;
export type EnqueueSubtaskRunInput = SubtaskRunContract.EnqueueSubtaskRunInput;

/**
 * 子任务 run 的持久化端口——生产使用 `PgSubtaskRunStore`，测试可用
 * `InMemorySubtaskRunStore`。公开队列方法形状保持不变。
 */
export interface SubtaskRunStore {
  /** 入队一条新的子任务 run，初始状态 `pending`。 */
  enqueue(orgId: OrgId, input: EnqueueSubtaskRunInput): Promise<SubtaskRun>;
  /**
   * 领取最多 `limit` 条 `pending` 的子任务 run，原子地把它们翻成 `running` 并返回——
   * 与 `AgentRunStore.claimQueued` 同一个"claim 即状态转移"契约：一旦返回，调用方必须
   * 让每一条都走到 `complete`/`fail` 之一，不能放在原地不管。
   */
  claimQueued(orgId: OrgId, limit: number): Promise<readonly SubtaskRun[]>;
  /** 把一条 `running` 的子任务 run 标记为 `completed`，写入真实结果文本。 */
  complete(orgId: OrgId, id: string, result: string): Promise<void>;
  /** 把一条 `running` 的子任务 run 标记为 `failed`，写入错误信息；不影响同批其它条。 */
  fail(orgId: OrgId, id: string, error: string): Promise<void>;
  /** 按 id 读一条子任务 run；供 issue #2666 的 UI 展示与测试断言用。不存在返回 `null`。 */
  get(orgId: OrgId, id: string): Promise<SubtaskRun | null>;
  /**
   * 按父 run id 列出该 run 下的全部子任务 run（issue #2666 查询接口用）——
   * 顺序为入队顺序（`createdAt` 升序），不存在任何该父 run 的子任务时返回空数组，
   * 不是 `null`（"这个父 run 没有子任务"与"这个父 run 不存在"是两回事，本方法不判后者，
   * 调用方靠 `AgentRunStore` 自己的可见性判定来判"父 run 是否存在/可见"）。
   */
  listByParentRun(orgId: OrgId, parentRunId: string): Promise<readonly SubtaskRun[]>;
}

export class SubtaskIdempotencyConflictError extends Error {}

export const SUBTASK_RUN_STORE = Symbol("SubtaskRunStore");
export const SUBTASK_RUN_EXECUTOR = Symbol("SubtaskRunExecutor");
export interface SubtaskRunExecutorPort {
  tick(orgId: OrgId): Promise<number>;
  kick(orgId: OrgId): void;
}

export interface ExecuteQueuedSubtaskRunsDeps {
  readonly store: SubtaskRunStore;
  /**
   * 真正"跑"一条已领取的子任务——返回结果文本即视为成功；抛出的异常被
   * `executeQueuedSubtaskRuns` 捕获、转成该条的 `fail`，不冒泡到调用方、不影响同批
   * 其它条（与 `execute-run.ts` 的 `executeQueuedRuns` 同一条"一条失败不拖累整批"纪律）。
   */
  readonly execute: (run: SubtaskRun) => Promise<string>;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

/**
 * 领取并执行一批（有界，见 `execute-run.ts` `executeQueuedRuns` 同款 `Math.min(20, ...)`
 * 上限）已入队的子任务 run。返回本批实际领取到的条数（成功与失败都算），供调用方做
 * 可观测性统计——与 `executeQueuedRuns` 的返回值语义逐字相同。
 */
export async function executeQueuedSubtaskRuns(
  deps: ExecuteQueuedSubtaskRunsDeps,
  input: { readonly orgId: OrgId; readonly limit?: number },
): Promise<number> {
  const claimed = await deps.store.claimQueued(input.orgId, Math.min(20, input.limit ?? 10));
  for (const run of claimed) {
    try {
      const result = await deps.execute(run);
      await deps.store.complete(input.orgId, run.id, result);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "unexpected subtask execution failure";
      deps.log("subtask run execution failed", {
        subtaskRunId: run.id, parentRunId: run.parentRunId, detail,
      });
      await deps.store.fail(input.orgId, run.id, detail);
    }
  }
  return claimed.length;
}
