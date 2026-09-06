-- 2026-09-06（issue #2825）：给 `canvas_templates` 加 `recommend_after`——
-- 「用完这个模板之后，接着推荐哪几个模板」。
--
-- ## 为什么这条关系必须在库里，不能写在前端
--
-- chat 建议行里那条「生成用户画像」此前是 `copilotkit-v2-panel-body.tsx` 里的一个
-- 常量 chip：19 个内置 + 组织自建模板里只有 persona 进得了建议行，后台 template-admin
-- 改模板对它毫无影响。这正是本仓已经栽过三次的形状（`canvas-template-guidance.ts`
-- issue #1493 的 chat 指引、`persona-summary.ts` 的字段清单，都是「后台改了、chat 照旧」）。
-- 推荐关系是顾问的方法论（画完画像接着画旅程图还是同理心地图，不同团队答案不同），
-- 与「这个模板有哪些分区」同属模板配置，因此和 tags/prompt_text 一样是这张表上的一列。
--
-- ## 同 `tags` 的形状：text[]，DEFAULT '{}'，不建第二张表
--
-- 它是一个**有序的 key 列表**（顺序即推荐优先级），不是一张需要被独立查询/统计的
-- 关联关系。建一张 `canvas_template_recommendations(from_key, to_key, order)` 只会让
-- 「改一次推荐关系」从一条 UPDATE 变成一次 DELETE+INSERT 事务，而没有任何查询会
-- 从那张表的 JOIN 能力里获益（消费端一次性把整个模板库读进内存做集合运算）。
--
-- ## 不加外键约束指向 `canvas_templates.key`——刻意的
--
-- 契约 `updateTemplateMetadata.in.recommendAfter` 那条注释写了同一件事：key 指向的模板
-- 可能还没建、已归档、或对读取者不可见。「现在还存不存在、可不可见」只有读取那一刻的
-- `listTemplates` 知道（可见性判定按人算，数据库约束按行算，两者本就判不了同一件事）。
-- 写入时校验会得到一份写入时成立、读取时未必成立的假保证；消费端
-- （`recommend-canvas-templates.ts`）按当次已发布清单取交集，解析不到的 key 直接跳过。
--
-- ## 存量行：`DEFAULT '{}'` 落地即「没配」，不在这里 UPDATE 回填
--
-- 19 个内置模板的默认推荐关系（画像 → 旅程图/同理心地图…）是一份**会被产品迭代的
-- 方法论**，它的唯一事实源是 `domain/canvas/builtin-template-config.ts` 的
-- `BUILTIN_RECOMMEND_AFTER`，由读路径对 `builtin` 行空值兜底（与 `prompt_text` 完全
-- 同一条既有纪律，见 `pg-canvas-template-repository.ts` 的 `promptText` 兜底）。
-- 在这条迁移里再抄一份 SQL 版的默认表，就是同一件事实的第二处声明。
--
-- 可独立重放：ADD COLUMN IF NOT EXISTS。

ALTER TABLE canvas_templates
  ADD COLUMN IF NOT EXISTS recommend_after text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN canvas_templates.recommend_after IS
  '这个模板产出之后，chat 建议行接着推荐哪几个模板（元素为模板 key，顺序即优先级）。'
  '空数组 = 未配置；内置模板的空值由读路径按 BUILTIN_RECOMMEND_AFTER 兜底。';
