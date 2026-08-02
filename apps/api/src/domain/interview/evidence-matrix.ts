/**
 * F94 —— 主题 × 受访者证据矩阵五取值 + 从众风险(附和)不计入强度 + 唯一反例不可抹掉
 * (`uc-6-5` R3 step 4-6, AC4/AC5/E4, `packages/contracts/src/interview.ts` `EvidenceMatrix`/`EvidenceStrength`).
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * ## 这个文件必须立住的三条不变量
 *
 * 1. **五取值两两不同、且由同一次计算产出**（AC4）——`computeCellStrength` 是唯一把
 *    "这一格该显示什么" 拍板的函数；`EvidenceMatrix.cells[].counterexample` 这个布尔
 *    字段不是第二次判定，是 `strength === "counterexample"` 的只读投影
 *    （`cellToContractShape` 把两者绑在一次计算里，杜绝两处声明漂移）。
 * 2. **附和不计入强度合计**（AC5）——`tallyThemeStrength` 只数 `strong`/`weak`，
 *    `appeasement`/`not-mentioned`/`counterexample` 一律不进合计，这是从众风险
 *    （下属在上级发言后附和）"不计入证据强度" 这条业务规则的唯一落点。
 * 3. **唯一反例不可被合并/拆分/调权抹掉**（AC4/E4）——`guardCounterexamplePreservation`
 *    比较合并前后的反例格子集合，任何一个"合并前存在、合并后消失"的反例都触发
 *    `COUNTEREXAMPLE_WOULD_VANISH`；这与 `mergeThemes`/`splitThemes`/`adjustEvidenceWeight`
 *    三个契约操作共享同一个错误码，不是本文件自己发明的一个新码。
 *
 * ## 本文件刻意没有的东西
 * · **从众关系的自动识别**（"下属在上级发言后附和" 判定本身）——`domain.md` R10 标了
 *   `[待确认]`：靠关系图+发言先后自动判定还是人工确认，尚未裁决。本文件只消费
 *   "这一条已经被标为非独立证据" 这个既成事实（`isAppeasement`），不重新判定它从哪来。
 * · **矩阵的持久化与重算触发**（撤回后 ≤5 分钟重算，V8）——那是调用方（存储层 +
 *   任务系统）的职责，本文件只管"给定事实，这一格该是什么值"这一次纯计算。
 */
import { interview as C } from "@repo/contracts";
import type { z } from "zod";

export type EvidenceStrengthT = z.infer<typeof C.EvidenceStrength>;

/** 五取值集合本身，供反空转断言使用（两两不同、恰好五个）。 */
export const EVIDENCE_STRENGTH_VALUES = C.EvidenceStrength.options;

/**
 * 一个矩阵格子（某主题 × 某受访者）在**计算强度之前**的最小事实。
 *
 * ⚠ `isCounterexample` 与 `isAppeasement` 都可能与 `hasQuotes`/`rawStrength` 并存——
 *   它们是**覆盖规则**，不是"没有引述时才生效"的默认值。
 */
export interface EvidenceCellFacts {
  /** 该格是否至少有一条引述落在这个 (主题, 受访者) 组合上。 */
  readonly hasQuotes: boolean;
  /**
   * 该格是否含**唯一反例**候选（现场逐字稿已标）。优先级最高——
   * 反例即便同时也是"附和"式发言（罕见但不可假设不存在），也必须显示为反例，
   * 因为它是 `COUNTEREXAMPLE_WOULD_VANISH` 要守护的对象，不能被"附和"覆盖掉而消失。
   */
  readonly isCounterexample: boolean;
  /**
   * 该格的引述是否是"下属在上级发言后的呼应"（现场逐字稿已标「附和 · 非独立证据」，
   * UC-6.4 第 8 步）。优先级次于反例、高于强/弱——从众风险规则本身要求"落为附和
   * 而不是强/弱"，所以这里必须**覆盖**掉下面的 `rawStrength`，不是与它并列。
   */
  readonly isAppeasement: boolean;
  /** 排除反例/附和覆盖之后的原始强度；`hasQuotes === false` 时无意义（可为 null）。 */
  readonly rawStrength: "strong" | "weak" | null;
}

/**
 * computeCellStrength —— 五取值判定本身（AC4）。
 *
 * 优先级固定：反例 > 附和 > 未提及 > 原始强/弱。前两者是"覆盖"语义
 * （见 `EvidenceCellFacts` 各字段注释），后两者是"没有覆盖时"的默认判定。
 */
export function computeCellStrength(cell: EvidenceCellFacts): EvidenceStrengthT {
  if (cell.isCounterexample) return "counterexample";
  if (cell.isAppeasement) return "appeasement";
  if (!cell.hasQuotes) return "not-mentioned";
  return cell.rawStrength ?? "not-mentioned";
}

/**
 * cellToContractShape —— 把 `computeCellStrength` 的结果投影成契约的 cell 形状。
 *
 * ⚠ `counterexample: boolean` 字段**不是第二次判定**——它就是
 *   `strength === "counterexample"`，两者在这里被绑成同一次计算的两个视图，
 *   杜绝"契约里两个字段各自算一遍、后续漂移"的第六次重演（见 AGENTS.md 的五次教训）。
 */
export function cellToContractShape(
  subjectId: string,
  quoteIds: readonly string[],
  cell: EvidenceCellFacts,
): { subjectId: string; quoteIds: string[]; strength: EvidenceStrengthT; counterexample: boolean } {
  const strength = computeCellStrength(cell);
  return {
    subjectId,
    quoteIds: [...quoteIds],
    strength,
    counterexample: strength === "counterexample",
  };
}

/**
 * tallyThemeStrength —— 某主题一行的强度合计（AC5：附和不计入）。
 *
 * ⚠ `appeasement` / `not-mentioned` / `counterexample` 均不进合计——
 *   合计只回答"有多少格是独立的强/弱证据"这一件事；反例是矛盾证据，不是
 *   "强度较低的证据"，混进合计会让唯一反例在统计上被稀释掉，这正是它必须
 *   独立成一个轴而不是"弱的一种"的原因。
 */
export function tallyThemeStrength(
  cells: readonly EvidenceStrengthT[],
): { readonly strong: number; readonly weak: number } {
  let strong = 0;
  let weak = 0;
  for (const s of cells) {
    if (s === "strong") strong += 1;
    else if (s === "weak") weak += 1;
  }
  return { strong, weak };
}

/** 合并/拆分/调权前后，需要核对是否会让唯一反例消失的一个格子引用。 */
export interface CounterexampleCellRef {
  readonly themeId: string;
  readonly subjectId: string;
}

export type CounterexampleGuardResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "COUNTEREXAMPLE_WOULD_VANISH";
      /** 会消失的反例格子——供 `mergeThemes` 等操作的 `preview`/`vanishingCells` 直接复用。 */
      readonly vanishing: readonly CounterexampleCellRef[];
    };

/**
 * guardCounterexamplePreservation —— 唯一反例不可被抹掉（AC4/E4）。
 *
 * 判据是**按受访者比对**：合并/拆分/调权前，某个受访者在某主题上是反例；
 * 之后（无论主题 id 是否变化），若同一受访者在合并结果里**不再**是反例
 * （被移除、被覆盖成强/弱/附和/未提及），即视为"消失"，必须阻断。
 *
 * ⚠ 这不是"数量核对"（合并前 1 个反例、合并后还是 1 个就放行）——数量相等
 *   但换了受访者同样是"抹掉了唯一反例"，纪律第 9 条要求断言打在行为上。
 */
export function guardCounterexamplePreservation(
  before: readonly (CounterexampleCellRef & { readonly strength: EvidenceStrengthT })[],
  after: readonly (CounterexampleCellRef & { readonly strength: EvidenceStrengthT })[],
): CounterexampleGuardResult {
  const survivingSubjects = new Set(
    after.filter((c) => c.strength === "counterexample").map((c) => c.subjectId),
  );
  const vanishing = before
    .filter((c) => c.strength === "counterexample" && !survivingSubjects.has(c.subjectId))
    .map((c) => ({ themeId: c.themeId, subjectId: c.subjectId }));

  return vanishing.length === 0
    ? { ok: true }
    : { ok: false, reason: "COUNTEREXAMPLE_WOULD_VANISH", vanishing };
}
