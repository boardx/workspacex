/*
 * UC-17.8 迭代 11（design-delta `prototype-navigation` §5 取舍 ②A）—— 一屏一行，不再三份平行数组。
 *
 * ## 为什么
 *
 * 一屏的数据此前拆成 `frames` / `prototype` / `frame_notes` 三列按下标配对，每加一项「每屏一份」
 * 的数据就要一次迁移 + 两张表各一列 + 读写两侧各一份长度不变量。这个形状**已经咬过一次**：
 * #2900 修的正是「只写 `frames` 不写 `prototype` ⇒ 强制清空」导致用户整份原型丢失。迭代 11 要加
 * 第四项（`links` 跳转关系），与其再来一遍，不如把不变量本身消掉——一列 `screens`，
 * 「对不上」这种状态不再存在。
 *
 * ## 形状
 *
 * `screens`：jsonb 数组，每项 `{frame, root?, notes?, links?}`。
 * ⚠ `root` **可缺**：新建项目只有三个页标签（`DESIGN_PROJECT_INITIAL_FRAMES`）而没有树，
 *   「有标签没树」是合法的初始状态。应用层据此还原 `prototype`：全部有 root 才算有原型，
 *   否则视为还没生成（与既有语义一致）。
 *
 * ## 回填与回滚
 *
 * 旧三列**保留一个版本**（delta §5），本版本双写：`screens` 是事实源，旧列跟着写，
 * 万一回滚旧代码仍然读得到。可变的项目行回填 `screens`；append-only 的历史版本绝不
 * UPDATE，读侧在 `screens = []` 时回落旧三列，新追加的版本则直接写 `screens`。
 */
ALTER TABLE design_projects
  ADD COLUMN IF NOT EXISTS screens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(screens) = 'array');

ALTER TABLE design_project_prototype_versions
  ADD COLUMN IF NOT EXISTS screens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(screens) = 'array');

-- 回填：把三份平行数组按下标 zip 成一列。`root`/`notes` 缺位时不写该键（不是写 null）——
-- 契约里它们是可选键，`root` 缺 = 这页还没生成树。幂等：只填 screens 仍为空的行。
UPDATE design_projects p
   SET screens = (
     SELECT COALESCE(jsonb_agg(
              jsonb_strip_nulls(jsonb_build_object(
                'frame', f.value,
                'root',  (SELECT r.value FROM jsonb_array_elements(p.prototype)   WITH ORDINALITY AS r(value, ord) WHERE r.ord = f.ord),
                'notes', (SELECT n.value FROM jsonb_array_elements(p.frame_notes) WITH ORDINALITY AS n(value, ord) WHERE n.ord = f.ord)
              )) ORDER BY f.ord), '[]'::jsonb)
       FROM jsonb_array_elements(p.frames) WITH ORDINALITY AS f(value, ord)
   )
 WHERE p.screens = '[]'::jsonb
   AND jsonb_array_length(p.frames) > 0;

-- `design_project_prototype_versions` 是审计快照账本，旧行保持原样。不能为了 schema
-- 演进临时禁用/放宽 append-only trigger；仓储已有旧三列回落路径承担兼容读取。
