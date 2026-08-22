/**
 * #1415 —— agent 版的 `importSkillFromUrl`（`application/skill-import/import-skill-from-url.ts`）。
 *
 * ## 为什么这不是又一份 GitHub 目录递归取回
 *
 * skill 的"内容"是一整棵可发布的文件目录（`skill_version_files`）；agent 在这一阶段
 * （`agents`/`agent_versions`，wave2 delta #417/#414）根本没有文件树的概念——它唯一的
 * "内容"字段是 `agents.instructions`，一段单一文本（`agent_versions.tool_policy` 的 DB
 * CHECK 强制工具白名单为空，印证了这一阶段的 Agent 结构上就是"一段指令 + 元数据"，
 * 见 `trial-run-agent.ts` 头注同一条结论）。⇒ 本用例只取回**单个文件**，不递归目录，
 * 不需要 `fetchGithubDirectoryFiles` 那一整套有界并发——那是为"目录里有几十个文件"
 * 这件事存在的复杂度，这里没有这件事。
 *
 * ## 复用而不是重新发明：三条既有链路的组合，不是第四条新链路
 *
 *   ① SSRF 两道门 + 取回层——直接复用 `domain/skill/import-source.ts` /
 *      `infrastructure/skill/http-import-fetcher.ts`。**读一遍这两个文件就会发现它们
 *      不含任何 skill 专属内容**（只在注释里提"skill 定义"，判定逻辑本身是纯粹的
 *      URL/地址校验）——把它们摆在 `domain/skill/` 目录下只是历史命名，不是接口耦合。
 *      为 agent 另开一份会撞 AGENTS.md「同一事实不得声明在两处」——尤其是在一条
 *      安全边界上。
 *   ② 建草稿 agent——直接复用 `application/agent/create-agent.ts` 已经测试过的
 *      `CreateAgentRepository`（`newAgentId` + `insert`），不重新拼 `INSERT INTO agents`
 *      的列清单（那份列表已经在 `pg-create-agent-repository.ts` 里，本文件不抄第二份）。
 *   ③ 写入指令——直接复用 `application/agent/set-agent-instructions.ts` 的
 *      `SetAgentInstructionsRepository`。
 *
 * 本用例真正新增的只有：URL 取回 → 校验 → 幂等记账。与
 * `AgentDefinitionCreatePanel.tsx` 现有的"创建 → 写指令"两次请求同一条纪律——
 * **非事务性**：两步之间失败会留下一个没有指令的草稿 agent，与前端面板今天
 * 已经接受的风险敞口完全相同，不是本次改动引入的新的更低标准。
 *
 * ## 导入后为什么不自动发布
 *
 * `selfPublishToollessAgent` 会把 `agent_versions` 铸成不可变快照——铸完之后再改
 * `agents.instructions` 不会反映到已发布版本里（发布是快照，不是视图）。留一步
 * 手动发布，就是留一个"先看一眼/改一改导入回来的内容，再决定要不要发布"的窗口，
 * 这正是 issue #1415 要求的"导入完还要能编辑"在这条链路上的真实落点——
 * 不是另建一套编辑器，是不去抢发布前本来就有的这个窗口。
 */
import { createHash } from "node:crypto";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";
import type { ImportUrlPolicy } from "../../domain/skill/import-source";
import { newAgentDefinition } from "../../domain/agent/clone";
import type { AgentDefinition } from "../../domain/agent/definition";
import type { CreateAgentRepository } from "../agent/create-agent";
import type { SetAgentInstructionsRepository } from "../agent/set-agent-instructions";
import type { ImportSourceFetcher } from "../skill-import/import-skill-from-url";

/** 与 skill 单文件导入同一上限（`MAX_SINGLE_FILE_BYTES`）——导入的是一段指令，不是数据集。 */
const MAX_CONTENT_BYTES = 1024 * 1024;

export type ImportAgentFromUrlErrorCode =
  | "IMPORT_NOT_ORG_ADMIN"
  | "IMPORT_CONTENT_INVALID"
  | "IMPORT_NAME_CONFLICT"
  | "IMPORT_IDEMPOTENCY_CONFLICT";

export class ImportAgentFromUrlError extends Error {
  constructor(readonly code: ImportAgentFromUrlErrorCode) {
    super(code);
    this.name = "ImportAgentFromUrlError";
  }
}

export interface ImportAgentFromUrlResult {
  readonly agentId: string;
  readonly name: string;
  readonly publishState: string;
  /** 回显落库的指令全文——见契约 `AgentUrlImportResult.instructions` 的头注。 */
  readonly instructions: string;
  readonly contentDigest: string;
  readonly replayed: boolean;
}

export interface AgentUrlImportRepository {
  /** 已用同一幂等键导入过则回放，不重复落库。 */
  findByIdempotencyKey(input: {
    readonly orgId: string;
    readonly idempotencyKey: string;
  }): Promise<ImportAgentFromUrlResult | null>;
  /** 记一行"这个幂等键对应哪个 agent"，不是 agent 内容本身的存储（见文件头）。 */
  record(input: {
    readonly orgId: string;
    readonly idempotencyKey: string;
    readonly sourceUrl: string;
    readonly contentDigest: string;
    readonly agentId: string;
    readonly actorId: string;
  }): Promise<void>;
}

export const AGENT_URL_IMPORT_REPOSITORY = Symbol("AgentUrlImportRepository");

export interface ImportAgentFromUrlDeps {
  readonly identities: IdentityRepository;
  readonly fetch: ImportSourceFetcher;
  readonly agents: CreateAgentRepository;
  readonly instructions: SetAgentInstructionsRepository;
  readonly imports: AgentUrlImportRepository;
  readonly policy: ImportUrlPolicy;
}

/**
 * DI 边界：controller 拿到的是一个**工厂**，不是现成的 deps——同
 * `import-skill-from-url.ts` 逐字同一条纪律（`policy.localOnlyOrg` 逐请求变化，
 * provider 是单例，固化 = 让一个组织的出站策略泄漏给另一个组织）。
 *
 * ⚠ 这个类型 + token 必须声明在 application 层（这里），不能挪去
 *   `infrastructure/agent-import/import-agent-from-url-composition.ts`——
 *   controller 是 interface 层，`lint-arch-deps` 不许 interface 直接 import
 *   infrastructure，装配细节必须经由 application 层的这个接口转一手，
 *   由 `kernel.module.ts` 把两头接起来。
 */
export interface ImportAgentFromUrlDepsFactory {
  (input: { readonly localOnlyOrg: boolean }): ImportAgentFromUrlDeps;
}

export const IMPORT_AGENT_FROM_URL_DEPS_FACTORY = Symbol("ImportAgentFromUrlDepsFactory");

export interface ImportAgentFromUrlInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly sourceUrl: string;
  readonly name: string;
  readonly idempotencyKey: string;
}

/**
 * `error.code === '23505'`——本仓同一判据已在四处独立声明
 * （`pg-skill-url-import-repository.ts` / `pg-skill-contract-repository.ts` /
 * `pg-artifact-repository.ts` / `application/project/advance-agenda-segment.ts`，
 * 最后一个与本文件同在 application 层），这里是第五处，不是新开先例。
 */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * 缩写角标：取显示名前两个 Unicode 码位（中文按字算，不按 UTF-16 code unit 也不按字节）。
 * `createAgent.in` 要求非空，导入路径不问用户要这个字段（用户只填一个 URL 和一个名字），
 * 所以必须能从名字派生出一个总是非空的值——空名字已经被下面的输入校验挡在更前面。
 */
function initialsFrom(name: string): string {
  const chars = Array.from(name.trim());
  return chars.length > 0 ? chars.slice(0, 2).join("") : "AI";
}

export async function importAgentFromUrl(
  input: ImportAgentFromUrlInput,
  deps: ImportAgentFromUrlDeps,
): Promise<ImportAgentFromUrlResult> {
  /**
   * ⚠⚠ 授权门，必须是这条用例做的第一件事——与 `import-skill-from-url.ts` 逐字
   *   同一条纪律，理由也相同：放在取回之前，否则非 admin 也能让服务端替他发出站
   *   请求（SSRF 探测器），即使最终不落库。
   */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new ImportAgentFromUrlError("IMPORT_NOT_ORG_ADMIN");
  }

  const replay = await deps.imports.findByIdempotencyKey({
    orgId: input.orgId,
    idempotencyKey: input.idempotencyKey,
  });
  if (replay !== null) return { ...replay, replayed: true };

  /**
   * ⚠ 故意没有 try/catch：取回层的拒绝（SSRF / 协议 / 体积 / 本地组织）必须原样
   *   冒泡到调用方，同 `import-skill-from-url.ts` 逐字同一条纪律。
   */
  const fetched = await deps.fetch(input.sourceUrl, deps.policy);
  const instructions = fetched.body.toString("utf8").trim();
  if (instructions === "" || fetched.body.length > MAX_CONTENT_BYTES) {
    throw new ImportAgentFromUrlError("IMPORT_CONTENT_INVALID");
  }
  const contentDigest = sha256(instructions);

  const agentId = deps.agents.newAgentId();
  const definition: AgentDefinition = newAgentDefinition({
    agentId,
    orgId: input.orgId,
    name: input.name,
    initials: initialsFrom(input.name),
    role: "从 GitHub 导入",
    // #1705（#728 D-1）：这条路径没有人类手填的头衔可用——`role` 本身就是一句
    // 自动生成的占位文案，`roleLabel` 同理截 8 字符派生，不编一句"看起来像人取的"
    // 短标题出来。标 `roleLabelNeedsConfirmation = true`，同 starter-pack 导入
    // （`pg-agent-starter-import-repository.ts`）那条纪律：管理员应尽快去改。
    roleLabel: "从 GitHub 导入".slice(0, 8),
    roleLabelNeedsConfirmation: true,
    /**
     * 恒 `全组织可用`——`checkToollessSelfPublish` 只放行这一档可见性
     * （`仅某组` 没有"哪个组"的出处，`createAgent.in` 也不收 team）。导入路径的
     * 唯一目的就是让这个 agent 能走到"自助发布"那一步，选一档发布不了的可见性
     * 没有意义。
     */
    visibility: "全组织可用",
    source: "self",
    // 从零新建时没有可执行定义（同 `create-agent.ts` 的既有纪律）——本用例
    // 建完之后立刻用 `deps.instructions.setInstructions` 补上，不在这里塞值。
    instructions: null,
    modelId: null,
    skillMounts: [],
    concurrencyLimit: 1,
    degradePolicy: "跟随组织级",
  });

  try {
    await deps.agents.insert(definition, input.actorId);
  } catch (error) {
    // `agents_name_casefold_uniq`（org_id, lower(name)）撞了：同组织已有同名 agent。
    if (isUniqueViolation(error)) throw new ImportAgentFromUrlError("IMPORT_NAME_CONFLICT");
    throw error;
  }

  const wrote = await deps.instructions.setInstructions({
    orgId: input.orgId,
    agentId,
    instructions,
  });
  // agent 刚被本函数插入，找不到就是仓储实现出了问题，不是一个可预期的用户错误——
  // 不吞掉、不翻成某个 ImportAgentFromUrlError 码，让它作为裸异常冒泡以便被看见。
  if (!wrote) throw new Error("import_agent_from_url: agent vanished right after insert");

  try {
    await deps.imports.record({
      orgId: input.orgId,
      idempotencyKey: input.idempotencyKey,
      sourceUrl: fetched.url,
      contentDigest,
      agentId,
      actorId: input.actorId,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ImportAgentFromUrlError("IMPORT_IDEMPOTENCY_CONFLICT");
    throw error;
  }

  return { agentId, name: input.name, publishState: "草稿", instructions, contentDigest, replayed: false };
}
