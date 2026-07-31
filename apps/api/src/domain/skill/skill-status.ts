/**
 * `Skill.status` —— **四态封闭状态机**（F61；`contracts/skills/domain.md` I-1 / 裁决 O-11）。
 *
 * 最内层：不知道 HTTP、不知道 PostgreSQL、不知道 zod schema 长什么样。
 *
 * ## 为什么这四个取值写在这里，而不是从 `@repo/contracts` 派生
 *
 * 本仓的默认纪律是「契约是唯一事实源，后端不得手写第二份」。这一处是**有登记的例外**，
 * 因为两份权威材料在这个集合上**互相矛盾**，而矛盾不能靠挑一边来消解：
 *
 * | 材料 | 取值 | 自称 |
 * |---|---|---|
 * | `contracts/skills/domain.md` I-1（本 feature 的验收判据） | 草稿 / 待审核 / 已启用 / 已停用 | 「**恰四个**……封闭枚举」 |
 * | `packages/contracts/src/skills.ts` 的 `SkillStatus` | 上面四个 ＋ `被退回` | 同样按封闭枚举落 |
 * | `apps/web/lib/mock/*`（视图侧） | draft / review / enabled / disabled | 注释逐字「O-11：恰四态」 |
 *
 * 这条分歧已登记为 **`CONTRACT_DIVERGENCES.D08`**（`apps/web/lib/contract-divergences.ts`），
 * 判词是「O-11 的『恰四态』与契约五值必须有一方作废」——**那是签核人的动作，不是实现动作**。
 *
 * ⇒ 本文件按 **F61 的验收判据（domain.md I-1）** 落四态，并且**不改契约**。
 *   为了让这个选择不会变成第二份悄悄漂移的事实，`D08_UNRESOLVED` 把两侧取值都钉住，
 *   `status-enum-exactly-four.test.ts` 断言「两侧确实不同 ∧ 该分歧仍在登记簿里」——
 *   有人删掉 D08 而没有收敛两侧时，测试会红。
 *
 * ⚠ `已发布` 一词全域废弃（I-1 后半句）：它不是这四个之一，也不是别名。
 * ⚠ `已归档` **不是第五态**：它是 `status = 已停用 ∧ archived = true` 的子类（domain.md 第二节）。
 *   版本另有自己的 `SkillVersion.state`，与本文件是两个字段，不得互相推导（同节）。
 */

/**
 * 四个取值，**恰四个**。
 *
 * ⚠ 断言方式见 `coding-standards` 的既有教训：**不写 `toHaveLength(4)`**——
 *   长度相等只证明「数了四个」，证明不了「是这四个」，更证明不了
 *   「第五个进不来」。判据是**集合相等 ＋ 未声明值不被接受**，两条都要。
 */
export const SKILL_STATUSES = ["草稿", "待审核", "已启用", "已停用"] as const;

/**
 * ⚠ 类型名**刻意不叫 `SkillStatus`**。
 *
 * 同名不同义、且取值也不一致 ⇒ **改名而不是合并**，这是 `contract-divergences.ts`
 * 对第 ③ 类分歧的既定处置（视图侧同理改成了 `SkillStatusView`）。
 * 沿用 `SkillStatus` 会被 `lint-contract-source` 判成「手写了一份契约类型的副本」——
 * 而它判得对：那正是本仓九次漂移的形状。见 `CONTRACT_DIVERGENCES.D08`。
 */
export type SkillLifecycleStatus = (typeof SKILL_STATUSES)[number];

/** 运行期判定。类型守卫而不是 `as`：外来字符串必须过这道门才成为状态。 */
export function isSkillStatus(v: unknown): v is SkillLifecycleStatus {
  return typeof v === "string" && (SKILL_STATUSES as readonly string[]).includes(v);
}

/**
 * **全域废弃词**。
 *
 * 「已发布」在 skill 域里读起来像第五态，而它对应的概念在本域已被拆成两个字段
 * （`Skill.status = 已启用` 与 `SkillVersion.state = 已生效`）。留着它，
 * 下一个人会把它当同义词用，两个字段就在第一次误用时合并了。
 *
 * `status-enum-exactly-four.test.ts` 扫本域源码断言 0 命中——注释里的说明除外，
 * 否则这段解释自己会把门控点红（同 `lint-no-builtin-capabilities` 的注释豁免）。
 */
export const FORBIDDEN_STATUS_LITERALS = ["已发布"] as const;

/**
 * 归档：**已停用的终态子类**，不是状态。
 *
 * 单独给一个判定函数，是为了让「能不能归档」这件事有一个可断言的落点：
 * 归档一个 `草稿` 是数据损坏（domain.md 表格「仅当 status = 已停用 时有意义」）。
 */
export function canArchive(status: SkillLifecycleStatus): boolean {
  return status === "已停用";
}

/* ─────────────────────── 允许的状态迁移 ─────────────────────── */

/**
 * 状态机的边。**没写在这里的迁移就是不允许的迁移**——
 * 一个「默认允许、遇到坏例子再补一条禁止」的状态机等于没有状态机。
 *
 * · `草稿 → 待审核`   提交进人工门禁（`submitSkillForReview`），⚠ 需安全扫描已放行
 * · `待审核 → 已启用` **唯一**的启用入口：`reviewSkillVersion` 的 approve 分支
 * · `待审核 → 草稿`   审核打回。⚠ 见下方「被退回」注
 * · `已启用 → 已停用` 停用（前置：已列引用清单，R7）
 * · `已停用 → 已启用` 恢复（`restoreSkill`）
 *
 * ⚠ **没有 `草稿 → 已启用`**。契约 `SKILLS_FORBIDDEN_ROUTES` 逐字写着
 *   「一条直达的启用路由就是那条绕过路径本身」；这里是它在状态机上的对应物。
 *
 * ⚠ 关于 `被退回`（D08 的争点）：四态下「审核打回」落回 `草稿`，代价是
 *   **「从没提交过」与「提交被打回」在列表上不可区分**——这正是 D08 判词里
 *   契约方主张五态的理由。它是这次选择的**已知代价**，不是被忽略的问题；
 *   `rejectedToDraftLosesDistinction()` 把这个代价做成一个可断言、可被人看见的事实。
 */
const TRANSITIONS: Readonly<Record<SkillLifecycleStatus, readonly SkillLifecycleStatus[]>> = {
  草稿: ["待审核"],
  待审核: ["已启用", "草稿"],
  已启用: ["已停用"],
  已停用: ["已启用"],
};

export function allowedNextStatuses(from: SkillLifecycleStatus): readonly SkillLifecycleStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: SkillLifecycleStatus, to: SkillLifecycleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * 四态下审核打回的落点，以及它丢掉的那个区分。
 *
 * 返回 `to` 而不是直接返回字符串常量，是为了让 D08 一旦被裁成五态时，
 * 改动集中在这一个函数里，而不是散在每个写 `"草稿"` 的地方。
 */
export function rejectedToDraftLosesDistinction(): {
  readonly to: SkillLifecycleStatus;
  readonly lostDistinction: string;
} {
  return {
    to: "草稿",
    lostDistinction:
      "四态下「从未提交」与「提交被审核打回」都是 `草稿`，列表上不可区分（D08 的争点）",
  };
}

/* ─────────────────────── D08：两侧取值的机械留痕 ─────────────────────── */

/**
 * **未裁决分歧的钉子。**
 *
 * 不 import `packages/contracts` 的 `SkillStatus`：本文件是 domain 层，
 * 而这里要记的是「两侧不一致」这个**事实**，不是对某一侧的依赖。
 * 测试负责把这三行与两处**真实源文件**逐字对齐——写在这里的副本一旦过期，测试就红。
 */
export const D08_UNRESOLVED = {
  id: "D08",
  ledger: "apps/web/lib/contract-divergences.ts",
  /** `phases/phase-01-run-a-project/contracts/skills/domain.md` I-1 —— 本 feature 的验收判据 */
  domainMdValues: SKILL_STATUSES,
  /** `packages/contracts/src/skills.ts` 的 `SkillStatus`（**agent 不得修改**：ADR-020 签核过的契约只有人能改） */
  contractValues: ["草稿", "待审核", "被退回", "已启用", "已停用"] as const,
  question:
    "Skill 状态机是四态还是五态（`被退回` 是否独立成态）？O-11 的「恰四态」与契约五值必须有一方作废。",
  /** 本实现按哪一侧落，以及为什么——写在代码里，免得只活在 PR 描述里 */
  implementedSide: "domain.md（四态）：它是 F61 的验收判据；契约侧不动，等人裁",
} as const;
