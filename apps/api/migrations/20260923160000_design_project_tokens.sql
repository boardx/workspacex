/*
 * 对标 R1（#3933）—— 项目级**设计 token**（品牌色、字体；后续圆角、密度也进这一列）。
 *
 * ## 为什么是一列 jsonb，而不是 brand / font 各一列
 *
 * token 是一组一起变的东西：以后加圆角、密度，是往对象里加一个键——契约 `DesignTokens`
 * 带默认值，老行读出来自动补齐。每项一列的话，每加一项要一次迁移 + 仓储 SELECT/UPDATE/
 * 行映射三处各接一次线，漏一处的表现是「设了、刷新就没了」。
 *
 * ## 为什么不在库里 CHECK 形状
 *
 * 形状的唯一事实源是契约 `DesignTokens`（读侧 `safeParse`，读不出来的键退回缺省值）。
 * 在库里再写一遍 CHECK 就是第二份事实源；而这一列只由本服务经契约校验后写入。
 *
 * 默认 '{}' = 全部缺省值 = 这一列出现之前的渲染，老项目一个像素都不变。
 */
ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS tokens jsonb NOT NULL DEFAULT '{}'::jsonb;
