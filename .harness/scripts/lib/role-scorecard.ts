/**
 * role-scorecard.ts —— 角色记分卡：让每个 agent 一眼看到「我的目标 / 我的 blocker /
 * 我在等谁 / 我的下一个动作」。
 *
 * 人类 2026-08-12 指令："让 main、domain agent、subagent 很清楚当前他们的目标是什么、
 * blocker 是什么、需要谁的帮忙，一眼可以看到；同时需要有一个验收标准，每个人都知道
 * 自己的现状分数、目标分数是什么"。
 *
 * ## ⚠ 这里**一个判据都不定义**——它只是既有事实的**角色投影**
 *
 * 本仓已经有四套尺子（CLR 的 R/B + `chat-main-fidelity-rubric` 的 D/P），
 * 而 `chat-ux-acceptance-criteria.md` 自己就逐字禁止合并评分卡。本仓也已九次栽在
 * 「同一事实声明在两处」。所以本文件**不新增第五套**，它做的是别人做不到的另一件事：
 *
 *   既有的盘面回答「**产品**离交付差多少」（`readiness`）、「**全局**在发生什么」
 *   （`dashboard`）、「活怎么分」（`board` / `task-assignment`）——
 *   **没有任何一层回答「**我这个角色**现在几分、还差什么、卡在谁身上」。**
 *
 * 实测：`grep -rln "目标分\|现状分数\|target score" .harness/instructions .harness/rubrics`
 * 在 2026-08-12 的 main 上**零命中**。这就是本文件补的那一格。
 *
 * ## 三层分工（与 CLR 同构，刻意抄它的形状）
 *
 * | 层 | 放什么 | 谁写 |
 * |---|---|---|
 * | **判据** | 各 rubric 自己的维度定义 | 人类 / 评分卡作者 |
 * | **现状分** | `core-loop-readiness.json` 等既有 state | 该 track 的授权评分人 |
 * | **目标分 + 归属** | `role-charter.json`（**只有目标，没有现状**） | 人类 / coord-main |
 * | **记分卡** | `pnpm harness scorecard` 输出 | **脚本派生，禁止手写** |
 *
 * ## 为什么「目标分」和「现状分」必须分开放
 *
 * 目标分是**决策**（人类/coord 说了算），现状分是**测量**（脚本说了算）。
 * 混在一起，角色就能通过下调自己的目标来"达标"——那这套 eval 当场失去意义。
 * 所以 `role-charter.json` 里**只准出现 target，不准出现任何现状字段**，由 S3 门机械挡住。
 *
 * ⚠ 诚实标注：这条分离是**本次引入的设计决定**，不是从既有文档推导出来的。
 * 要改，改这里，不要在别处再写一份。
 */

/** 角色对某一条可评项的负责声明。`target` 是**决策**，不是测量。 */
export interface OwnedItem {
  /** 目前只有 `clr_track` 一种来源。新增来源时在这里扩，不要另起一份 charter。 */
  readonly kind: "clr_track";
  /** 在其 authority 里的 id，例如 CLR 的 `R` / `B` / `V-D` / `V-P`。 */
  readonly id: string;
  /** 目标分。人类 / coord-main 决定。 */
  readonly target: number;
  /**
   * 这个目标分**是谁定的**。coord-main 2026-08-12 裁决：不许空着。
   *
   * 目标分是决策，而决策必须可追溯到**做决定的那个人**——否则半年后没人知道
   * 「9 分」是人类拍的板还是某个 agent 顺手写的，也就无从推翻。
   * 本仓已有同型教训：#823 的过期注释、#660 的误关，都是"当时有理由、事后无出处"。
   *
   * 约定取值形如：
   *   · `人类裁决 #831`               —— 人类拍板，agent 不得改
   *   · `coord-main 代裁（可推翻）`    —— 全权授权期内 coord 先定，人类醒后可推翻
   */
  readonly target_source: string;
}

export interface RoleCharter {
  readonly mission: string;
  readonly owns: readonly OwnedItem[];
}

export interface CharterFile {
  readonly version: number;
  readonly roles: Readonly<Record<string, RoleCharter>>;
}

/**
 * charter 里**绝不允许**出现的字段名——它们都属于「现状」，现状只能派生。
 *
 * 这不是风格洁癖：`core-loop-readiness.json` 已经是现状的单一事实源，
 * charter 里再写一个 `score`，两处就会漂移，而漂移永远是往「看起来达标」的方向。
 */
export const FORBIDDEN_CHARTER_FIELDS = [
  "score", "current", "current_score", "scored_sha", "scored_by", "evidence", "effective",
] as const;

export type CharterViolation =
  | { readonly code: "UNKNOWN_ROLE"; readonly role: string }
  | { readonly code: "NO_OWNED_ITEMS"; readonly role: string }
  | { readonly code: "CURRENT_SCORE_IN_CHARTER"; readonly role: string; readonly field: string }
  | { readonly code: "TARGET_OUT_OF_RANGE"; readonly role: string; readonly item: string }
  | { readonly code: "UNKNOWN_ITEM"; readonly role: string; readonly item: string }
  | {
      readonly code: "TARGET_DRIFTS_FROM_AUTHORITY";
      readonly role: string; readonly item: string;
      readonly charter: number; readonly authority: number;
    }
  | { readonly code: "TARGET_SOURCE_MISSING"; readonly role: string; readonly item: string };

/**
 * 四道门（沿用 CLR G1-G6 的形状，每道在 `.test.ts` 里都配反证）：
 *
 *   S1 未声明 owns ⇒ 该角色不可评（**不是**默认满分——空着不等于达标）
 *   S2 charter 里的角色必须是**真实存在的身份**——`registry.yaml`（coordinator/reviewer，
 *      需授权凭据）**或** `.harness/agents/*.yaml`（便携 subagent）。两者并集，不是 registry 一家
 *   S3 charter 里出现任何「现状」字段 ⇒ 判红（防第二事实源）
 *   S4 owns 指向的 item 必须真的存在于其 authority（防指向虚空）
 *   S5 target 必须在 [0, max]（一个永远达不到的目标 = 门废掉）
 *   S6 `clr_track` 的 target 必须**逐字等于** CLR 自己的 `PASS_THRESHOLD`
 *
 * ## S6 为什么存在——它是「允许重复，但机械钉死」的那种重复
 *
 * 合格门槛 9 是人类 2026-08-09 的裁决（#831），单一事实源是
 * `core-loop-readiness.ts` 的 `PASS_THRESHOLD`。charter 里再写一个 9，**本身就是
 * 第二份副本**——本仓已五次因此漂移。但目标分又必须**看得见**（人类的原话是
 * "每个人都知道自己的目标分数是什么"），藏进代码常量就不叫"一眼可以看到"。
 *
 * 解法不是二选一，而是：**允许它出现在 charter 里，但用 S6 把两处钉死**。
 * 人类把门槛改成 8 而 charter 还写 9 ⇒ 当场判红，不会安静地漂。
 */
export function validateCharter(
  charter: CharterFile,
  knownRoleIds: ReadonlySet<string>,
  knownItems: ReadonlyMap<string, number>,
  clrPassThreshold: number,
): CharterViolation[] {
  const violations: CharterViolation[] = [];

  for (const [role, spec] of Object.entries(charter.roles)) {
    if (!knownRoleIds.has(role)) violations.push({ code: "UNKNOWN_ROLE", role });

    for (const field of FORBIDDEN_CHARTER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(spec, field)) {
        violations.push({ code: "CURRENT_SCORE_IN_CHARTER", role, field });
      }
    }

    if (!spec.owns || spec.owns.length === 0) {
      violations.push({ code: "NO_OWNED_ITEMS", role });
      continue;
    }

    for (const item of spec.owns) {
      for (const field of FORBIDDEN_CHARTER_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(item, field)) {
          violations.push({ code: "CURRENT_SCORE_IN_CHARTER", role, field });
        }
      }
      const max = knownItems.get(item.id);
      if (max === undefined) {
        violations.push({ code: "UNKNOWN_ITEM", role, item: item.id });
        continue;
      }
      if (item.target < 0 || item.target > max) {
        violations.push({ code: "TARGET_OUT_OF_RANGE", role, item: item.id });
      }
      // S7（coord-main 2026-08-12 裁决）：目标分必须写明出处，空着判红。
      if (typeof item.target_source !== "string" || item.target_source.trim() === "") {
        violations.push({ code: "TARGET_SOURCE_MISSING", role, item: item.id });
      }
      if (item.kind === "clr_track" && item.target !== clrPassThreshold) {
        violations.push({
          code: "TARGET_DRIFTS_FROM_AUTHORITY",
          role, item: item.id, charter: item.target, authority: clrPassThreshold,
        });
      }
    }
  }

  return violations;
}

/** 一条可评项在某角色视角下的现状。`current` **全部来自既有 state**，本文件不产生分数。 */
export interface ItemStatus {
  readonly id: string;
  readonly name: string;
  readonly current: number;
  readonly target: number;
  /** `max(0, target - current)`。0 表示这一项已达标。 */
  readonly gap: number;
  /** 该项被既有门扣分的原因（原样透传，不重新解释）。 */
  readonly discounts: readonly string[];
  readonly blockingIssues: readonly number[];
}

/**
 * 现状分从哪里来：**既有 track 判定后的 `effectiveScore`**，不是记录里的原始分。
 *
 * 这一条很关键——用 `effectiveScore` 意味着 CLR 的 G1-G6（未评分/过期/自评/无证据/
 * 血统/证据不可解析）**自动继承过来**，本文件一行都不用重复实现，也就不可能与它漂移。
 */
export interface TrackVerdictLike {
  readonly id: string;
  readonly name: string;
  readonly effectiveScore: number;
  readonly discounts: readonly string[];
  readonly blockingIssues: readonly number[];
}

export interface RoleScorecard {
  readonly role: string;
  /** 来自 `registry.yaml`：coordinator / module-coordinator / worker …… */
  readonly kind: string;
  readonly reportsTo: string | null;
  readonly mission: string;
  readonly items: readonly ItemStatus[];
  /** 所有 gap 之和。0 = 该角色名下全部达标。 */
  readonly totalGap: number;
  readonly met: boolean;
}

export function buildScorecard(
  role: string,
  spec: RoleCharter,
  identity: { readonly kind: string; readonly reportsTo: string | null },
  verdicts: ReadonlyMap<string, TrackVerdictLike>,
): RoleScorecard {
  const items: ItemStatus[] = [];

  for (const owned of spec.owns) {
    const v = verdicts.get(owned.id);
    // 查不到判定 ⇒ current 记 0，而**不是**跳过。同 CLR 的 G1：空着不等于满分。
    const current = v?.effectiveScore ?? 0;
    items.push({
      id: owned.id,
      name: v?.name ?? owned.id,
      current,
      target: owned.target,
      gap: Math.max(0, owned.target - current),
      discounts: v?.discounts ?? ["NO_SUCH_ITEM"],
      blockingIssues: v?.blockingIssues ?? [],
    });
  }

  const totalGap = items.reduce((sum, i) => sum + i.gap, 0);
  return {
    role,
    kind: identity.kind,
    reportsTo: identity.reportsTo,
    mission: spec.mission,
    items,
    totalGap,
    met: totalGap === 0,
  };
}

/** 「我在等谁」的四种答案。`unknown` 是**离线**时的诚实回答，不是一种猜测。 */
export type WaitingOn =
  | { readonly issue: number; readonly on: "human"; readonly title: string }
  | { readonly issue: number; readonly on: "role"; readonly who: string; readonly title: string }
  | { readonly issue: number; readonly on: "unowned"; readonly title: string }
  | { readonly issue: number; readonly on: "closed"; readonly title: string }
  | { readonly issue: number; readonly on: "unknown"; readonly why: string };

export interface IssueMeta {
  readonly state: string;
  readonly title: string;
  readonly labels: readonly string[];
}

/**
 * 「需人类」的判别依据。**只认显式信号**，不做语义猜测——
 * 猜出来的归属比没有归属更糟（本仓 #823 已有先例：把已关闭的 issue 留在队列顶部，
 * 让 agent 去做已经做完的事）。
 */
const HUMAN_MARKERS = ["🔒", "需人类", "待人类", "待签核", "blocked-on-human", "需签核"];

export function classifyBlockers(
  issues: readonly number[],
  meta: ReadonlyMap<number, IssueMeta> | null,
): WaitingOn[] {
  return issues.map((issue) => {
    // meta === null ⇒ 查不到（离线 / 无 gh token）。**照实说不知道**，不判断，
    // 同 `core-loop-readiness-doctor.ts` 对「问不到 issue 状态」的处理：
    // 把「问不到」当成「有问题」会让离线环境恒红，那是空转不是门控。
    if (meta === null) return { issue, on: "unknown", why: "issue 状态查不到（离线或无 gh）" };
    const m = meta.get(issue);
    if (!m) return { issue, on: "unknown", why: "issue 不存在或无权读取" };
    if (m.state.toUpperCase() === "CLOSED") return { issue, on: "closed", title: m.title };

    if (HUMAN_MARKERS.some((k) => m.title.includes(k) || m.labels.some((l) => l.includes(k)))) {
      return { issue, on: "human", title: m.title };
    }
    const owner = m.labels.find((l) => l.startsWith("owner:"));
    if (owner) return { issue, on: "role", who: owner.slice("owner:".length), title: m.title };
    return { issue, on: "unowned", title: m.title };
  });
}

/**
 * 「我的下一个动作」——从统一队列里挑出**属于我**的第一条。
 *
 * 刻意返回队列里的第一条而不是"最容易的一条"：队列顺序本身已经是优先级
 * （CLR 的排序规则：天花板 track 的阻塞项永远在最前）。再排一次序等于第二套优先级。
 */
export function nextActionFor(
  queue: readonly number[],
  mine: ReadonlySet<number>,
): number | null {
  return queue.find((n) => mine.has(n)) ?? null;
}
