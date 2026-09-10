-- 画布模板的**网格密度**（列数 × 行数）——2026-09-10 人类实测反馈：「现在的这个
-- 格子感觉不够用，你有什么建议吗？」「现在是 8*12」。四阶段 × 五维度的用户旅程图
-- 已经把 8 行用满，再加一个阶段就没地方放。
--
-- ## 为什么必须落库，不是编辑器里一个开关
--
-- `sections[].layout` 的 col/row/w/h 是**网格坐标**，脱离"这张网格几列几行"没有
-- 意义。以前行数写死 8、渲染侧写死 12 列（`fence-template-resolver.ts`），不存
-- 也能对上；一旦允许换密度，同一份 layout 在 12×8 与 24×16 下指的是纸面上完全
-- 不同的位置——不存下来，模板保存的那一刻几何就漂了。
--
-- ## 与 size 同一类：内容相关，不进 updateTemplateMetadata
--
-- 网格密度改变「每个区块贴纸装不装得下」的体检结果（`sectionGeometryMm` 的行/列
-- 除数就是这两个数），与 `updateTemplateMetadata` 承诺「绝不碰内容」矛盾。所以
-- 这两列只经 createTemplate/updateTemplateDraft/mintTemplateVersion 写——同
-- `20260827130000_canvas_template_paper_size.sql` 那一列的既有分工。
--
-- ## 默认 12×8，历史数据原样成立
--
-- 19 个内置模板与所有既有组织模板的坐标都是在 12×8 上拖出来的，默认值让这些历史
-- 行的既有几何原样成立，不需要把 col/row 乘 2 重算一遍——那种一次性全量重算是
-- 这次刻意不选的方案（迁移错了就是全量模板错位，且不可逆）。
--
-- 可独立重放：ADD COLUMN IF NOT EXISTS + 幂等的 CHECK 约束探测。

ALTER TABLE canvas_templates ADD COLUMN IF NOT EXISTS grid_cols integer NOT NULL DEFAULT 12;
ALTER TABLE canvas_templates ADD COLUMN IF NOT EXISTS grid_rows integer NOT NULL DEFAULT 8;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canvas_templates_grid_cols_check'
  ) THEN
    ALTER TABLE canvas_templates
      ADD CONSTRAINT canvas_templates_grid_cols_check CHECK (grid_cols IN (6, 12, 24));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canvas_templates_grid_rows_check'
  ) THEN
    ALTER TABLE canvas_templates
      ADD CONSTRAINT canvas_templates_grid_rows_check CHECK (grid_rows IN (8, 16));
  END IF;
END $$;

COMMENT ON COLUMN canvas_templates.grid_cols IS
  '画布网格列数（6/12/24）。内容相关字段，只经 createTemplate/updateTemplateDraft/'
  'mintTemplateVersion 写，不进 updateTemplateMetadata。默认 12。';
COMMENT ON COLUMN canvas_templates.grid_rows IS
  '画布网格行数（8/16）。同 grid_cols 的写入分工。默认 8。';
