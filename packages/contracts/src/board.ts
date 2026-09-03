/**
 * 契约束 `board` — 任务对象统一五态 enum（F01, phase-02-visible-outcomes）
 *
 * 权威规格：phases/phase-02-visible-outcomes/requirements/11-board/uc-11-1-四列看板与推进.md
 * R10（O-27 合法转移矩阵）。
 *
 * ## 为什么这五个值只在这里声明一次
 *
 * AGENTS.md 明确警告过「同一事实不得声明在两处」——本项目已因此漂移过五次（设计 token /
 * 字号档位 / 丢弃原因枚举 / 撤回链 SLA / 估点）。任务卡的 status 是第六个候选：
 * domain 层（`apps/api/src/domain/board/task-status.ts`）从这里 `z.infer` 派生类型，
 * 不重新声明字符串数组；未来前端需要它时，同样从这里 import，不另起一份。
 *
 * 五态：`inbox`（尚未排入看板）→ `todo` → `in_progress` → `review` → `done`。
 * 不存在第六值，不存在"视图专用"状态（例如某个看板列自己发明的展示态）——所有列都必须
 * 映射到这五个值之一，映射关系是视图层的事，不是新增一个状态。
 */
import { z } from "zod";

export const TaskStatus = z.enum(["inbox", "todo", "in_progress", "review", "done"]);

/** 五态在自然顺序里的位置（O-27「前进/回退」的判据）。inbox 最前，done 最后。 */
export const TASK_STATUSES = TaskStatus.options;

/**
 * 来源徽标（F02/F03，uc-11-1 R7「来源徽标恒为六类之一」+ R3.5「人建的卡不经 inbox …
 * 来源徽标记为手工创建」）。
 *
 * 七个值，不是六个：uc-11-1 R7 点名的六类自动汇入来源（`现场`/`会前任务`/`决策树`/
 * `报告缺料`/`转写`/`研究`，对应 F03 的六来源适配）+ R3.5 单独点名的第七类
 * `手工创建`（人手工建卡，不经 inbox，不属于六类自动来源中的任何一个）。
 * F02（本次实现范围）只会真正产生 `手工创建` 这一个取值——F03 未做，六个自动来源
 * 都还没有适配器能写入——但字段本身要能承载全部七个取值，否则 F03 落地时要改列的
 * CHECK 约束与这里的 enum，而不是只加适配器，见 F02 notes。
 */
export const SourceKind = z.enum([
  "手工创建",
  "现场",
  "会前任务",
  "决策树",
  "报告缺料",
  "转写",
  "研究",
]);
export const SOURCE_KINDS = SourceKind.options;
/** F02 范围内唯一真正产生的来源——F03 的六个自动来源适配器都还不存在。 */
export const MANUAL_SOURCE_KIND = "手工创建" as const;

/**
 * 风险等级（uc-11-2 R7 的 O-26 表产出，F03 未做）。F02/F06 只把它当一个可选的
 * 展示/筛选字段搬运——本次没有 O-26 规则表可以推导它，落库值来自建卡请求本身
 * （人工填写），**不做**任何自动推导或 override 校验（那是 F03/F09 的范围）。
 */
export const RiskLevel = z.enum(["R1", "R2", "R3"]);
export const RISK_LEVELS = RiskLevel.options;

/**
 * 「我的今天」四语义分区的 key（uc-11-5 R12 V1，字面量固定，D-29 硬约束：
 * 「不允许实现方增删或改名分区」）。
 */
export const MyTodaySectionKey = z.enum([
  "awaiting_my_judgment",
  "my_push_today",
  "ai_running_for_me",
  "waiting_on_others",
]);
export const MY_TODAY_SECTION_KEYS = MyTodaySectionKey.options;

/** 看板视图作用域——`tasks.scope` 列已在 F01 建，这里给它一个可派生的类型别名。 */
export const BoardViewScope = z.enum(["project", "global"]);
