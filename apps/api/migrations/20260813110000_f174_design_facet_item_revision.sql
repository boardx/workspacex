-- F174 (BP-02)：设计环节逐项乐观并发 —— `blueprint_design_facets` 加 `item_revision`
-- 契约：templates.updateDesignFacet（`expectedItemRevision` / `itemRevision`，束已签核）
--
-- ## 为什么是「逐项」而不是整个蓝本一把锁
--
-- 契约的乐观并发粒度写在注释里：**「粒度 = 单项」**。15 个设计环节是并行编辑的
-- （不同的人同时改「主题与背景」和「流程 Agenda」很正常），整蓝本一把版本号会让
-- 编辑 A 项的人因为 B 项被人改过而写入失败——那是错误的冲突判定，不是保护。
--
-- ## 「从未填过的项」的 expectedItemRevision 是什么
--
-- 这张表此前只有「已填」的行——未填就是没有这一行（BP-01 文件头注）。所以「我以为
-- 这一项还没人填过」这个状态，逻辑上没有一个现成的 revision 值可比。
-- **约定：哨兵值空字符串 `''`**，与常见 ETag 惯例一致（`If-Match: ""` 表示
-- 「假定资源不存在」）。这是本迁移随附的应用层的设计决定，不是契约里写死的。

-- ⚠ `gen_random_uuid()` 是易失函数：PG11+ 对「加带易失默认值的 NOT NULL 列」
--   会做整表重写、**逐行**求值，不是算一次填全表。历史行（BP-01 已写入的）因此
--   各自拿到独立的 revision，不需要额外回填——若这里用的是一个常量默认值，
--   所有历史行会共享同一个 revision，「谁先写谁后写」的判定就失去意义了。
ALTER TABLE blueprint_design_facets
  ADD COLUMN item_revision text NOT NULL DEFAULT gen_random_uuid()::text;
