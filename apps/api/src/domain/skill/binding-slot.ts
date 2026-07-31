/**
 * 绑定槽 —— **混合槽的可区分建模**（F63；`contracts/skills/domain.md` I-15 / UC-3.2 R3 步骤 3–6）。
 *
 * 最内层：不知道 HTTP、不知道 PostgreSQL。
 *
 * ## 这个文件要挡住的那件事
 *
 * 原型里同一个绑定槽同时显示 `模板 hmw ＋ 语音转便签`、`Scout 简报` ——
 * 三类完全不同的东西（**画布模板** / **skill** / **agent 产物**）挤在一行里。
 * 最省事的落法是一个 `binding: string`，把三者渲染成同一列文字。
 * I-15 逐字禁止这件事：
 *
 * > `SkillBinding.slotKind` 是**封闭三值枚举**，三类内容不得序列化为同一个字符串；
 * > 断言绑定行可按 `slotKind` 分别取出 skill / 画布模板 / agent 产物，
 * > 且**各自主键字段互斥非空**。
 *
 * ⇒ 本文件把「可区分」做成**类型层就成立**的事：`BindingSlotRef` 是一个
 *   discriminated union，三支的载荷字段名**完全不相交**（`skillId+versionId` /
 *   `canvasTemplateId` / `agentId+outputKey`）。要把它糊成一个字符串，得先删掉这个联合类型——
 *   那是一次显式的破坏，不是一次手滑。
 *
 * ⚠ 判据的第二半（「各自主键字段互斥非空」）不能只靠类型：入参来自 HTTP，
 *   运行期什么都可能进来。所以还有 `parseSlotRef()` 这道运行期门，
 *   越界一律 `SLOT_KIND_MISMATCH`（契约同码）。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import type { SkillErrorCode } from "./declarative-contract";

/**
 * 槽类型。**从契约派生，不重写**（ADR-020）——
 * 契约的 `SlotKind` 与 domain.md 的三值逐字相同，这里没有分歧可登记，
 * 于是也就没有理由手抄第二份。
 */
export type BindingSlotKind = z.infer<typeof skills.SlotKind>;

/** 运行期取值同样来自契约的 `.options`，而不是再写一遍数组。 */
export const BINDING_SLOT_KINDS: readonly BindingSlotKind[] = skills.SlotKind.options;

/* ─────────────────────── 下发角色与触发方式 ─────────────────────── */

/**
 * 下发角色（domain.md `SkillBinding.deliverRoles`，UC-3.2 R3 步骤 4）。
 *
 * ⚠ 「全场共用」**不是**三个角色的并集别名：原型的「语音转便签」是全场生效，
 *   而「引导师＋组长＋组员」是三条分别下发。把它折算成并集，
 *   复盘时就无法回答「这条能力是全场开的还是逐角色配的」。
 */
export const DELIVER_ROLES = ["引导师", "组长", "组员", "全场共用"] as const;
export type DeliverRole = (typeof DELIVER_ROLES)[number];

/**
 * 触发方式（UC-3.2 R3 步骤 6，对应画布左栏 `[运行]` / `[已开]` / 无按钮）。
 */
export const BINDING_TRIGGERS = ["手动触发", "默认开启", "常驻"] as const;
export type BindingTrigger = (typeof BINDING_TRIGGERS)[number];

/**
 * **未收敛的松紧差，钉在这里。**
 *
 * `deliverRoles` / `trigger` 在 domain.md 是**封闭枚举**，在
 * `packages/contracts/src/skills.ts` 的 `SkillBinding` 里却是
 * `z.array(z.string())` / `z.string()` —— 契约侧**没有类型**。
 *
 * 这不是「两侧取值不同」（那是 D08 那类分歧），而是**一侧根本没约束**：
 * 契约放行 `trigger: "随便写"`，domain.md 说恰三值。本实现按 domain.md 收紧，
 * **不改契约**（ADR-020：签核过的契约只有人能改）。
 *
 * `binding-model-distinguishable-slot.test.ts` 断言「契约侧此刻确实是松的」——
 * 有人把契约收紧成 `z.enum` 之后，这个钉子会红，提醒把这里改成派生而不是各写一份。
 */
export const CONTRACT_UNTYPED_BINDING_FIELDS = {
  fields: ["deliverRoles", "trigger"] as const,
  contractFile: "packages/contracts/src/skills.ts",
  contractShape: { deliverRoles: "z.array(z.string())", trigger: "z.string()" },
  domainMdShape: { deliverRoles: DELIVER_ROLES, trigger: BINDING_TRIGGERS },
  implementedSide: "domain.md（封闭枚举）：I-15 所在的那张表就是 F63 的验收判据",
} as const;

export function isDeliverRole(v: unknown): v is DeliverRole {
  return typeof v === "string" && (DELIVER_ROLES as readonly string[]).includes(v);
}

export function isBindingTrigger(v: unknown): v is BindingTrigger {
  return typeof v === "string" && (BINDING_TRIGGERS as readonly string[]).includes(v);
}

/* ─────────────────────── 槽内容：可区分的三支 ─────────────────────── */

/**
 * 槽里放的**那一个东西**。三支载荷字段名互不相交 —— 这就是 I-15 的「互斥非空」。
 *
 * ⚠ 刻意**没有** `label` / `display` 字段。一旦这里出现一个人类可读串，
 *   下游就会开始拿它做判断（「以『模板 』开头的是画布模板」），
 *   而那正是「序列化成同一个字符串」的复活形态。展示文案属 interface 层。
 */
export type BindingSlotRef =
  | {
      readonly kind: "skill";
      readonly skillId: string;
      /** ⚠ I-8：**必须记到版本粒度**，否则现场随发新版漂移 */
      readonly versionId: string;
    }
  | { readonly kind: "canvas-template"; readonly canvasTemplateId: string }
  | { readonly kind: "agent-output"; readonly agentId: string; readonly outputKey: string };

/**
 * 每一支**独有**的载荷字段名。
 *
 * 单独列出来，是为了让「互斥非空」成为一条**可断言的数据**，而不是一句注释：
 * 测试拿它两两求交集，非空即红。有人给 `canvas-template` 加一个 `skillId`
 * 「顺便存一下来源 skill」时，这条断言先红。
 */
const SKILL_SLOT_KEYS = ["skillId", "versionId"] as const;
const CANVAS_TEMPLATE_SLOT_KEYS = ["canvasTemplateId"] as const;
const AGENT_OUTPUT_SLOT_KEYS = ["agentId", "outputKey"] as const;

export const SLOT_PAYLOAD_KEYS = {
  // ⚠ 三支的值刻意各自具名，而不是就地写成 `skill: ["skillId", "versionId"]`：
  //   `lint-no-builtin-capabilities` 把「名字叫 `skill`/`templates`/`agents` 的字面量数组」
  //   一律判成「内置能力清单硬编码」（uc-0-5 R7）。这里是**字段名表**不是能力清单，
  //   但门控读不出这个区别 —— 而**为了绕过一条门控去改门控**是更糟的做法，
  //   所以改的是这一侧的写法。（实测过：内联写法会让 `pnpm --filter @repo/api lint` 红。）
  skill: SKILL_SLOT_KEYS,
  "canvas-template": CANVAS_TEMPLATE_SLOT_KEYS,
  "agent-output": AGENT_OUTPUT_SLOT_KEYS,
} as const satisfies Record<BindingSlotKind, readonly string[]>;

export interface SlotRefRejected {
  readonly ok: false;
  readonly code: SkillErrorCode;
  readonly reason: string;
}
export type SlotRefResult = { readonly ok: true; readonly ref: BindingSlotRef } | SlotRefRejected;

/**
 * 运行期门：把一坨外来字段变成 `BindingSlotRef`，或者拒绝。
 *
 * 三条判据，缺一条这道门就漏：
 *   ① `kind` 在封闭三值内；
 *   ② 本支的必填载荷齐全（`skill` 支缺 `versionId` ⇒ 拒，这是 I-8 在入口的落点）；
 *   ③ **不带别支的载荷字段** —— 往 skill 槽塞 `canvasTemplateId` 是
 *      `SLOT_KIND_MISMATCH`（I-15 / 契约同码），不是「多余字段忽略掉」。
 *
 * ⚠ ③ 不能省。只做 ①② 的话，`{kind:"skill", skillId, versionId, canvasTemplateId}`
 *   会被静静接受，于是一行数据同时是两类东西 —— 混合槽又糊回去了。
 */
export function parseSlotRef(raw: Readonly<Record<string, unknown>>): SlotRefResult {
  const kind = raw["kind"];
  if (!BINDING_SLOT_KINDS.includes(kind as BindingSlotKind)) {
    return {
      ok: false,
      code: "SLOT_KIND_MISMATCH",
      reason: `slotKind 必须是 ${BINDING_SLOT_KINDS.join(" | ")} 之一，收到 ${String(kind)}`,
    };
  }
  const k = kind as BindingSlotKind;

  const foreign = BINDING_SLOT_KINDS.filter((other) => other !== k).flatMap(
    (other) => SLOT_PAYLOAD_KEYS[other],
  );
  const trespass = foreign.filter((f) => raw[f] !== undefined && raw[f] !== null);
  if (trespass.length > 0) {
    return {
      ok: false,
      code: "SLOT_KIND_MISMATCH",
      reason: `${k} 槽带了别支的载荷字段 ${trespass.join(", ")}：三类内容不得共用一行（I-15）`,
    };
  }

  const missing = SLOT_PAYLOAD_KEYS[k].filter((f) => typeof raw[f] !== "string" || raw[f] === "");
  if (missing.length > 0) {
    // 用 `SLOT_KIND_MISMATCH` 而不是新造一个码：契约的 `upsertSegmentBinding.err`
    // 是封闭清单，「声明是 skill 槽但载荷不是一个 skill 引用」正是这个码的语义。
    // ⚠ `skill` 支缺 `versionId` 会走到这里 —— 这就是 I-8 在**入口**的落点：
    //   一条只记 `skillId` 的绑定连构造都构造不出来，不必等到扫描表才发现。
    return {
      ok: false,
      code: "SLOT_KIND_MISMATCH",
      reason: `${k} 槽缺必填载荷 ${missing.join(", ")}`,
    };
  }

  switch (k) {
    case "skill":
      return {
        ok: true,
        ref: { kind: "skill", skillId: raw["skillId"] as string, versionId: raw["versionId"] as string },
      };
    case "canvas-template":
      return {
        ok: true,
        ref: { kind: "canvas-template", canvasTemplateId: raw["canvasTemplateId"] as string },
      };
    case "agent-output":
      return {
        ok: true,
        ref: {
          kind: "agent-output",
          agentId: raw["agentId"] as string,
          outputKey: raw["outputKey"] as string,
        },
      };
  }
}

/* ─────────────────────── 绑定条目 ─────────────────────── */

/**
 * 绑定归属。**二者恰有其一**（契约 `SkillBinding` 的 `projectId` / `templateId` 那对
 * nullable 的类型层版本）。
 *
 * 做成联合而不是「两个可空字段」，是因为 I-17（不回写）全靠这一格判定：
 * 两个可空字段的形状里，「两个都填」和「两个都空」都是可表示的状态，
 * 而它们各自对应一次静默回写和一条无主绑定。
 */
export type BindingOwner =
  | { readonly level: "template"; readonly templateId: string }
  | { readonly level: "instance"; readonly projectId: string };

/**
 * 一条绑定条目。
 *
 * ⚠ 类型名**刻意不叫 `SkillBinding`**：那是契约里已有的名字，
 *   手写同名结构会被 `lint-contract-source` 判成「第二份副本」——而它判得对。
 *   本类型是**领域内**的形状（`slot` 是联合、`owner` 是联合、角色与触发是闭集），
 *   与契约那份扁平 DTO 是两种东西，由 interface 层负责互转。
 */
export interface SegmentBinding {
  readonly bindingId: string;
  /** ⚠ D-03a：议程环节字段名恒为 `agendaSegment*`，**禁止裸 `stage`** */
  readonly agendaSegmentId: string;
  readonly owner: BindingOwner;
  readonly slot: BindingSlotRef;
  readonly deliverRoles: readonly DeliverRole[];
  readonly trigger: BindingTrigger;
  /**
   * 这条绑定是从哪条模板级绑定复制来的（`null` ＝ 实例上手工新建的）。
   *
   * ⚠ 它是**来源痕迹**，不是一条回写通道：`applyTemplateToProject` 复制时写入，
   *   此后没有任何用例按它反向写模板。UC-3.2 R8「不回写」＋
   *   `usecases.md`「沉淀回组织只有 `[另存为组织模板]` 一条显式路径」。
   */
  readonly originTemplateBindingId: string | null;
}

/**
 * 「可按 `slotKind` 分别取出」（I-15 断言方式前半句）。
 *
 * 返回**收窄后**的类型：调用方拿到 `skill` 支就能直接读 `versionId`，
 * 不需要一次 `as`。一个需要 `as` 才能用的「可区分」不是可区分。
 */
export function bindingsOfKind<K extends BindingSlotKind>(
  bindings: readonly SegmentBinding[],
  kind: K,
): readonly (SegmentBinding & { slot: Extract<BindingSlotRef, { kind: K }> })[] {
  return bindings.filter(
    (b): b is SegmentBinding & { slot: Extract<BindingSlotRef, { kind: K }> } =>
      b.slot.kind === kind,
  );
}

/**
 * 取这条绑定的 skill 引用；**不是 skill 槽就返回 `null`**。
 *
 * 存在的意义是给「混合槽里到底有几个 skill」一个唯一答案。
 * 没有它，调用方会去读 `b.slot["skillId"]` —— 而那在别支上是 `undefined`，
 * 于是「不是 skill」与「skill 但没记版本」在下游变成同一件事（正是 I-8 要挡的）。
 */
export function skillRefOf(
  binding: SegmentBinding,
): { readonly skillId: string; readonly versionId: string } | null {
  return binding.slot.kind === "skill"
    ? { skillId: binding.slot.skillId, versionId: binding.slot.versionId }
    : null;
}

/**
 * A4：一个环节挂超过 6 个 **skill** 时提示 —— **提示不阻断**（V7，同 D-11 口径）。
 *
 * ⚠ 返回 `warnings[]` 而不是错误：把建议做成错误码，引导师会在现场被一条建议卡住。
 * ⚠ 数的是 `bindingsOfKind(..., "skill")` 而不是绑定总数 —— 画布模板与 agent 产物
 *   不占这个额度，这也是「可区分」在业务上的第一个用处。
 */
export const SKILL_PER_SEGMENT_HINT_THRESHOLD = 6;

export function bindingWarnings(bindings: readonly SegmentBinding[]): readonly string[] {
  const skillCount = bindingsOfKind(bindings, "skill").length;
  return skillCount > SKILL_PER_SEGMENT_HINT_THRESHOLD
    ? [`本环节已挂 ${skillCount} 个 skill，超过 ${SKILL_PER_SEGMENT_HINT_THRESHOLD} 个可能分散注意力（提示，不阻断）`]
    : [];
}
