/**
 * #1468 —— 议程环节 ↔ skill 绑定的存储端口（`bindSkillToSegment` / `listSegmentSkills`）。
 *
 * ## 为什么不挂在 `CanvasTemplateRepository` 上
 *
 * 那个端口的名字说的是模板注册表，它的方法也确实只读写 `canvas_templates` /
 * `canvas_template_bindings`。skill 绑定是另一张表、另一个实体（domain.md：同构但不同
 * 实体，见 `domain/canvas/segment-binding.ts` 的 `SegmentSkillBinding` 注释）。把方法塞进
 * 一个名字已经说清楚自己管什么的端口，下一个人读那个名字就会被误导——本仓对「名字与
 * 内容漂移」的处置一向是拆出去，不是改注释。
 *
 * ⚠ 但「环节属于哪个工作坊」这条查询**不重复第二份**：本端口没有 `findSegmentWorkshopId`，
 *   两个用例都复用 `CanvasTemplateRepository` 上已经存在的那一个（同
 *   `instantiate-canvases-for-segment.ts` 同时持有 templates 与 instances 两个端口的做法）。
 *   同一条 SQL 出现两处，就是同一个事实声明在两处。
 *
 * ## 出门是 `Guarded<T>`
 *
 * `listBindings` 回的是 `Guarded<SegmentSkillRow>`，ref 为 `{kind:"project", id: workshopId}`
 * ——白名单里的 `displayName` 来自 `skills` 表，是租户内容，必须经 `permission-filter`
 * 这道唯一的门。它不由 `acl_bindings` 判（议程环节没有绑定行），所以解封走
 * `discloseDecided()` + 用例自己那次 `authorize()` 的决定，同 `list-templates.ts` 对
 * capability 可见性的处置形状。
 */
import type { SegmentSkillRunMode } from "../../domain/canvas/segment-binding";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** 一行 skill 绑定 + 展示用的名字。字段名对齐契约 `listSegmentSkills.out.skills[]`。 */
export interface SegmentSkillRow {
  readonly bindingId: string;
  readonly skillKey: string;
  /**
   * `skills.name`，按 `skills.stable_name = skill_key` 关联。
   *
   * ⚠ 关联不上时是 `null`，**不是**把这一行从结果里去掉——处置写在
   *   `list-segment-skills.ts` 的文件头（契约没有「这个 skill 不存在了」这一栏，
   *   而悄悄少一行会让白名单与 `runSegmentSkill` 的绑定判据对不上）。
   */
  readonly displayName: string | null;
  readonly runMode: SegmentSkillRunMode;
  /** ISO-8601。今天恒为 `null`：写它的 `runSegmentSkill` 尚未实现（见迁移文件头）。 */
  readonly lastRunAt: string | null;
}

/** `upsertBinding` 的结果。`bindingId` 是**既有那一条**的 id（改 runMode 不换 id）。 */
export interface UpsertSegmentSkillOutcome {
  readonly bindingId: string;
  /** 这次调用是否真的插了一行新的。用于日志/断言，不进任何响应体（契约 out 只有 bindingId）。 */
  readonly created: boolean;
}

export interface CanvasSegmentSkillRepository {
  /**
   * 该议程环节现有的 skill 绑定，按 `skill_key` 稳定排序。
   *
   * ⚠ 契约 `listSegmentSkills.out` 没有排序字段，而「没有指定顺序」不等于「可以每次不同」：
   *   PostgreSQL 不保证无 `ORDER BY` 的行序，左栏第三区会在两次刷新之间跳动。
   */
  listBindings(
    orgId: OrgId,
    agendaSegmentId: string,
    workshopId: string,
  ): Promise<readonly Guarded<SegmentSkillRow>[]>;

  /**
   * 写入或改写一条绑定。
   *
   * ⚠ 一条语句完成，**不是**先查后写：并发下两次「同一环节绑同一个 skill」若各自先查
   *   再插，唯一约束会让其中一条抛 23505，而那个异常在契约里没有码可回
   *   （`bindSkillToSegment.err` 只有两个，都不是冲突）。`ON CONFLICT ... DO UPDATE`
   *   让数据库判，应用层只读结果——同 `insertSegmentBinding` 的纪律，只是这里的结论
   *   是「改这一行」而不是「拒绝」：契约 `bindSkillToSegment.err` 只有
   *   `ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE`，重复绑定必须成功，而契约里又没有
   *   解绑操作——再插一行会让白名单出现两个同名条目（domain.md「两种 runMode 不可混用」
   *   在那种数据下无从执行），拒绝则让一个绑错模式的环节永远修不回来。
   *
   * ⚠ `bindingId` **不换**：`DO UPDATE` 改的是 `run_mode`，`RETURNING id` 回的是既有那条
   *   的 id。换 id 等于先删后插，调用方手里的 `bindingId` 会在没有任何错误的情况下
   *   指向一个不存在的东西（迁移里也没有授予 DELETE，见该文件头「权限」）。
   */
  upsertBinding(cmd: {
    readonly orgId: OrgId;
    readonly bindingId: string;
    readonly agendaSegmentId: string;
    readonly workshopId: string;
    readonly skillKey: string;
    readonly runMode: SegmentSkillRunMode;
  }): Promise<UpsertSegmentSkillOutcome>;
}

export const CANVAS_SEGMENT_SKILL_REPOSITORY = Symbol("CanvasSegmentSkillRepository");
