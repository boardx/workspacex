/**
 * 契约 `skills.operations.runTrialRun`（`POST /skill-versions/:versionId/trial-run`，
 * UC-3.1 R3 步骤 4）—— 落地它面向的**模型 A**（`skills`/`skill_versions`/
 * `skill_version_files`，URL 导入 #595 与 starter-pack 导入落的那一套），
 * 不是 `skill_contracts`/`skill_contract_versions`（模型 B，F61/F62 双重门禁那一套）。
 *
 * ## 为什么是模型 A，不是模型 B——这是一次读了两边代码之后的选择，不是随手挑的
 *
 * 这条契约的错误码只有三个：`TRIAL_RUN_SCHEMA_MISMATCH` / `MODEL_UNAVAILABLE` /
 * `DEPENDENCY_UNAVAILABLE`。第一个码的名字暗示"有一份 schema 可以拿来对账"——
 * 模型 B 确实有（`input_schema`/`output_schema` 列），模型 A 完全没有（一堆任意文件）。
 * 但真栈 e2e 实测（`skill-agent-import-usecase-audit.spec.ts` ③）指向的入口是
 * `AgSkillEditor`（`asset-governance/ag-screens.tsx`）里那颗「试跑」按钮——它挂在
 * `kind==="skill"` 的**文件编辑器**上，读写路径是 `PgAssetFileRepository`，那正是
 * 模型 A。也就是说：签核材料里唯一已经画出来、且已经真的接进 `/admin/skill` 的
 * 「试跑」入口，面向的是模型 A 的技能（含 GitHub URL 导入进来的那些）；模型 B
 * 有自己独立的双重门禁流程（F62），压根没有走到这条契约。
 *
 * ⇒ 本文件把 `TRIAL_RUN_SCHEMA_MISMATCH` **永远不抛**（模型 A 没有 schema 可违反），
 *   这不是偷懒漏做——一个契约声明的错误码不要求每一种实现都必须能触发它，
 *   `trial-run-agent.ts` 的 `REQUEST_TIMEOUT`/`agentRuntime` 的先例已经是同一件事。
 *   `hitDataScope` 结构性恒为 `[]`，理由与 `TrialRunAgentResult.toolCalls`/`dataRead`
 *   恒为 `[]` 完全一致：这个字段在模型 A 上没有东西可以产生，不是没填。
 *
 * ⚠ 若未来真要给模型 B 也接一条试跑，那是**另一条用例**（另一个 versionId 空间、
 *   另一套 schema 校验），不要塞进本文件用 `try schema A then B` 猜——两边的
 *   `versionId` 生成方式不同（`sv_<uuid>` vs 声明式契约自己的 id），互不冲突，
 *   但语义混在一起会让"这次到底试跑的是哪个模型"变得不可判断。
 *
 * ## 复用 `trial-run-agent.ts` 的两段，不重新发明
 *
 * ·`AgentRunStore.readPinnedSkills` —— 按 `version_id` 读 `SKILL.md` 正文的查询只有一处。
 * · `ModelCallPort.complete` —— 全仓唯一真的会发 HTTP 请求调模型的实现。
 * 不同的是这里没有「agent 的 instructions」这一层：模型 A 的 skill 本身就是
 * 拼进 system prompt 的那一段（同 `execute-run.ts` `buildSystemPrompt` 对 skill
 * 内容的处理），trial-run 时它就是**唯一**的 system 内容。
 *
 * ## 授权：只要求组织成员，不要求 admin——这是读了契约错误码之后的结论
 *
 * 契约的 `err` 数组里没有任何角色/权限码（`agentRuntime.trialRunAgent` 那条对照组
 * 显式声明了 `ROLE_INSUFFICIENT`，这条没有）。与 `asset-directory.controller.ts`
 * 头注「读路径拒绝是裸 404」同一条纪律对齐：能读到这个 skill 版本（即通过下面
 * `readPinnedSkills` 的组织范围过滤）就能试跑它，不在这里叠一层这条契约从未
 * 声明过的门槛。真正的越权面是"读到不该读的组织数据"，那由 `withTenant` 挡。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { AgentRunStore, ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";

export type TrialRunSkillFailureCode = "MODEL_UNAVAILABLE" | "DEPENDENCY_UNAVAILABLE";

/**
 * 人类反馈（2026-08-17）：devapp 上试跑报 `MODEL_UNAVAILABLE`——三个改进方案里选的是
 * 「自愈式回退」而不是「再要求一个新的部署配置」，见
 * `infrastructure/skill/pg-org-agent-model-reader.ts` 头注的完整推理。
 * 端口放在这里（不是那个 infra 文件里）是洋葱依赖方向的硬约束：
 * `interface/` 不许直接 import `infrastructure/`（`lint-arch-deps`），
 * controller 只认这个应用层类型，DI 由 `kernel.module.ts` 接上具体实现。
 */
export interface OrgAgentModel {
  readonly provider: string;
  readonly modelId: string;
}

export interface OrgAgentModelReader {
  /** 该组织任意一个已发布 agent 的模型，取最近发布的那个；没有已发布 agent 则 `null`。 */
  findAnyPublished(orgId: string): Promise<OrgAgentModel | null>;
}

export const ORG_AGENT_MODEL_READER = Symbol("OrgAgentModelReader");

export class TrialRunSkillError extends Error {
  constructor(readonly code: TrialRunSkillFailureCode) {
    super(code);
    this.name = "TrialRunSkillError";
  }
}

export interface TrialRunSkillInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly versionId: string;
  readonly sampleInput: string;
}

export interface TrialRunSkillResult {
  readonly trialRunId: string;
  readonly versionId: string;
  readonly input: string;
  readonly output: string;
  readonly durationMs: number;
  readonly tokens: number;
  /** 结构性恒为 `[]`——见文件头。 */
  readonly hitDataScope: readonly never[];
}

export interface TrialRunSkillDeps {
  readonly identities: IdentityRepository;
  readonly runs: Pick<AgentRunStore, "readPinnedSkills">;
  readonly model: ModelCallPort;
  /** 静态兜底（`KERNEL_SKILL_TRIALRUN_MODEL_ID`）——只在 `orgAgentModel` 查不到时才用。 */
  readonly modelProvider: string;
  readonly modelId: string;
  /**
   * 自愈式回退的读口：该组织任意一个已发布 agent 正在用的模型。**可选**——不传
   * 时行为与这条回退加入之前逐字节相同（只用 `modelProvider`/`modelId` 静态配置）。
   * 见本文件下方 `OrgAgentModelReader` 头注的完整推理。
   */
  readonly orgAgentModel?: OrgAgentModelReader;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
  readonly now?: () => number;
  /** 测试注入可预期的 id；生产由调用方接 uuid。 */
  readonly trialRunIdFor?: () => string;
}

export async function trialRunSkill(
  deps: TrialRunSkillDeps,
  input: TrialRunSkillInput,
): Promise<TrialRunSkillResult> {
  /**
   * 与模型 A 其余写路径（URL 导入、starter-pack 导入）同一条门槛的**弱化版**：
   * 那两条要求 admin 是因为它们在**写**组织的 skill 目录；试跑只**读**已发布内容
   * 并临时调一次模型，不落任何库表，因此按上面文件头的推理只要求"是这个组织的成员"。
   */
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership) throw new TrialRunSkillError("DEPENDENCY_UNAVAILABLE");

  /**
   * 人类反馈（2026-08-17）：devapp 上试跑报 `MODEL_UNAVAILABLE`——不是代码 bug，
   * 是这条部署没配 `KERNEL_SKILL_TRIALRUN_MODEL_ID`。自愈式回退：先问这个组织
   * **已经证明能打通**的模型（`orgAgentModel`，见其头注），查不到（没有已发布
   * agent，或没注入这个可选依赖）才退回静态配置；两者都没有才诚实报
   * `MODEL_UNAVAILABLE`——不是让进程启动失败，与 `ConfiguredModelProvider`
   * 对未配置 provider 的处理同一条纪律（call-time 失败，不是 boot-time 崩溃）。
   *
   * ⚠ 这次读发生在授权判定**之后**——`orgAgentModel` 读的是 `input.orgId`
   *   这个已经通过成员资格校验的组织，不是调用方随便声称的值。
   */
  const orgModel = await deps.orgAgentModel?.findAnyPublished(input.orgId) ?? null;
  const modelProvider = orgModel?.provider ?? deps.modelProvider;
  const modelId = orgModel?.modelId ?? deps.modelId;
  if (modelId === "") throw new TrialRunSkillError("MODEL_UNAVAILABLE");

  const skills = await deps.runs.readPinnedSkills(input.orgId, [input.versionId]);
  if (skills.length !== 1) {
    throw new TrialRunSkillError("DEPENDENCY_UNAVAILABLE");
  }
  const system = skills[0]!.content;

  const now = deps.now ?? Date.now;
  const startedAt = now();
  let completion: { readonly text: string; readonly tokens?: number };
  try {
    completion = await deps.model.complete({
      modelProvider,
      modelId,
      system,
      user: input.sampleInput,
      // 试跑没有线程（同 `trialRunAgent`：「试跑 ≠ 私聊」），没有历史可拼。
      history: [],
    });
  } catch (e) {
    const detail = e instanceof ModelCallError ? e.detail : "unexpected model call failure";
    deps.log("skill trial run model call failed", {
      versionId: input.versionId,
      modelProvider,
      modelId,
      code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
      detail,
    });
    throw new TrialRunSkillError("MODEL_UNAVAILABLE");
  }
  const durationMs = Math.max(0, Math.round(now() - startedAt));
  const trialRunId = deps.trialRunIdFor
    ? deps.trialRunIdFor()
    : `tr_${Math.random().toString(36).slice(2)}${now()}`;

  return {
    trialRunId,
    versionId: input.versionId,
    input: input.sampleInput,
    output: completion.text,
    durationMs,
    tokens: Math.max(0, Math.floor(completion.tokens ?? 0)),
    hitDataScope: [],
  };
}
