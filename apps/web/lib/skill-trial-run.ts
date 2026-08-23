/**
 * `POST /skill-versions/:versionId/trial-run` + `GET /skill-trial-runs/:trialRunId`
 * （契约 `skills.operations.runTrialRun`/`getTrialRun`）的前端薄封装——
 * `AgSkillEditor`（模型 A 的文件编辑器，见 `ag-screens.tsx`）「试跑」按钮唯一的
 * 真实调用方。
 *
 * ⚠ 后端实现（`apps/api/src/application/skill/trial-run-skill.ts` /
 *   `submit-trial-run.ts`）面向的是**模型 A**（`skills`/`skill_versions`/
 *   `skill_version_files`），不是声明式契约模型 B——`versionId` 传的是模型 A 的
 *   `skill_versions.id`。别处若要给模型 B 接一条独立的试跑，不要复用这个封装，
 *   理由见后端那份文件头注。
 *
 * ## F962 之后：POST 恒转异步，轮询是必需的一半——不是可选加强
 *
 * 2026-08-19（真栈回归发现）：F962（design-delta `skill-sandbox-execution`）把
 * `POST /trial-run` 从「同步返回结果」改成「恒返回 `asyncTaskId`，`trialRun` 恒
 * `null`」（契约签核记录：「接受试跑转异步（会改试跑 API 形状）」，见后端
 * `skill-trial-run.controller.ts` 头注）。这一半的前端封装在那次改造里加了
 * `getTrialRun`，但**调用方 `ag-screens.tsx` 没有跟着改**——它仍然读
 * `result.trialRun`（永远 `null`），把「转后台任务」当成一个几乎不会发生的兜底
 * 分支处理，实际上**每一次点击都会走进那个分支**，用户永远看不到试跑结果。
 * `pnpm run verify:fullstack-smoke` 因此在 F962 合入后开始必现失败（不是偶发，
 * 本地连续复现两次），补的就是这半条轮询链路。
 *
 * 退避参数抄的是 `lib/agent-run.ts` 同款轮询已经在用的那一套（`chat-live-message-panel.tsx`
 * 的 `RUN_POLL_*` 常量），不是本文件重新发明一套：首次 400ms、×1.5 退避、封顶 3s。
 * 预算放宽到 300s（不是 agent run 那边的 90s）——`submit-trial-run.ts` 头注实测
 * 「单次模型调用就要 33.5s～300s」，用同样的预算会在真实模型慢的时候提前放弃轮询、
 * 把「还在跑」误判成「查不到结果」。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, ApiError } from "./api-client";

export type RunTrialRunOut = z.infer<typeof skills.operations.runTrialRun.out>;
export type GetTrialRunOut = z.infer<typeof skills.operations.getTrialRun.out>;
export type TrialRunStatus = z.infer<typeof skills.TrialRunStatus>;

function fillPath(template: string, params: Record<string, string>): string {
  let path = template;
  for (const [k, v] of Object.entries(params)) {
    path = path.replace(`:${k}`, encodeURIComponent(v));
  }
  return path;
}

export async function runSkillTrialRun(
  versionId: string,
  sampleInput: string,
): Promise<RunTrialRunOut> {
  return apiRequest<RunTrialRunOut>(
    fillPath(skills.operations.runTrialRun.path, { versionId }),
    { method: "POST", body: { versionId, sampleInput } },
  );
}

export async function getSkillTrialRun(trialRunId: string): Promise<GetTrialRunOut> {
  return apiRequest<GetTrialRunOut>(
    fillPath(skills.operations.getTrialRun.path, { trialRunId }),
    { method: "GET" },
  );
}

/**
 * 终态集合——唯一事实源取自契约的状态机（`packages/contracts/src/skills.ts`
 * 的 `TrialRunStatus` 与 `execute-trial-run.ts` 头注的状态转移图：
 * `queued → running → succeeded|failed`，两个终态都不再离开）。
 */
const TERMINAL_TRIALRUN_STATUSES: ReadonlySet<TrialRunStatus> = new Set(["succeeded", "failed"]);

export function isTerminalTrialRunStatus(status: TrialRunStatus): boolean {
  return TERMINAL_TRIALRUN_STATUSES.has(status);
}

/**
 * #1941 —— 试跑链路（提交 `runSkillTrialRun` 或轮询 `pollSkillTrialRun`）撞到 401
 * 的判定，同 issue #1819/PR #1820 里 `chat-live-message-panel.tsx` 对
 * `runObservation.authExpired` 的判定同一条规则：bearer 已过期，不是"这次没读到、
 * 下次再试"的可重试失败——继续轮询没有意义，唯一出路是用户重新登录。
 *
 * 调用方（`ag-screens.tsx`）据此把 `HTTP 401`/裸 reasonCode 换成明确的
 * "登录已失效，请重新登录"文案，不是让 `describeAssetError` 的通用兜底吞掉这个区分。
 */
export function isTrialRunAuthExpiredError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

const POLL_FIRST_DELAY_MS = 400;
const POLL_BACKOFF = 1.5;
const POLL_MAX_DELAY_MS = 3_000;
/** 见文件头：真实模型调用实测 33.5s～300s，预算必须覆盖这个上界，不能抄 agent run 的 90s。 */
const POLL_BUDGET_MS = 300_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 提交端点的 `enqueue()` 在返回响应前已 `await`，正常情况下行早已提交；但真实观测到
 * （2026-08-19，`skill-agent-import-usecase-audit.spec.ts` ③ 复现两次）提交后立即
 * 轮询会短暂 404——不追查是连接池/RLS 会话变量的哪一层，只按行为处理：一个刚提交
 * 的资源在极短窗口内读不到，视为"还没来得及可见"而不是"不存在"，在这个宽限期内
 * 把 404 当非终态继续轮询；超过宽限期仍 404 才是真的不存在（比如 id 打错、越权），
 * 原样抛出不吞掉。
 */
const NOT_FOUND_GRACE_MS = 5_000;

/**
 * 轮询直到终态或预算耗尽。**不吞真正的错误**——除了上面这条"刚提交、暂时读不到"
 * 的宽限期，`getSkillTrialRun` 抛出的其余异常原样向上传播，调用方按既有的
 * `describeAssetError` 处理；这里只负责"该不该再问一次"。
 *
 * @throws {Error} 预算耗尽仍未到终态时，抛一个明确说明"仍在后台跑，不是失败"的错误，
 *   调用方据此渲染成「仍在执行，可稍后刷新」，不是当作试跑失败展示。
 */
export async function pollSkillTrialRun(
  trialRunId: string,
  opts?: { readonly signal?: AbortSignal },
): Promise<GetTrialRunOut> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  const notFoundDeadline = Date.now() + NOT_FOUND_GRACE_MS;
  let delay = POLL_FIRST_DELAY_MS;
  // 提交响应刚落地就问，多半还没来得及被自己的写路径看见——先等一次首轮退避，
  // 不在零延迟那一刻就问（这也是真实复现里 404 出现的那个时间点）。
  await sleep(delay);
  for (;;) {
    if (opts?.signal?.aborted) throw new DOMException("polling aborted", "AbortError");
    let view: GetTrialRunOut;
    try {
      view = await getSkillTrialRun(trialRunId);
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      if (status === 404 && Date.now() < notFoundDeadline) {
        // 宽限期内的 404：当非终态处理，走下面同一套退避继续问。
        delay = Math.min(delay * POLL_BACKOFF, POLL_MAX_DELAY_MS);
        await sleep(delay);
        continue;
      }
      // #1941 —— 401（`isTrialRunAuthExpiredError`）落在这里：不是 404 宽限期内的
      // 那一种，直接原样抛出，不再进入下一轮退避。这就是"401 立即停止轮询"——
      // 调用方用 `isTrialRunAuthExpiredError` 识别出来后渲染明确的重新登录文案。
      throw e;
    }
    if (isTerminalTrialRunStatus(view.status)) return view;
    if (Date.now() + delay > deadline) {
      throw new Error("TRIALRUN_POLL_BUDGET_EXCEEDED");
    }
    await sleep(delay);
    delay = Math.min(delay * POLL_BACKOFF, POLL_MAX_DELAY_MS);
  }
}
