/**
 * **来源标记自动打标**（F61；`contracts/skills/domain.md` I-11、UC-3.1 V10）。
 *
 * 一句话规格：`Skill.source` **由系统按入口写入，任何调用方无法写入或改写它**。
 * 试图写 ⇒ `SOURCE_TAG_IMMUTABLE`。
 *
 * ## 为什么它必须是「按入口」而不是「按入参」
 *
 * 来源标记是后面一整串判定的依据：`source = CC` 的内置 skill **不可删**（I-13），
 * `source = 晋升生成` 的 skill **必须有 PromotionLink 且可追回那个被签字的决策**（I-22）。
 * 一个提交人能填的字段，等于让提交人自己决定这些规则适不适用于自己。
 *
 * ## 五个取值 —— 与契约的三值分歧已登记为 D09，**不在这里选边**
 *
 * | 材料 | 取值 |
 * |---|---|
 * | `contracts/skills/domain.md`（F61 的验收判据） | CC / 自建 / 画布 / 社区 / 晋升生成 |
 * | `packages/contracts/src/skills.ts` 的 `SkillSource` | 自建 / 晋升生成 / CC（三值） |
 * | `apps/web/lib/mock/skill.ts` | self / cc / canvas / community / promoted |
 *
 * 与 `skill-status.ts` 的 D08 同样处置：按 **F61 的验收判据（domain.md）** 落，
 * 契约一个字不改（ADR-020：签核过的契约只有人能改），并用 `D09_UNRESOLVED` 钉住两侧。
 *
 * ⚠ `社区` phase-1 **只保留取值、入口置灰**（D-06 / `DECISION-Q0`：外部社区导入留 phase-2）。
 *   保留取值而不实现入口，与「契约里根本没有这个取值」是**两种不同的承诺**——
 *   前者说「将来它会长这样」，后者说「将来再说」。这是 D09 问句的一半。
 */

/** 五个来源取值（domain.md `Skill.source`）。 */
export const SKILL_SOURCES = ["CC", "自建", "画布", "社区", "晋升生成"] as const;

/**
 * ⚠ 类型名**刻意不叫 `SkillSource`** —— 同 `skill-status.ts` 的理由：
 * 同名不同义且取值不一致 ⇒ 改名而不是合并（`contract-divergences.ts` 第 ③ 类处置）。
 * 见 `CONTRACT_DIVERGENCES.D09`。
 */
export type SkillOriginTag = (typeof SKILL_SOURCES)[number];

/**
 * **入口**，不是参数。
 *
 * 每个取值对应产品里一个真实的、位置不同的动作；来源标记是这个动作的**副产品**，
 * 不是它的入参。因此这个类型出现在用例签名里的位置，永远是「调用方走的是哪条路由」，
 * 而不是「调用方说自己是谁」。
 */
export type SkillCreationEntry =
  /** 后台 `/admin/skill` 的 `[+ 新建]`（`admin-skill-add`） */
  | "admin-new"
  /** 后台 `/admin/skill` 的 `[导入]`（`admin-skill-import`），phase-1 只导入声明式契约文本 */
  | "admin-import"
  /** 随产品内置分发（Claude Code 侧） */
  | "builtin-cc"
  /** 画布里就地沉淀 */
  | "canvas"
  /** 外部社区导入。⚠ phase-1 入口置灰，见 `COMMUNITY_ENTRY_ENABLED` */
  | "community-import"
  /** 组织大脑晋升生成（UC-3.5 接收端，本 phase 只做接收） */
  | "promotion";

const ENTRY_TO_SOURCE: Readonly<Record<SkillCreationEntry, SkillOriginTag>> = {
  "admin-new": "自建",
  "admin-import": "自建",
  "builtin-cc": "CC",
  canvas: "画布",
  "community-import": "社区",
  promotion: "晋升生成",
};

/**
 * phase-1：社区导入入口**置灰**（D-06 / `DECISION-Q0` 表格「外部社区导入 → phase-2」）。
 *
 * 做成一个常量而不是删掉 `community-import`，是因为「取值在、入口关」正是本 phase 的承诺；
 * 删掉它会让 D09 的问句失去一半。
 */
export const COMMUNITY_ENTRY_ENABLED = false;

export function isCommunityEntryAvailable(entry: SkillCreationEntry): boolean {
  return entry === "community-import" ? COMMUNITY_ENTRY_ENABLED : true;
}

/**
 * 按入口打标。**系统的动作**，没有第二个参数。
 *
 * 注意签名里**没有** `requestedSource`：不是「忽略调用方的取值」，是**根本不接受**。
 * 一个接受了再忽略的参数，会在下一次重构里被人「顺手接上」。
 * 调用方是否试图提供它，由 `rejectCallerSuppliedSource` 在用例层挡下并给出失败码。
 */
export function assignSourceByEntry(entry: SkillCreationEntry): SkillOriginTag {
  return ENTRY_TO_SOURCE[entry];
}

/**
 * 调用方**携带了** `source`（新建时）或试图**改写**它（更新时）⇒ `SOURCE_TAG_IMMUTABLE`。
 *
 * 参数是 `unknown`：这条检查发生在 zod 解析之前/之外——契约的 `createSkillDraft.in`
 * 是 `.strict()` 的，本来就没有 `source` 字段，所以真实的攻击面是**未经契约解析的原始体**。
 * 只在解析后检查等于只检查了那些本来就不可能带它的请求。
 */
export function rejectCallerSuppliedSource(rawBody: unknown): {
  readonly rejected: boolean;
  readonly code: "SOURCE_TAG_IMMUTABLE" | null;
  readonly reason: string | null;
} {
  const hasSource =
    typeof rawBody === "object" &&
    rawBody !== null &&
    !Array.isArray(rawBody) &&
    Object.prototype.hasOwnProperty.call(rawBody, "source");

  return hasSource
    ? {
        rejected: true,
        code: "SOURCE_TAG_IMMUTABLE",
        reason: "来源标记由系统按入口打标，调用方不得写入或改写（I-11 / UC-3.1 V10）",
      }
    : { rejected: false, code: null, reason: null };
}

/**
 * 改写既有 skill 的来源（例：`晋升生成 → 自建`）⇒ 恒拒。
 *
 * I-11 举的正是这个例子。单独给一个函数，是因为「新建时不许带」与「更新时不许改」
 * 是两条不同的路径，只堵前者时后者依然敞着。
 */
export function rejectSourceRewrite(
  current: SkillOriginTag,
  attempted: SkillOriginTag,
): { readonly rejected: boolean; readonly code: "SOURCE_TAG_IMMUTABLE" | null; readonly reason: string | null } {
  if (current === attempted) {
    return { rejected: false, code: null, reason: null };
  }
  return {
    rejected: true,
    code: "SOURCE_TAG_IMMUTABLE",
    reason: `来源标记不可改写（${current} → ${attempted}）：它是内置不可删（I-13）与晋升可追溯（I-22）的判据`,
  };
}

/* ─────────────────────── D09：两侧取值的机械留痕 ─────────────────────── */

/** 与 `D08_UNRESOLVED` 同形、同理由。测试负责把它与两处真实源文件对齐。 */
export const D09_UNRESOLVED = {
  id: "D09",
  ledger: "apps/web/lib/contract-divergences.ts",
  domainMdValues: SKILL_SOURCES,
  contractValues: ["自建", "晋升生成", "CC"] as const,
  question:
    "来源标记是三档还是五档？`社区` 既然 phase-1 不实现，取值是先进契约（置灰）还是等实现时再加？`画布` 来源是否真实存在？",
  implementedSide: "domain.md（五档，社区入口置灰）：它是 F61 的验收判据；契约侧不动，等人裁",
} as const;
