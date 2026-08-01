/**
 * `skill` 束用例的测试替身（F61）。
 *
 * 每个替身都**记录被调用了什么**，而不只是返回一个值：F61 的几条判据是
 * 「不入库」「不进待审核队列」「写审计」——它们都是**没发生 / 发生了什么**，
 * 断言返回码证明不了。
 */
import type {
  AllOrchestrationsPort,
  ContextApiPort,
  MountHealthPort,
  OrgSkillCatalogPort,
  OrgTemplateCreatePort,
  PromoterKindPort,
  PromotionLinkStorePort,
  PromotionSkillStorePort,
  ProjectOrchestrationStorePort,
  RedactionGatePort,
  ReviewerFunctionPort,
  RoleAssigneePort,
  SatisfactionCountsPort,
  SecurityAuditPort,
  SkillDraftStorePort,
  SkillVersionStorePort,
  SkillVisibilityPort,
  SkillVisibilityScopePort,
  SourceKnowledgeLinkageStorePort,
  SubmitterGrantsPort,
  ThreadMountStorePort,
  TodoPublisherPort,
  WorkflowTemplateReadPort,
} from "../../src/application/skill/ports";
import type { ReviewerFunctionValue } from "../../src/domain/skill/review-authorization";
import type { SkillCatalogEntry, SkillCatalogPort } from "../../src/application/skill/list-skills";
import type { DeclarativeContract } from "../../src/domain/skill/declarative-contract";
import type { PromotionLink } from "../../src/domain/skill/promotion-link";
import type { SkillVersionSnapshot } from "../../src/domain/skill/version-chain";
import type {
  BindingSlotRef,
  BindingTrigger,
  DeliverRole,
  SegmentBinding,
} from "../../src/domain/skill/binding-slot";
import type {
  ProjectOrchestration,
  WorkflowTemplateBody,
} from "../../src/domain/skill/orchestration";
import type { SkillLifecycleStatus } from "../../src/domain/skill/skill-status";
import type { ThreadSkillMount } from "../../src/domain/skill/thread-mount";

export interface AuditSpy extends SecurityAuditPort {
  readonly events: { kind: string; principalId: string; detail: string }[];
}

export function collectAudit(): AuditSpy {
  const events: { kind: string; principalId: string; detail: string }[] = [];
  return {
    events,
    async record(e) {
      events.push({ kind: e.kind, principalId: e.principalId, detail: e.detail });
    },
  };
}

export interface DraftStoreSpy extends SkillDraftStorePort {
  /** ⚠ 「失败不入库」的判据就是这个数组为空 */
  readonly saved: { name: string; source: string; contract: DeclarativeContract }[];
}

export function collectDraftStore(): DraftStoreSpy {
  const saved: { name: string; source: string; contract: DeclarativeContract }[] = [];
  let n = 0;
  return {
    saved,
    async saveDraft(input) {
      saved.push({ name: input.name, source: input.source, contract: input.contract });
      n += 1;
      return { skillId: `skill-${n}`, versionId: `ver-${n}` };
    },
  };
}

export function grantsOf(...keys: string[]): SubmitterGrantsPort {
  return { async grantsOf() { return keys; } };
}

/** Context Pack 的替身：`returnedScopes` 是它**实际返回**的那一份（I-24 的右操作数）。 */
export function contextApiReturning(...returnedScopes: string[]): ContextApiPort {
  return {
    async requestContextPack() {
      return { packId: "pack-1", returnedScopes };
    },
  };
}

/* ═══════════════════ F63：绑定与两级编排的替身 ═══════════════════ */

/**
 * 模板本体的读端口替身。
 *
 * ⚠ 它持有的 `body` 是**可变**的，而且刻意暴露出去：
 *   `instance-override-no-writeback.test.ts` 要在套用之后**真的去改模板本体**
 *   （push 一条绑定 / 改一条绑定的 trigger），再断言实例纹丝不动。
 *   这条反向断言只有在替身可变时才有意义 —— 一个 deep-freeze 的替身
 *   会让「实例与模板共享同一个数组」的坏实现照样绿。
 */
export interface TemplateStoreSpy extends WorkflowTemplateReadPort {
  readonly body: { current: WorkflowTemplateBody };
  readonly loads: string[];
}

export function templateStore(initial: WorkflowTemplateBody): TemplateStoreSpy {
  const body = { current: initial };
  const loads: string[] = [];
  return {
    body,
    loads,
    async load(templateId) {
      loads.push(templateId);
      return templateId === body.current.templateId ? body.current : null;
    },
  };
}

/** 实例编排存储替身。⚠ `saves` 为空是「零写入」这条判据的落点。 */
export interface OrchestrationStoreSpy extends ProjectOrchestrationStorePort {
  readonly saves: ProjectOrchestration[];
  readonly current: { value: ProjectOrchestration | null };
}

export function orchestrationStore(initial: ProjectOrchestration | null = null): OrchestrationStoreSpy {
  const current = { value: initial };
  const saves: ProjectOrchestration[] = [];
  return {
    saves,
    current,
    async load() {
      return current.value;
    },
    async save(o) {
      saves.push(o);
      current.value = o;
    },
  };
}

/** 组织模板新建替身。⚠ `created` 里每一条都是**新**模板；没有 update 方法可用。 */
export interface OrgTemplateStoreSpy extends OrgTemplateCreatePort {
  readonly created: WorkflowTemplateBody[];
}

export function orgTemplateStore(): OrgTemplateStoreSpy {
  const created: WorkflowTemplateBody[] = [];
  return {
    created,
    async create(body) {
      created.push(body);
      return { templateId: body.templateId };
    },
  };
}

/**
 * 可绑定池替身。传入 `skillId → 状态`；**没列出来的一律返回 null**
 * （＝ 不存在或不可见，I-14 的同一个出口）。
 */
export function visibility(
  table: Readonly<Record<string, { status: SkillLifecycleStatus; currentVersionId: string }>>,
): SkillVisibilityPort {
  return {
    async visibleTo({ skillId }) {
      return table[skillId] ?? null;
    },
  };
}

/** 造一条绑定。默认是 skill 支 —— 三支各自的载荷由调用方给全。 */
export function binding(over: {
  bindingId: string;
  agendaSegmentId: string;
  owner: SegmentBinding["owner"];
  slot: BindingSlotRef;
  deliverRoles?: readonly DeliverRole[];
  trigger?: BindingTrigger;
  originTemplateBindingId?: string | null;
}): SegmentBinding {
  return {
    bindingId: over.bindingId,
    agendaSegmentId: over.agendaSegmentId,
    owner: over.owner,
    slot: over.slot,
    deliverRoles: over.deliverRoles ?? ["全场共用"],
    trigger: over.trigger ?? "默认开启",
    originTemplateBindingId: over.originTemplateBindingId ?? null,
  };
}

/** 一份最小但三支齐全的模板本体：一个环节里同时挂 skill / 画布模板 / agent 产物。 */
export function mixedSlotTemplate(templateId = "tpl-design-thinking", version = 2): WorkflowTemplateBody {
  const owner = { level: "template", templateId } as const;
  return {
    templateId,
    orgId: "org-1",
    name: "设计思维标准五步",
    version,
    segments: [
      { agendaSegmentId: "seg-02", title: "假设风暴", durationMinutes: 45 },
      { agendaSegmentId: "seg-03", title: "商业模式", durationMinutes: 60 },
    ],
    bindings: [
      binding({
        bindingId: "tb-1",
        agendaSegmentId: "seg-02",
        owner,
        slot: { kind: "skill", skillId: "sk-voice", versionId: "v2" },
        deliverRoles: ["全场共用"],
        trigger: "默认开启",
      }),
      binding({
        bindingId: "tb-2",
        agendaSegmentId: "seg-02",
        owner,
        slot: { kind: "canvas-template", canvasTemplateId: "hmw" },
        deliverRoles: ["组员"],
        trigger: "常驻",
      }),
      binding({
        bindingId: "tb-3",
        agendaSegmentId: "seg-03",
        owner,
        slot: { kind: "agent-output", agentId: "scout", outputKey: "briefing" },
        deliverRoles: ["引导师"],
        trigger: "手动触发",
      }),
    ],
    roleCells: [
      { agendaSegmentId: "seg-02", role: "引导师", text: "计时 · 提议收敛 · 看四组进度" },
      { agendaSegmentId: "seg-02", role: "组长", text: "分工 · 补必填区 · 提交本组" },
      { agendaSegmentId: "seg-02", role: "组员", text: "写 ≥1 张便签 · 投票" },
    ],
  };
}

/* ═══════════════════ F64：待办 / 挂载 / idle 清单的替身 ═══════════════════ */

/**
 * 角色→人的替身。传入 `"segId/role" → principalId` 表；未列出的一律 `null`
 * （代表「组织没配这个角色的人」，走 failed 分支，而不是让整批用例抛异常）。
 */
export function assigneeTable(
  table: Readonly<Record<string, string>>,
): RoleAssigneePort {
  return {
    async assigneeOf({ agendaSegmentId, role }) {
      const principalId = table[`${agendaSegmentId}/${role}`];
      return principalId === undefined ? null : { principalId };
    },
  };
}

export interface TodoPublisherSpy extends TodoPublisherPort {
  readonly published: Array<{
    agendaSegmentId: string;
    role: string;
    text: string;
    assigneePrincipalId: string;
    executorAgentId: string | null;
  }>;
}

/**
 * 待办发布替身。`failFor` 是一组 `"segId/role"`——命中即返回失败（不抛异常），
 * 用来断言「一条同步失败不拖垮其它格子」（E4）。
 */
export function todoPublisher(failFor: ReadonlySet<string> = new Set()): TodoPublisherSpy {
  const published: TodoPublisherSpy["published"] = [];
  let n = 0;
  return {
    published,
    async publish(input) {
      published.push({ ...input });
      if (failFor.has(`${input.agendaSegmentId}/${input.role}`)) {
        return { ok: false };
      }
      n += 1;
      return { ok: true, todoId: `todo-${n}` };
    },
  };
}

/**
 * 挂载依赖健康度替身。传入一组「不可用」的 skillId → 原因；未列出的一律可用。
 */
export function mountHealth(
  unavailable: Readonly<Record<string, string>> = {},
): MountHealthPort {
  return {
    async checkAvailability(skillId) {
      const reason = unavailable[skillId];
      return reason === undefined ? { available: true } : { available: false, reason };
    },
  };
}

/** 组织 skill 目录替身（`listIdleSkills` 用）。 */
export function orgSkillCatalog(...enabled: string[]): OrgSkillCatalogPort {
  return { async listEnabled() { return enabled; } };
}

/** 「已被绑定过的 skill」替身（`listIdleSkills` 用）。 */
export function boundSkillIds(...ids: string[]): AllOrchestrationsPort {
  return { async boundSkillIds() { return ids; } };
}

/* ═══════════════════ F65：线程临时挂载的替身 ═══════════════════ */

/**
 * 线程挂载存储替身。**按 `threadId` 分桶**——这是 I-18（只对当前线程生效）
 * 在测试替身里的落点：读写 A 线程物理上碰不到 B 线程那一桶。
 */
export interface ThreadMountStoreSpy extends ThreadMountStorePort {
  readonly savesByThread: Map<string, readonly ThreadSkillMount[]>;
}

export function threadMountStore(
  initial: Readonly<Record<string, readonly ThreadSkillMount[]>> = {},
): ThreadMountStoreSpy {
  const savesByThread = new Map<string, readonly ThreadSkillMount[]>(
    Object.entries(initial),
  );
  return {
    savesByThread,
    async load(threadId) {
      return savesByThread.get(threadId) ?? [];
    },
    async save(threadId, mounts) {
      savesByThread.set(threadId, mounts);
    },
  };
}

/* ═══════════════════ F62：双重门禁人员维度 / 四入口可见性 / 满意度 ═══════════════════ */

/** 四入口共用的目录替身。⚠ 只读整份目录，团队过滤统一在用例里做（I-14）。 */
export function skillCatalog(...entries: SkillCatalogEntry[]): SkillCatalogPort {
  return { async listAll() { return entries; } };
}

/**
 * 单个 skill 可见性范围的替身（`getSkillDetail` 的 404-not-403 判定用）。
 * 传入 `skillId → {visibility, ownerTeamId}` 表；没列出来的一律 `null`（不存在）——
 * 与 `SkillVisibilityPort`（F63）的既有替身 `visibility()` 同一个"没列出来 ⇒ null"约定。
 */
export function visibilityScopeOf(
  table: Readonly<Record<string, { visibility: "org-wide" | "team-only"; ownerTeamId: string | null }>>,
): SkillVisibilityScopePort {
  return {
    async scopeOf(skillId) {
      return table[skillId] ?? null;
    },
  };
}

/**
 * 评审职能替身（I-5/A4）。`functions` 是 `principalId → 职能` 表（未列出 ⇒ 未指派/null）；
 * `secondReviewerOrgs` 是「该 org 排除某人后仍有第二名方法论审核人」的固定答案集合——
 * 用一个显式布尔而不是真的去数人头，因为 `anotherMethodologyReviewerExists` 端口
 * 的契约就是回答布尔问题，不是回答名单（`ports.ts` 注释）。
 */
export function reviewerFunctions(
  functions: Readonly<Record<string, ReviewerFunctionValue>>,
  anotherExists: boolean,
): ReviewerFunctionPort {
  return {
    async functionOf(principalId) {
      return functions[principalId] ?? null;
    },
    async anotherMethodologyReviewerExists() {
      return anotherExists;
    },
  };
}

/** 满意度 👍/👎 计数替身。⚠ 只回计数，比值算法在 domain（`satisfaction.ts`）。 */
export function satisfactionCounts(up: number, down: number): SatisfactionCountsPort {
  return { async countsOf() { return { up, down }; } };
}

/** 一份能过静态校验的最小契约。测试里只改它要考的那一格。 */
export function validContract(over: Partial<DeclarativeContract> = {}): DeclarativeContract {
  return {
    promptTemplate: "请对 {{输入}} 做 MECE 拆解",
    inputSchema: '{"type":"object","properties":{"topic":{"type":"string"}},"required":["topic"]}',
    outputSchema: '{"type":"object","properties":{"branches":{"type":"array"}},"required":["branches"]}',
    dataScope: ["project:notes"],
    readsRawTranscript: false,
    fallbackDeclaration: "输出不合 schema 时重试一次，仍失败则返回结构化失败并提示人工接手",
    ...over,
  };
}

/* ═══════════════════ F67：晋升生成（phase-1 接收端）的替身 ═══════════════════ */

/** 晋升审批人身份替身。传入一组 AI principalId；未列出的一律视为人类。 */
export function promoterKind(aiPrincipalIds: ReadonlySet<string> = new Set()): PromoterKindPort {
  return {
    async kindOf(principalId) {
      return aiPrincipalIds.has(principalId) ? "ai" : "human";
    },
  };
}

/** 脱敏闸门替身。传入一组需要脱敏的 knowledgeItemId；未列出的一律不需要。 */
export function redactionGate(needsRedaction: ReadonlySet<string> = new Set()): RedactionGatePort {
  return {
    async requiresRedaction(knowledgeItemId) {
      return needsRedaction.has(knowledgeItemId);
    },
  };
}

export interface PromotionSkillStoreSpy extends PromotionSkillStorePort {
  readonly saved: { orgId: string; knowledgeItemId: string; contract: DeclarativeContract; source: string }[];
  /** 设为 true 时下一次 `savePendingReview` 抛错——模拟「Skill 库不可写」（E8/V11） */
  readonly failNext: { value: boolean };
}

export function promotionSkillStore(): PromotionSkillStoreSpy {
  const saved: PromotionSkillStoreSpy["saved"] = [];
  const failNext = { value: false };
  let n = 0;
  return {
    saved,
    failNext,
    async savePendingReview(input) {
      if (failNext.value) {
        failNext.value = false;
        throw new Error("simulated: skill store unwritable");
      }
      saved.push({ ...input });
      n += 1;
      return { skillId: `skill-promoted-${n}`, versionId: `ver-promoted-${n}` };
    },
  };
}

/**
 * `PromotionLink` 存储替身。**双向都能查**（I-22）：内部同时按 `skillId` 与
 * `knowledgeItemId` 建索引，`save` 一次性更新两处——避免测试替身本身先分叉成
 * 两份不同步的数据。
 */
export interface PromotionLinkStoreSpy extends PromotionLinkStorePort {
  readonly savedLinks: PromotionLink[];
}

export function promotionLinkStore(initial: readonly PromotionLink[] = []): PromotionLinkStoreSpy {
  const bySkillId = new Map<string, PromotionLink>(initial.map((l) => [l.skillId, l]));
  const savedLinks: PromotionLink[] = [];
  return {
    savedLinks,
    async save(link) {
      bySkillId.set(link.skillId, link);
      savedLinks.push(link);
    },
    async loadBySkillId(skillId) {
      return bySkillId.get(skillId) ?? null;
    },
    async loadByKnowledgeItemId(knowledgeItemId) {
      for (const link of bySkillId.values()) {
        if (link.knowledgeItemId === knowledgeItemId) return link;
      }
      return null;
    },
  };
}

/** 源知识状态联动的落库面替身：记录标注/停用调用，并持有一份「当前生效契约」表。 */
export interface SourceKnowledgeLinkageStoreSpy extends SourceKnowledgeLinkageStorePort {
  readonly annotated: string[];
  readonly disabled: string[];
}

export function sourceKnowledgeLinkageStore(
  effectiveContracts: Readonly<Record<string, DeclarativeContract>> = {},
): SourceKnowledgeLinkageStoreSpy {
  const annotated: string[] = [];
  const disabled: string[] = [];
  return {
    annotated,
    disabled,
    async annotateExpired(skillId) {
      annotated.push(skillId);
    },
    async disable(skillId) {
      disabled.push(skillId);
    },
    async currentEffectiveContract(skillId) {
      const content = effectiveContracts[skillId];
      return content === undefined ? null : { content };
    },
  };
}

/** 版本链存储替身（复用 F66 的形状），供「被替代 → 发新版」用例测试。 */
export interface SkillVersionStoreSpy extends SkillVersionStorePort {
  readonly savedHistories: Map<string, readonly SkillVersionSnapshot[]>;
}

export function skillVersionStore(
  initial: Readonly<Record<string, readonly SkillVersionSnapshot[]>> = {},
): SkillVersionStoreSpy {
  const savedHistories = new Map<string, readonly SkillVersionSnapshot[]>(Object.entries(initial));
  return {
    savedHistories,
    async loadChain(skillId) {
      return savedHistories.get(skillId) ?? [];
    },
    async saveChain(skillId, history) {
      savedHistories.set(skillId, history);
    },
  };
}
