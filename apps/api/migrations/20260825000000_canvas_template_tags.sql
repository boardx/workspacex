-- 2026-08-25：画布模板重设计第一步——给 `canvas_templates` 加 `tags`。
--
-- `Design.pdf` §2「数据模型」：模板的标签是「自由标签，用于模板库筛选；无固定枚举」，
-- 不是一列受控枚举，也不需要单独一张标签表（模板库的筛选条是从现有模板的 tags 实时
-- 聚合出来的，不是查一张独立的标签维表，见 `template-editor-panel.tsx` 后续改版的
-- `tagFilters` 派生逻辑）——所以是 `canvas_templates` 上的一个 `text[]` 列，不新建表。
--
-- 存量行（19 个内置 + 已有 org 自建模板）没有标签概念，`DEFAULT '{}'` 让它们落地就是
-- 「没有标签」而不是 NULL——契约 `tags: z.array(z.string())` 出门永远是数组，给已有行
-- 一个 NULL 会在响应边界的 `.strict()` 校验上当场炸，`'{}'` 默认值让这条迁移本身
-- 不需要配一条 UPDATE 回填。
--
-- 可独立重放：`ADD COLUMN IF NOT EXISTS`。

ALTER TABLE canvas_templates
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
