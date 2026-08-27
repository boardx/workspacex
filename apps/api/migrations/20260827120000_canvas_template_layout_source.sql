-- #2221：chat 内置 canvas 模板渲染绕过组织自定义——模板编辑器发布的改动从未真正生效。
--
-- ## 根因
--
-- `apps/web/lib/canvas/fence-template-resolver.ts` 的 `ensureCanvasFenceTemplate` 对
-- 19 个内置 key 恒用 `fabric-markdown` 包内原生几何，从不查组织在 `canvas_templates`
-- 里的自定义行。而 `backfill-canvas-builtin-templates.ts` 已经给每个开通过的组织把
-- 19 个内置模板的行都建好了（layout 字段也已推算齐全）——「DB 里有一行」对 19 个内置
-- key 恒真，不能拿它当「用户真的改过」的判据。
--
-- ## 这一列解决什么
--
-- `layout_source` 显式记录一行的几何/呈现内容是「backfill 推算的默认值」
-- （`builtin-derived`）还是「真人在编辑器里改过并保存过」（`user-edited`）——
-- 单一事实源，不用「DB 里有没有行」（backfill 恒建行）、不用内容比对（改完又改回
-- 默认值不代表没被人碰过）、不用 actorId（backfill 也是拿真实管理员账号跑的）。
--
-- 一旦某个 key 的某一行被标过一次 `user-edited`，应用层保证**不可退回**
-- `builtin-derived`（见 `mint-template-version.ts`）——这一列本身只做「存」与
-- 「约束取值闭集」，单调不可退回的保证由写入侧（应用层）负责，不是这条迁移的事。
--
-- ## 存量数据
--
-- 迁移时不追溯判断存量行「是不是曾经被人手工改过」——统一落 `DEFAULT
-- 'builtin-derived'`，如实登记为已知限制（迁移前任何未走 mint 流程的改动一律视为
-- 未自定义），不追溯重建。这条边界已在设计签核材料里登记确认。
--
-- 可独立重放：ADD COLUMN IF NOT EXISTS + 约束存在性判断。

ALTER TABLE canvas_templates
  ADD COLUMN IF NOT EXISTS layout_source text NOT NULL DEFAULT 'builtin-derived';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canvas_templates_layout_source_check'
  ) THEN
    ALTER TABLE canvas_templates
      ADD CONSTRAINT canvas_templates_layout_source_check
      CHECK (layout_source IN ('builtin-derived', 'user-edited'));
  END IF;
END $$;

COMMENT ON COLUMN canvas_templates.layout_source IS
  '#2221：这一行的几何/呈现内容来自 backfill 推算（builtin-derived）还是真人在编辑器里'
  '改过并保存过（user-edited）。chat 围栏渲染只在 user-edited 时才用这一行覆盖内置'
  '原生几何。一旦标过 user-edited，应用层保证不可退回 builtin-derived。';
