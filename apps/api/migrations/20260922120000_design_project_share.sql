/*
 * 迭代 22 —— 设计项目的**发布与分享**：一条免登录的只读链接。
 *
 * 契约：`design-workbench.ts` 的 `DesignShare` / `SharedDesign` / `publishProject` /
 * `unpublishProject` / `getSharedDesign`。
 *
 * ## 为什么存的是**快照**，而不是一条指向当前画布的活链接
 *
 * 因为这个代码库自己的事实：原型是**分页渐进落库**的（`append-project-chat.ts` 的
 * `persistProgress` 每画完一页就写一次 `design_projects`）。活链接意味着评审在你重新
 * 生成的那三十秒里刷新一下，看到的是三页空白加一页画到一半的稿。发布 = 冻结这一刻。
 *
 * ## 为什么不复用 `design_project_prototype_versions` 那张快照表
 *
 * 那张表是 append-only 的**历史**，每次写回涨一行，且渐进写入**根本不记版本**
 * （`persistProgress` 调 `update` 时不传 version meta）——所以"最新版本"在生成过程中
 * 并不等于画布上这一份，拿一条外键指过去会指到一个不是用户按下发布时看到的东西。
 * `share_snapshot` 存的是**这次发布对外承诺了什么**，与"历史上有过哪些版本"是两件事，
 * 不是同一份事实的第二份副本。
 *
 * ## 令牌明文存，不存 hash
 *
 * 与会话令牌不同：owner 回到项目页要能**再复制一次这条链接**。存 hash 意味着链接只在
 * 生成的那一屏存在过，关掉就再也拿不回来——而用户对"分享链接"的预期恰恰相反。
 * 形状逐字照搬 `survey-service.ts` 的公开问卷令牌（`<locator>.<secret>`，locator 是
 * base64url 的 `[org_id, id]` 只用来路由，256 位 secret 在返回任何内容之前定时安全比较）。
 * 同一个问题在一个仓库里只该有一种解法。
 *
 * ## 取消发布 = 令牌置空，不是加一个 `share_revoked` 标志
 *
 * 留着旧令牌再挂一个"已撤销"标志，等于让"收回链接"这件事依赖每条读路径都记得看那个标志；
 * 而这些列里唯一能让链接失效的事实就是**没有令牌**。少一个可以忘记检查的东西。
 *
 * Replayable：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS，重放安全。
 */
ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS share_token text,
  ADD COLUMN IF NOT EXISTS share_scope text NOT NULL DEFAULT 'prototype'
    CHECK (share_scope IN ('prototype', 'full')),
  ADD COLUMN IF NOT EXISTS share_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_snapshot jsonb;

/*
 * 全局唯一：令牌自带 org 定位符，但唯一性不该只靠"生成的时候随机数没撞上"。
 * 部分索引——没发布的行（NULL）不参与，否则所有未发布项目会互相冲突。
 */
CREATE UNIQUE INDEX IF NOT EXISTS design_projects_share_token_uniq
  ON design_projects (share_token)
  WHERE share_token IS NOT NULL;

/*
 * 三列同生同灭：要么都有（已发布），要么 token 与 published_at 都为空（未发布）。
 * 与 `github_issue_url`/`github_issue_number` 同生同灭同一条纪律——
 * 让"半个发布状态"在数据库层面就不可能存在，而不是靠每条读路径自己判。
 */
ALTER TABLE design_projects
  DROP CONSTRAINT IF EXISTS design_projects_share_all_or_nothing;
ALTER TABLE design_projects
  ADD CONSTRAINT design_projects_share_all_or_nothing CHECK (
    (share_token IS NULL AND share_published_at IS NULL AND share_snapshot IS NULL)
    OR (share_token IS NOT NULL AND share_published_at IS NOT NULL AND share_snapshot IS NOT NULL)
  );
