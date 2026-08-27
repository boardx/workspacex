-- 画布模板的**纸张尺寸**——2026-08-27 人类原话：「模板可以选择 A1，A3，A4 等大小，
-- 或者自定义大小，然后如果选择了这个大小，则必须应该覆盖这个 size 的区域」。
--
-- 首批只落 A1/A3/A4 三个 ISO 横版预设（人类裁决「先只加预设」，自定义宽高留作
-- 后续独立范围——12×8 网格的排版算法目前假设固定比例，自定义宽高需要重新设计
-- 那一部分，不在本次范围内）。
--
-- ## 与 prompt_text/title/footer 不同：这一列是**内容相关**，不是装帧
--
-- 纸张尺寸决定内容区的物理 mm 数（`Design.pdf` §5「A1 与贴纸尺寸」的 821×574 mm
-- 换算公式，直接用纸面尺寸），改了尺寸会改变「每个区块贴纸装不装得下」的体检结果——
-- 与 `updateTemplateMetadata` 承诺「绝不碰内容」矛盾。所以这一列只能经
-- `createTemplate`/`updateTemplateDraft`/`mintTemplateVersion` 写，物理上不接
-- `updateTemplateMetadata` 那条 UPDATE（应用层的事，这里只管落库形状）。
--
-- ## 默认 'A1'，历史数据原样成立
--
-- 19 个内置模板与既有组织自建模板的分区坐标（`layout` 的 col/row/w/h）都是在
-- A1 尺寸下推演/拖拽出来的（`Design.pdf` §5 表格、`builtin-template-config.ts`
-- 的 `deriveTemplateLayouts`）。默认 'A1' 让这些历史行的既有几何原样成立，不需要
-- 一次性重算——它们本来就是 A1。
--
-- 可独立重放：ADD COLUMN IF NOT EXISTS + 幂等的 CHECK 约束探测。

ALTER TABLE canvas_templates ADD COLUMN IF NOT EXISTS size text NOT NULL DEFAULT 'A1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canvas_templates_size_check'
  ) THEN
    ALTER TABLE canvas_templates
      ADD CONSTRAINT canvas_templates_size_check CHECK (size IN ('A1', 'A3', 'A4'));
  END IF;
END $$;

COMMENT ON COLUMN canvas_templates.size IS
  '纸张尺寸预设（A1/A3/A4，ISO 横版）。内容相关字段，只经 createTemplate/'
  'updateTemplateDraft/mintTemplateVersion 写，不进 updateTemplateMetadata。默认 A1。';
