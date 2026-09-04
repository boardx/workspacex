/*
 * UC-17.8 B4.4 —— 「用 PM 设计工作台深化」（`POST /feedback/:id/deepen`）幂等落库支撑。
 *
 * 契约：`packages/contracts/src/design-workbench.ts` 的 `deepenFeedback`。
 * 需求：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md` §B4.4。
 *
 * ## 为什么要一条新的唯一约束
 *
 * 契约头注逐字：`deepenFeedback` 的幂等键是 `feedbackId`——同一条反馈只能深化出**一个**设计
 * 项目，重复调用（手滑点两次 / 网络重试）必须命中同一个项目，不能产生第二个。B4.2 迁移
 * （`20260904150000_uc178_design_workbench.sql`）只给了 `product_feedback.resolved_by_
 * design_id` 一侧 UNIQUE（推送时才回写的那一侧），`design_projects.linked_feedback_id`
 * （创建即写入的那一侧，本操作真正用到的那一侧）当时**没有**唯一约束——B4.2/B4.3 那时候
 * 没有任何写路径会真的产生"同一条反馈对应两个 linked_feedback_id"的行，加了也测不出意义；
 * 现在 B4.4 第一次让"同一条反馈请求两次深化"成为一个会发生的输入,幂等就必须由 DB 保证,
 * 不能只靠应用层"先查一次、没查到再插入"——那两步之间有窗口（并发点两次「深化」/客户端超时
 * 重试与用户手动重试撞一起）,单靠应用层判断意味着窗口期内能插出两行。
 *
 * ## 为什么是 `(org_id, linked_feedback_id)` 部分唯一索引，不是列级 UNIQUE
 *
 * 同 `product_feedback_resolved_by_design_uniq` 反过来的形状：这里 `linked_feedback_id`
 * 大多数行是 `NULL`（首页「新建」弹窗建的项目不深化自任何反馈）——列级 UNIQUE 在 Postgres 下
 * 本就允许多个 NULL（NULL 互不相等），看起来够用，但显式加 `WHERE linked_feedback_id IS NOT
 * NULL` 的部分索引更省（不索引大多数行），且把"这条约束到底在管什么"写在索引定义本身里，
 * 不需要读代码才知道"其实允许多个 NULL"。`org_id` 前缀同 `product_feedback_resolved_by_
 * design_idx` 的既有写法——per-org 表的索引一律带 org 前缀,不单独为这条破例。
 *
 * ## 仓储侧怎么用它（本迁移只管约束本身）
 *
 * `PgDesignProjectRepository.createOrGetByLinkedFeedback` 用 `INSERT ... ON CONFLICT
 * (org_id, linked_feedback_id) WHERE linked_feedback_id IS NOT NULL DO NOTHING`：冲突时
 * 静默跳过插入，再查一次那一行返回——单条语句内完成"要么真的建了、要么复用已有的"，
 * 不是"先 SELECT 判断存不存在，不存在再 INSERT"两步（那两步之间正是上面说的窗口）。
 *
 * Replayable：`DROP ... IF EXISTS` + `CREATE ... IF NOT EXISTS`，重放安全。
 */

DROP INDEX IF EXISTS design_projects_linked_feedback_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS design_projects_linked_feedback_uniq
  ON design_projects (org_id, linked_feedback_id)
  WHERE linked_feedback_id IS NOT NULL;
