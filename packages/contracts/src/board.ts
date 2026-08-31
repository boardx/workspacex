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
