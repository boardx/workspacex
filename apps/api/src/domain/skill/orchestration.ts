/**
 * 两级编排：**模板本体** 与 **项目实例**，以及它们之间那条**单向**的边（F63）。
 *
 * 依据：`contracts/skills/domain.md` 的 `ProjectOrchestration` 一节 ＋ I-17；
 *       UC-3.2 R3 步骤 1 / 步骤 8；AC2「改动只影响这场项目，不动后台模板本体」。
 *
 * ## 这里只有一条边，方向是**模板 → 实例**
 *
 * ```
 *   WorkflowTemplateBody ──applyTemplateToProject──▶ ProjectOrchestration
 *           ▲                                                │
 *           └──────── saveInstanceAsOrgTemplate ──────────────┘
 *                     ⚠ 产出的是**新**模板（新 id），不是回写
 * ```
 *
 * 没有第三个函数。`usecases.md` 逐字：「沉淀回组织只有 `[另存为组织模板]` 一条显式路径」。
 *
 * ## 「不回写」为什么必须是**结构性**的
 *
 * 写一条「用例里不要去写模板表」的纪律，等于没写：下一个人加一个
 * 「顺便同步回模板」的小功能时，没有任何东西会红。所以这里的落法是：
 *
 * 1. `applyTemplateToProject` **深拷贝**。实例与模板之间**不共享任何对象引用** ——
 *    共享引用时，改实例会顺着引用改到模板，这是回写最常见的形态（也最难看出来）。
 * 2. 所有编辑函数都是**纯函数**：吃一个编排，吐一个新编排，从不原地改。
 * 3. `orchestrationFingerprint()` 给「模板本体没变」一个可断言的量。
 *    `instance-override-no-writeback.test.ts` 在改实例前后各取一次，必须相等；
 *    **反向**也断言：改模板本体之后，已套用的实例指纹不变。
 *
 * ⚠ 第 3 条的反向那半句是重点。只断言正向（改实例不动模板）时，
 *   一个共享数组的实现同样是绿的 —— 因为纯函数编辑压根没碰那个数组。
 */
import type {
  BindingOwner,
  BindingTrigger,
  DeliverRole,
  SegmentBinding,
} from "./binding-slot";
import { skillRefOf } from "./binding-slot";
import type { SkillLifecycleStatus } from "./skill-status";

/** 议程环节。⚠ 宿主属 templates 束，这里只持有本束判定需要的最小形状。 */
export interface AgendaSegment {
  readonly agendaSegmentId: string;
  readonly title: string;
  readonly durationMinutes: number;
}

/**
 * 编排矩阵的一格。⚠ 角色列只有三个人类角色 —— 「全场共用」是**下发范围**，不是矩阵的一列。
 * 每个非空格 ↔ 恰一条待办（I-16）属 F64，本文件只负责把格子随模板一起复制过来。
 */
export interface RoleCell {
  readonly agendaSegmentId: string;
  readonly role: Exclude<DeliverRole, "全场共用">;
  readonly text: string;
}

/** 后台的工作流模板本体（组织级）。 */
export interface WorkflowTemplateBody {
  readonly templateId: string;
  readonly orgId: string;
  readonly name: string;
  /** 「来自后台 v2」里的那个 2。 */
  readonly version: number;
  readonly segments: readonly AgendaSegment[];
  readonly bindings: readonly SegmentBinding[];
  readonly roleCells: readonly RoleCell[];
}

/** 这场项目的实例编排。 */
export interface ProjectOrchestration {
  readonly projectId: string;
  /** 从空白搭时为 null（A2）。 */
  readonly sourceTemplateId: string | null;
  /**
   * 来源版本号。⚠ 它是**引用**不是拷贝的依据 —— 记下「当时套的是 v2」这件事，
   * 而模板此后升到 v3 与本实例无关（契约 `applyWorkflowTemplate.out` 同一句注释）。
   */
  readonly sourceTemplateVersion: number | null;
  readonly segments: readonly AgendaSegment[];
  readonly bindings: readonly SegmentBinding[];
  readonly roleCells: readonly RoleCell[];
}

/* ─────────────────────── 指纹：给「没变」一个可断言的量 ─────────────────────── */

/**
 * 编排内容的稳定指纹（domain.md I-17 断言方式里的 `contentHash`）。
 *
 * ⚠ 不用 `JSON.stringify` 直接上：对象字面量的键序会随构造顺序变，
 *   于是「内容相同」的两份会得到不同指纹，断言就退化成「构造方式相同」。
 * ⚠ 不含 `templateId` / `projectId` / `version`：指纹要回答的是
 *   **内容**变没变。把 id 混进来，`saveInstanceAsOrgTemplate` 产出的新模板
 *   与它的来源实例必然不同指纹，「另存的内容确实等于当前实例」就没法断言了。
 */
export function orchestrationFingerprint(x: {
  readonly segments: readonly AgendaSegment[];
  readonly bindings: readonly SegmentBinding[];
  readonly roleCells: readonly RoleCell[];
}): string {
  return stableStringify({
    segments: [...x.segments].sort((a, b) => a.agendaSegmentId.localeCompare(b.agendaSegmentId)),
    // ⚠ 绑定按「环节 + 槽内容」排序而**不按 bindingId**：套用会重新发 id，
    //   按 id 排序会让「同样的内容」在实例侧得到另一个指纹。
    bindings: [...x.bindings]
      .map(bindingContent)
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    roleCells: [...x.roleCells].sort((a, b) =>
      `${a.agendaSegmentId}/${a.role}`.localeCompare(`${b.agendaSegmentId}/${b.role}`),
    ),
  });
}

/** 指纹口径里的「一条绑定的内容」：不含 id、不含归属。 */
function bindingContent(b: SegmentBinding) {
  return {
    agendaSegmentId: b.agendaSegmentId,
    slot: b.slot,
    deliverRoles: [...b.deliverRoles].sort(),
    trigger: b.trigger,
  };
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/* ─────────────────────── 模板 → 实例（唯一的下行边） ─────────────────────── */

/**
 * R3 步骤 1：把模板的**环节链、绑定与三角色分工一次性写入这场项目**，并记来源版本。
 *
 * ⚠ **深拷贝**，见文件头第 1 条。返回的每一个绑定、每一格分工都是新对象；
 *   `newBindingId` 由调用方注入（用例层给序号，测试给可预期的值）——
 *   实例绑定有自己的 id，因为它此后会被独立地改、删、迁移。
 * ⚠ `originTemplateBindingId` 记住它是从哪条模板绑定来的。**这是痕迹不是通道**：
 *   全仓没有任何函数按它反向写模板（`saveInstanceAsOrgTemplate` 反而把它清成 null）。
 */
export function applyTemplateToProject(input: {
  readonly template: WorkflowTemplateBody;
  readonly projectId: string;
  readonly newBindingId: (index: number) => string;
}): ProjectOrchestration {
  const { template, projectId, newBindingId } = input;
  const owner: BindingOwner = { level: "instance", projectId };
  return {
    projectId,
    sourceTemplateId: template.templateId,
    sourceTemplateVersion: template.version,
    segments: template.segments.map((s) => ({ ...s })),
    bindings: template.bindings.map((b, i) => ({
      bindingId: newBindingId(i),
      agendaSegmentId: b.agendaSegmentId,
      owner,
      slot: { ...b.slot },
      deliverRoles: [...b.deliverRoles],
      trigger: b.trigger,
      originTemplateBindingId: b.bindingId,
    })),
    roleCells: template.roleCells.map((c) => ({ ...c })),
  };
}

/** 「来自后台 v2」那句话的**唯一**拼装处。散着拼会拼出三种写法。 */
export function sourceLabelOf(o: ProjectOrchestration): string | null {
  return o.sourceTemplateVersion === null ? null : `来自后台 v${o.sourceTemplateVersion}`;
}

/* ─────────────────────── 实例侧编辑：纯函数，不原地改 ─────────────────────── */

/**
 * 换绑 / 新增一条实例级绑定。
 *
 * 「同一环节同一槽位」的判定用 `agendaSegmentId + slot.kind + 主键` ——
 * 换绑同一个 skill 的另一个版本算**改这条**，挂一个新 skill 算**加一条**。
 */
export function withBinding(
  o: ProjectOrchestration,
  binding: SegmentBinding,
): ProjectOrchestration {
  const key = bindingKey(binding);
  const rest = o.bindings.filter((b) => bindingKey(b) !== key);
  return { ...o, bindings: [...rest, binding] };
}

export function withoutBinding(o: ProjectOrchestration, bindingId: string): ProjectOrchestration {
  return { ...o, bindings: o.bindings.filter((b) => b.bindingId !== bindingId) };
}

function bindingKey(b: SegmentBinding): string {
  const primary =
    b.slot.kind === "skill"
      ? b.slot.skillId
      : b.slot.kind === "canvas-template"
        ? b.slot.canvasTemplateId
        : `${b.slot.agentId}/${b.slot.outputKey}`;
  return `${b.agendaSegmentId}|${b.slot.kind}|${primary}`;
}

/* ─────────────────────── 实例 → 组织（唯一的上行边） ─────────────────────── */

/**
 * R3 步骤 8：`[另存为组织模板]`。
 *
 * ⚠ **产出一个新 `templateId`**，且函数签名里**根本没有原模板**这个参数 ——
 *   拿不到的东西写不了。这比「记得别去写它」强的地方在于：
 *   要让它回写，得先改签名，那是一次会被 review 看见的改动。
 * ⚠ `originTemplateBindingId` 清成 null：新模板是一份**本体**，
 *   它的绑定不再是任何模板绑定的副本。留着它会让下一次套用继承一条错误的血缘。
 *
 * ⚠ 「另存为组织模板」的**接口**唯一实现在 templates 束
 *   （契约 `SOLE_SAVE_AS_ORG_TEMPLATE_OPERATION = "templates.saveAsOrgTemplate"`）。
 *   这里是本束的**领域函数**：负责「实例编排 → 模板本体」这次形状转换与不回写不变量，
 *   不注册路由。两者不是同一件事，也没有第二份路由。
 */
export function saveInstanceAsOrgTemplate(input: {
  readonly instance: ProjectOrchestration;
  readonly orgId: string;
  readonly name: string;
  readonly newTemplateId: string;
  readonly newBindingId: (index: number) => string;
}): WorkflowTemplateBody {
  const { instance, orgId, name, newTemplateId, newBindingId } = input;
  const owner: BindingOwner = { level: "template", templateId: newTemplateId };
  return {
    templateId: newTemplateId,
    orgId,
    name,
    // 新模板从 v1 起。沿用来源模板的版本号会让「来自后台 v2」在两个模板上都成立。
    version: 1,
    segments: instance.segments.map((s) => ({ ...s })),
    bindings: instance.bindings.map((b, i) => ({
      bindingId: newBindingId(i),
      agendaSegmentId: b.agendaSegmentId,
      owner,
      slot: { ...b.slot },
      deliverRoles: [...b.deliverRoles],
      trigger: b.trigger,
      originTemplateBindingId: null,
    })),
    roleCells: instance.roleCells.map((c) => ({ ...c })),
  };
}

/* ─────────────────────── 版本快照：I-9 / D-30 ─────────────────────── */

/**
 * skill 在**此刻**的样子。它是「现在」，绑定记的是「当时」——两者不许互相推导。
 */
export interface SkillVersionCatalogEntry {
  readonly skillId: string;
  readonly status: SkillLifecycleStatus;
  /** 此刻的生效版本。⚠ 绑定**不读它**，除非引导师显式升级。 */
  readonly currentVersionId: string;
  /** 版本 → 契约正文哈希。发布后永不改变（domain.md `SkillVersion.contentHash`）。 */
  readonly contentHashByVersion: Readonly<Record<string, string>>;
}

export type SkillVersionCatalog = Readonly<Record<string, SkillVersionCatalogEntry>>;

export interface ResolvedBoundVersion {
  readonly skillId: string;
  /** 绑定里锁着的那个版本。**永远来自绑定，不来自目录**。 */
  readonly versionId: string;
  readonly contentHash: string | null;
  /** 目录里此刻的生效版本。仅用于**告诉人**有新版，不参与解析。 */
  readonly latestVersionId: string;
  /** `true` ⟺ 锁定版本 ≠ 最新版本。⚠ 这是**提示**，不是要跟随的信号。 */
  readonly behindLatest: boolean;
}

/**
 * I-9 / D-30：**用绑定锁定的版本解析，不因发新版而漂移**。
 *
 * 判据逐字：「项目 A 锁 v2 → 发布 v3 → 断言 A 解析出的契约正文仍是 v2 的 `contentHash`」。
 *
 * ⚠ 这个函数**只有一处**读 `catalog`，读的是 `contentHashByVersion[binding 锁的版本]`；
 *   `currentVersionId` 只被抄进 `latestVersionId` 用于提示。
 *   一旦有人把 `versionId` 改成取 `currentVersionId`，
 *   `binding-version-snapshot.test.ts` 的第一条就红。
 * ⚠ 非 skill 槽返回 `null`：画布模板与 agent 产物不走 skill 的版本快照
 *   （它们的版本各属 07-canvas / UC-4.2），把它们塞进同一条解析路径正是「糊成一个字符串」的后果。
 */
export function resolveBoundVersion(
  binding: SegmentBinding,
  catalog: SkillVersionCatalog,
): ResolvedBoundVersion | null {
  const ref = skillRefOf(binding);
  if (ref === null) return null;
  const entry = catalog[ref.skillId];
  return {
    skillId: ref.skillId,
    versionId: ref.versionId,
    contentHash: entry?.contentHashByVersion[ref.versionId] ?? null,
    latestVersionId: entry?.currentVersionId ?? ref.versionId,
    behindLatest: entry !== undefined && entry.currentVersionId !== ref.versionId,
  };
}

/**
 * E1：绑定的 skill 被停用/归档时的两侧口径 —— **它们不一样，所以是两个字段**。
 *
 * UC-3.2 E1 逐字：「**进行中的项目继续用它锁定的版本**；模板侧该条绑定标为
 * 『引用了已停用的 skill』，新项目套用前须处置」。
 *
 * ⇒ 实例级：`usableNow = true`（现场不能因为后台停用而当场哑掉）；
 *   模板级：`usableNow = false` ＋ 具名标记，挡住**下一次**套用。
 *   合成一个布尔会二选一地做错其中一边。
 */
export interface BindingReferenceHealth {
  /** 这条绑定此刻还能不能用。 */
  readonly usableNow: boolean;
  /** 界面上要显示的标记；健康时为 null。 */
  readonly flag: "引用了已停用的 skill" | null;
  /** 是否挡住「拿这个模板去开新项目」。 */
  readonly blocksNewApply: boolean;
}

export function referenceHealth(
  binding: SegmentBinding,
  catalog: SkillVersionCatalog,
): BindingReferenceHealth {
  const ref = skillRefOf(binding);
  if (ref === null) return { usableNow: true, flag: null, blocksNewApply: false };
  const entry = catalog[ref.skillId];
  const disabled = entry === undefined || entry.status === "已停用";
  if (!disabled) return { usableNow: true, flag: null, blocksNewApply: false };
  return {
    usableNow: binding.owner.level === "instance",
    flag: "引用了已停用的 skill",
    blocksNewApply: true,
  };
}

/**
 * 蓝本侧**显式**升级（契约 `upgradeBindingToVersion`）。
 *
 * ⚠ 纯函数，返回新绑定：**默认不自动跟随**，升级是引导师按下去的那一次。
 *   写成「解析时若有新版就用新版」会让 I-9 恒假，而那种实现在
 *   「只跑一次、没发新版」的测试里永远是绿的。
 */
export function upgradeBindingToVersion(
  binding: SegmentBinding,
  toVersionId: string,
): SegmentBinding {
  if (binding.slot.kind !== "skill") return binding;
  return { ...binding, slot: { ...binding.slot, versionId: toVersionId } };
}

/** 触发方式的实例级覆盖（R3 步骤 6）。纯函数，同样不碰模板。 */
export function withTrigger(binding: SegmentBinding, trigger: BindingTrigger): SegmentBinding {
  return { ...binding, trigger };
}
