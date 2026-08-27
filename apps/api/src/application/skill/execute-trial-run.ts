/**
 * F962 —— 试跑的**执行**那一半（design-delta `skill-sandbox-execution` §5 §6 §7）。
 *
 * 提交侧只写一行 `queued` 就返回（`submit-trial-run.ts`）；本文件是被 kick 推动的
 * 认领 → 执行 → 落终态的循环。
 *
 * ```
 * claimQueued → 读 skill 正文 → 解析模型 → [ 生成脚本 → 沙箱执行 → 失败回喂 ]×≤3
 *             → 产物 ObjectStore.putOnce → succeed / fail
 * ```
 *
 * ## 三个失败码在这里落地，且**互不合并**（§6.2）
 *
 * | 抛出点 | 落库 `failure_code` | 运维动作 |
 * |---|---|---|
 * | 模型不可用 / 没配模型 | `MODEL_UNAVAILABLE` | 去配模型 |
 * | 读不到 skill 版本 / 不是组织成员 | `DEPENDENCY_UNAVAILABLE` | 看数据与授权 |
 * | 沙箱连不上 / 非 200 / 响应读不懂 | `SANDBOX_UNAVAILABLE` | 看沙箱容器与 socket |
 * | 脚本超硬超时 | `SANDBOX_TIMEOUT` | 单次现象；连续发生才看超时配置 |
 * | 回喂重试用尽 | `SCRIPT_FAILED_AFTER_RETRIES` + **真实 stderr 原文** | 做 skill 的人改 SKILL.md |
 *
 * ⚠ 认领之后**每一条都必须走到终态**。任何提前 return 或未捕获异常都会留下一行永远
 *   `running` 的记录，而轮询端**无法把它与"还在跑"区分开** —— 用户看到的是永远转圈。
 *   所以下面最外层是一个 catch-all，把任何意外映射成 `DEPENDENCY_UNAVAILABLE` 落终态，
 *   而不是让异常逃出去。
 */
import type { OrgId } from "../../domain/org-id";
import type { AgentRunStore, ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";
import type { ObjectStore } from "../artifact/ports";
import type { OrgAgentModelReader } from "./trial-run-skill";
import {
  MAX_SCRIPT_ATTEMPTS,
  RUN_SCRIPT_PROTOCOL_PROMPT,
  ScriptFailedAfterRetriesError,
  SandboxTimeoutError,
  runScriptWithRetries,
} from "./run-script-with-retries";
import { SandboxUnavailableError, type SkillSandboxPort } from "./skill-sandbox-port";
import type {
  ClaimedTrialRun,
  SkillTrialRunStore,
  TrialRunArtifactRef,
  TrialRunFailureCode,
} from "./trial-run-async-ports";

/** 沙箱单次执行的 wall-clock 上限。比模型调用短得多——脚本不该跑几分钟。 */
const SCRIPT_TIMEOUT_MS = 120_000;

/**
 * 按扩展名给 mime。F979（design-delta skill-office-docs-node-runtime）新增
 * docx/xlsx/pdf 三个扩展——与 `run-skill-script.ts` 的表同形（已知重复，见该文件
 * 同名常量的注释）。
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
};

export interface ExecuteTrialRunDeps {
  readonly store: SkillTrialRunStore;
  readonly runs: Pick<AgentRunStore, "readPinnedSkills">;
  readonly model: ModelCallPort;
  readonly sandbox: SkillSandboxPort;
  readonly objects: ObjectStore;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly orgAgentModel?: OrgAgentModelReader;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
  /** 测试注入可预期的 object key 前缀。 */
  readonly objectKeyFor?: (trialRunId: string, fileName: string) => string;
  readonly maxAttempts?: number;
}

/** 内部错误载体：把「哪个码 + 什么 stderr + 跑了几次」一次性带到落库点。 */
class TerminalFailure extends Error {
  constructor(
    readonly code: TrialRunFailureCode,
    readonly stderr: string,
    readonly attempts: number,
  ) {
    super(code);
  }
}

export async function executeQueuedTrialRuns(
  deps: ExecuteTrialRunDeps,
  input: { readonly orgId: OrgId; readonly limit?: number },
): Promise<number> {
  const claimed = await deps.store.claimQueued(input.orgId, Math.min(5, input.limit ?? 3));
  for (const run of claimed) {
    await executeOne(deps, input.orgId, run);
  }
  return claimed.length;
}

async function executeOne(
  deps: ExecuteTrialRunDeps,
  orgId: OrgId,
  run: ClaimedTrialRun,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  try {
    const result = await runOnce(deps, orgId, run, startedAt);
    await deps.store.succeed({ orgId, id: run.id, ...result });
  } catch (e) {
    const failure = toTerminalFailure(e);
    deps.log("skill trial run failed", {
      trialRunId: run.id,
      versionId: run.versionId,
      code: failure.code,
      attempts: failure.attempts,
      stderrExcerpt: failure.stderr.slice(0, 500),
    });
    await deps.store.fail({
      orgId,
      id: run.id,
      code: failure.code,
      stderr: failure.stderr,
      attempts: failure.attempts,
    });
  }
}

/**
 * 把任何异常映射到一个**具体**的终态码。
 *
 * ⚠ 兜底是 `DEPENDENCY_UNAVAILABLE` 而不是"随便挑一个"：一个意外异常确实是
 *   「这条链上有个依赖出问题了」，而把它算成 `SCRIPT_FAILED_AFTER_RETRIES` 会让
 *   做 skill 的人去改一个没问题的 SKILL.md。宁可归到一个诚实的宽泛码。
 */
function toTerminalFailure(e: unknown): TerminalFailure {
  if (e instanceof TerminalFailure) return e;
  if (e instanceof SandboxUnavailableError) {
    return new TerminalFailure("SANDBOX_UNAVAILABLE", e.detail, 0);
  }
  if (e instanceof SandboxTimeoutError) {
    return new TerminalFailure("SANDBOX_TIMEOUT", "", e.attempts);
  }
  if (e instanceof ScriptFailedAfterRetriesError) {
    // ⚠ 原样带回，不加工（#660）。
    return new TerminalFailure("SCRIPT_FAILED_AFTER_RETRIES", e.lastStderr, e.attempts);
  }
  return new TerminalFailure(
    "DEPENDENCY_UNAVAILABLE",
    e instanceof Error ? e.message : "unexpected trial run failure",
    0,
  );
}

interface RunOutcome {
  readonly output: string;
  readonly durationMs: number;
  readonly tokens: number;
  readonly artifacts: readonly TrialRunArtifactRef[];
  readonly attempts: number;
}

async function runOnce(
  deps: ExecuteTrialRunDeps,
  orgId: OrgId,
  run: ClaimedTrialRun,
  startedAt: number,
): Promise<RunOutcome> {
  const now = deps.now ?? Date.now;

  /**
   * 模型解析与同步实现（`trial-run-skill.ts`）**逐字同一条规则**：先问这个组织已经
   * 证明能打通的模型，查不到才退回静态配置，两者都没有才诚实报 `MODEL_UNAVAILABLE`。
   * ⚠ 不在这里另写一套 —— 同一事实两处声明是本仓已栽过五次的坑。
   */
  const orgModel = (await deps.orgAgentModel?.findAnyPublished(orgId)) ?? null;
  const usable = orgModel !== null && orgModel.modelId !== "";
  const modelProvider = usable ? orgModel.provider : deps.modelProvider;
  const modelId = usable ? orgModel.modelId : deps.modelId;
  if (modelId === "") throw new TerminalFailure("MODEL_UNAVAILABLE", "no model configured", 0);

  const skills = await deps.runs.readPinnedSkills(orgId, [run.versionId]);
  if (skills.length !== 1) {
    throw new TerminalFailure("DEPENDENCY_UNAVAILABLE", `skill version ${run.versionId} not readable`, 0);
  }

  // skill 正文 + 执行协议。⚠ 协议段拼在**后面**：skill 自己的指令优先，
  // 我们只追加"你可以这样执行代码"这一层能力说明。
  const system = `${skills[0]!.content}\n\n---\n\n${RUN_SCRIPT_PROTOCOL_PROMPT}`;

  let tokens = 0;
  let lastReply = "";

  const loop = await runScriptWithRetries({
    sandbox: deps.sandbox,
    timeoutMs: SCRIPT_TIMEOUT_MS,
    maxAttempts: deps.maxAttempts ?? MAX_SCRIPT_ATTEMPTS,
    log: deps.log,
    generateScript: async (feedback) => {
      let completion: { readonly text: string; readonly tokens?: number };
      try {
        completion = await deps.model.complete({
          modelProvider,
          modelId,
          system,
          // 首轮是用户的样例需求；后续轮是上一次失败的真实 exitCode + stderr 回喂。
          user: feedback ?? run.sampleInput,
          // 试跑没有线程（同 `trial-run-skill.ts`：「试跑 ≠ 私聊」）。回喂靠 `user`，
          // 不靠伪造一段 history —— 那会让"这次到底喂了什么"变得不可审计。
          history: [],
        });
      } catch (e) {
        const detail = e instanceof ModelCallError ? e.detail : "unexpected model call failure";
        deps.log("skill trial run model call failed", {
          trialRunId: run.id,
          modelProvider,
          modelId,
          detail,
        });
        throw new TerminalFailure("MODEL_UNAVAILABLE", detail, 0);
      }
      tokens += Math.max(0, Math.floor(completion.tokens ?? 0));
      lastReply = completion.text;
      return completion.text;
    },
  });

  const artifacts = await storeArtifacts(deps, run.id, loop.files);

  return {
    output: lastReply,
    durationMs: Math.max(0, Math.round(now() - startedAt)),
    tokens,
    artifacts,
    attempts: loop.attempts,
  };
}

/**
 * 产物落 `ObjectStore.putOnce`（§5）。
 *
 * ⚠ **不自动落成项目产物（artifact）**：这里只 `putOnce` 到一个以 trialRunId 命名的键，
 *   并把引用挂在试跑记录上。试跑是"预演"，把文件自动塞进项目是另一件事（有自己的
 *   绑定/版本/权限语义）。用户要留下它，走既有的落地产物路径显式操作。
 *   这条边界是签核逐字确认过的。
 *
 * ⚠ 键里带 trialRunId ⇒ 天然不会撞键，`putOnce` 的 "never overwrites" 语义不会被
 *   一次重试悄悄绕过。
 */
async function storeArtifacts(
  deps: ExecuteTrialRunDeps,
  trialRunId: string,
  files: readonly { readonly name: string; readonly contentBase64: string; readonly sizeBytes: number }[],
): Promise<readonly TrialRunArtifactRef[]> {
  const refs: TrialRunArtifactRef[] = [];
  for (const file of files) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    const key = deps.objectKeyFor
      ? deps.objectKeyFor(trialRunId, file.name)
      : `skill-trial-runs/${trialRunId}/${file.name}`;
    const dot = file.name.lastIndexOf(".");
    const mime =
      (dot === -1 ? undefined : MIME_BY_EXTENSION[file.name.slice(dot).toLowerCase()]) ??
      "application/octet-stream";
    await deps.objects.putOnce(key, bytes, mime);
    refs.push({ name: file.name, mime, sizeBytes: bytes.length, objectKey: key });
  }
  return refs;
}
