/**
 * `createAgent`（#617，契约 `agent-runtime.ts:1387`，F55 的落地缺口）。
 *
 * ## 为什么这个用例存在
 *
 * `domain/agent/definition.ts` / `domain/agent/clone.ts` 早就把「从零新建」与
 * 「复制一个现成的」两条分支的不变量写全了（I-30 / O-22①），但从没有任何
 * `application` 层代码调用过它们——F55 的三条门控测试全部直接构造 `AgentDefinition`
 * 断言纯函数，没有一条从"一次真实调用"出发。这个文件是那条缺失的调用路径。
 *
 * ## 顺序：授权 → 社区门 → （clone 时）源存在性 → 落库
 *
 * 与 `set-agent-skill-pins.ts` / `import-skill-from-url.ts` 同一条纪律：授权必须最先，
 * 否则非 admin 能靠"社区门/AGENT_NOT_FOUND 两种响应不一样"探测组织内部信息。
 *
 * ## ⚠ 三条不变量，写在这里而不是散落在 controller/repository 里
 *
 * 1. **I-30 / O-22①**：无论 `cloneFrom` 是否为 null，落库的 `toolWhitelist` 恒为
 *    `[]`——`newAgentDefinition` / `cloneAgentDefinition` 都是这么写的，本文件只是
 *    "调用它们"而不是重新决定这件事（唯一事实源仍是 `domain/agent/clone.ts`）。
 * 2. **社区导入 phase-1 不实现**：`source: "community"` 直接拒，且**在触碰仓储之前**
 *    拒——不落库任何行，与 `createSkillDraft.ts` 对 `isCommunityEntryAvailable` 的
 *    处理同一形状。
 * 3. **`cloneFrom` 非 null 时读源、源不存在则 `AGENT_NOT_FOUND`**——复制出来的定义
 *    继承源的 `modelId`/`skillMounts`/`concurrencyLimit`/`degradePolicy`（`clone.ts`
 *    的 `CLONE_INHERITED_FIELDS`），但**不**继承 `toolWhitelist`（见①）。
 */
import {
  cloneAgentDefinition,
  newAgentDefinition,
  type NewAgentIdentity,
} from "../../domain/agent/clone";
import type { AgentDefinition, AgentSource, AgentVisibility, DegradePolicyName } from "../../domain/agent/definition";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";

export type CreateAgentErrorCode = "ROLE_INSUFFICIENT" | "AGENT_NOT_FOUND" | "AGENT_MARKET_NOT_AVAILABLE";

export class CreateAgentError extends Error {
  constructor(readonly code: CreateAgentErrorCode) {
    super(code);
    this.name = "CreateAgentError";
  }
}

export interface CreateAgentInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly name: string;
  readonly initials: string;
  readonly role: string;
  /** #1705（#728 D-1）—— 简短角色头衔，建 agent 时必填。 */
  readonly roleLabel: string;
  readonly visibility: AgentVisibility;
  /** null = 从零新建；非 null = 复制一个现成的（I-30） */
  readonly cloneFrom: string | null;
  readonly source: AgentSource;
}

/**
 * 从零新建时的缺省值——契约 `createAgent.in` 不收 `modelId`/`concurrencyLimit`/
 * `degradePolicy`（那是 `updateAgentDefinition` 的字段），一个刚新建的草稿 agent
 * 还没有人配过这些，所以给一个安全默认而不是留 undefined 硬塞进 DB。
 * `跟随组织级` / 并发 1 都是"最保守"的取值：不会绕开组织级限流，也不会一上来
 * 就允许并发跑批。
 */
const DEFAULT_CONCURRENCY_LIMIT = 1;
const DEFAULT_DEGRADE_POLICY: DegradePolicyName = "跟随组织级";

/**
 * #1918 hotfix（#1923）—— 能力图只读投影，字段特意收窄到「界面渲染能力图真正要用到的」
 * 几个：`agentId`/`name`/`roleLabel`/`skillMounts`/`toolWhitelist`。**不**要求
 * `initials`/`visibility`/`source`/`publish_state`/`concurrency_limit`/`degrade_policy`
 * 非空——那七列只在 `createAgent` 这条写路径下才必然有值，一条由
 * agent-starter-import / #662 迁移补种出来的默认 agent（如每个组织的「通用助手」）
 * 天然没有这些列，但它是一个真实存在、能力图理应读得出来的 agent。
 * 见 `pg-create-agent-repository.ts` 的 `findForCapabilityGraph`。
 */
export interface AgentCapabilityGraphRow {
  readonly agentId: string;
  readonly name: string;
  readonly roleLabel: string;
  readonly skillMounts: AgentDefinition["skillMounts"];
  readonly toolWhitelist: AgentDefinition["toolWhitelist"];
}

export interface CreateAgentRepository {
  /** clone 源的存在性 + 可继承字段读取。找不到（跨组织也算找不到）⇒ null。 */
  findForClone(orgId: string, agentId: string): Promise<AgentDefinition | null>;
  /**
   * #1918 hotfix（#1923）—— 能力图只读路径。与 `findForClone` **不是同一判据**：
   * `findForClone` 判的是「这一行能不能当克隆源」，本方法判的是「这一行存不存在」。
   * 两者不能合并，否则要么克隆功能开始尝试克隆残缺行，要么能力图对补种行永远 404。
   * 找不到（跨组织也算找不到）⇒ null。
   */
  findForCapabilityGraph(orgId: string, agentId: string): Promise<AgentCapabilityGraphRow | null>;
  /** 落库一个新 agent（从零新建或复制出的定义均可）。 */
  insert(definition: AgentDefinition, actorId: string): Promise<void>;
  newAgentId(): string;
}

export const CREATE_AGENT_REPOSITORY = Symbol("CreateAgentRepository");

export interface CreateAgentDeps {
  readonly identities: IdentityRepository;
  readonly repository: CreateAgentRepository;
}

export async function createAgent(
  input: CreateAgentInput,
  deps: CreateAgentDeps,
): Promise<AgentDefinition> {
  /* ① 授权门，必须最先——同 set-agent-skill-pins.ts 逐字同一条门槛。 */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new CreateAgentError("ROLE_INSUFFICIENT");
  }

  /* ② 社区导入 phase-1 不实现——服务端拒，不是前端置灰；不落库任何行。 */
  if (input.source === "community") {
    throw new CreateAgentError("AGENT_MARKET_NOT_AVAILABLE");
  }

  const agentId = deps.repository.newAgentId();
  const identity: NewAgentIdentity = {
    agentId,
    name: input.name,
    initials: input.initials,
    role: input.role,
    roleLabel: input.roleLabel,
    visibility: input.visibility,
  };

  let definition: AgentDefinition;
  if (input.cloneFrom !== null) {
    /* ③ 复制一个现成的：源必须存在（且同组织——`findForClone` 已按 orgId 过滤）。 */
    const source = await deps.repository.findForClone(input.orgId, input.cloneFrom);
    if (source === null) {
      throw new CreateAgentError("AGENT_NOT_FOUND");
    }
    // ⚠ `cloneAgentDefinition` 已经把 toolWhitelist 清空(I-30)——这里不再重复这件事，
    // 也绝不能在这之后"补"一次源的 toolWhitelist 回去。
    definition = cloneAgentDefinition(source, identity);
  } else {
    definition = newAgentDefinition({
      agentId,
      orgId: input.orgId,
      name: input.name,
      initials: input.initials,
      role: input.role,
      roleLabel: input.roleLabel,
      // #1705：这里落 false 而不是留 `newAgentDefinition` 缺省——从零新建的 roleLabel
      // 是 admin 刚打的真实文本，不是回填出来的占位符，两者的「待确认」语义不同。
      roleLabelNeedsConfirmation: false,
      visibility: input.visibility,
      source: input.source,
      /**
       * #660 —— 从零新建时**没有**可执行定义：`createAgent.in` 不收 `instructions`
       * （它是 `updateAgentDefinition` 的字段，同 `modelId` 一样）。落 `null` 表示
       * 「还没配」，发布时会被 `AGENT_NO_EXECUTABLE_DEFINITION` 明确拒掉。
       * ⚠ 不在这里用 `role` 兜一段出来——见 `domain/agent/self-publish.ts` 的④。
       */
      instructions: null,
      modelId: null,
      skillMounts: [],
      concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
      degradePolicy: DEFAULT_DEGRADE_POLICY,
    });
  }

  await deps.repository.insert(definition, input.actorId);
  return definition;
}
