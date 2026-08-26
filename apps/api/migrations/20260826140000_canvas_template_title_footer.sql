-- 画布模板的**版面装帧**：标题带与页脚带（人类 2026-08-26 截图实测原话：
-- 「如附件的三个模板，需要有一个功能是可以放 Title，页脚也有一些版权的信息，
--   需要可以预留这个空间」）。
--
-- ## 为什么不是 `display_name`
--
-- `display_name` 是**后台列表**里那个名字（「用户画像」），权威是契约的
-- `BUILTIN_CANVAS_TEMPLATES`（O-09 单点事实源）。`title` 是**画在纸上**的那行双语大标题
-- （「用户画像 User Persona」），权威是 `@repo/fabric-markdown` 的 `TemplateSpec.title`。
-- 两者是不同展示层的两件事实，合成一列会让「改了后台列表的名字，A1 纸上的标题跟着变」
-- ——而那两处本来就该能分别改。`backfill-canvas-builtin-templates.ts` 的文件头早就
-- 逐字写明了这个区分，当时的做法是**丢掉** title；现在它有地方落了。
--
-- ## 为什么是装帧而不是内容
--
-- 两者都**不进** `sections`：`sections` 是「AI 要填什么」，而标题与署名是纸本身长什么样，
-- 跟 AI 输出无关。放进 sections 会让它们出现在输出 schema 里，于是模型会试图去"填标题"。
--
-- 因此它们由 `updateTemplateMetadata` 写（那条操作对**任何状态**都生效，因为它物理上
-- 碰不到 `sections`），而不是 `updateTemplateDraft`。后果是**已发布的模板也能直接改标题
-- 和署名**，不必开新版——改装帧不动内容快照，已建实例不受影响（I-4 仍然成立）。
--
-- ## 默认空串而不是 NULL
--
-- 「没有页脚」与「页脚是空的」在渲染上是同一件事，多一个 NULL 只会让每个读它的地方
-- 都要多判一次。⚠ 但 `title` 的空串**有**含义：新建模板还没起标题时纸上不画标题带，
-- 那一带的空间还给内容网格（见 `explicit-template-layout.ts` 的预留计算）。
--
-- 可独立重放：ADD COLUMN IF NOT EXISTS。

ALTER TABLE canvas_templates ADD COLUMN IF NOT EXISTS title  text NOT NULL DEFAULT '';
ALTER TABLE canvas_templates ADD COLUMN IF NOT EXISTS footer text NOT NULL DEFAULT '';

COMMENT ON COLUMN canvas_templates.title IS
  'A1 纸上那行双语大标题（如「用户画像 User Persona」）。与 display_name 是两件事实：'
  '前者画在纸上、权威是 fabric-markdown 的 TemplateSpec.title；后者是后台列表名、'
  '权威是契约的 BUILTIN_CANVAS_TEMPLATES。空串 = 不画标题带，那一带的空间还给内容网格。';

COMMENT ON COLUMN canvas_templates.footer IS
  'A1 纸底部的署名/版权行（如「本工具基于 Bizzuka 的 AI 战略画布」）。'
  '⚠ 老 spec 里**没有**这件事实，19 个内置模板回填时一律留空——'
  '编一段署名等于凭空断言某个作品的出处。空串 = 不画页脚带。';
