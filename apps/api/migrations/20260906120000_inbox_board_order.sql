-- UC-17.8 B3.x —— 运营收件箱看板「列内可上下移动/拖拽排序」。
--
-- 契约 `packages/contracts/src/inbox.ts` 新增 `InboxItem.boardOrder` 字段与
-- `operations.reorderInboxItem` 操作，两者的唯一落库处就是这张表。
--
-- ## 为什么是一张独立表，不是给 `product_feedback` / `error_logs` 各加一列
--
-- 收件箱把 feedback / exception / design 三种来源折成一张列表（见 `inbox.ts` 文件头
-- 「这份契约只读、不存」）；`boardOrder` 是**收件箱这张投影自己的展示顺序**，不是
-- 三个源表任何一张自己的属性——`product_feedback` 不知道、也不需要知道自己在收件箱
-- 看板上排第几。给三张源表各加一列，等于让一个只在投影层有意义的概念在三张互不相干
-- 的表里各存一份，且 `error_logs` 那张表连 `org_id` 都没有（见该表头注，跨租户泄露
-- 风险），加一列到那张表上还得单独过一遍那道审查。一张独立表用 `(org_id, kind, item_id)`
-- 复合键统一寻址三种来源，源表一行都不用碰。
--
-- ## 排序值：整数、每次整列重新赋值，不是浮点数插入
--
-- `reorderInboxItem` 每次调用带的是"这一列现在完整的新顺序"（`orderedIds`），
-- 服务端按数组下标 0..n-1 整体重新赋值——不是"插入到某两个值中间"再取浮点平均数。
-- 后者在多次插入之后会逼近浮点精度极限；前者每次都是一次干净的重新编号，
-- 代价是一次 upsert 覆盖整列，而这列的量级（一个看板列）本来就有界。
--
-- ## 没有存下来的行 ⟺ 用创建时间做默认序
--
-- 应用层（`list-inbox.ts`）对查不到 `sort_order` 的条目回退到
-- `-created_at 的毫秒数`，让"从没被人手动排过序"的条目保持现在这套「越新越靠前」的
-- 顺序——不在这张表里为它们补一行占位数据。
CREATE TABLE IF NOT EXISTS inbox_item_order (
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 与 `InboxKind` 同一个闭集：`feedback` / `exception` / `design`。
  kind        text NOT NULL CHECK (kind IN ('feedback', 'exception', 'design')),
  -- 源对象的 id（`product_feedback.id` / `error_logs.id` / `design_projects.id`）——
  -- 与 `InboxItem.id` 同一个值，不是这张表自己发的第二个 id。
  item_id     text NOT NULL,
  sort_order  double precision NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, item_id)
);

CREATE INDEX IF NOT EXISTS inbox_item_order_org_idx ON inbox_item_order (org_id);

ALTER TABLE inbox_item_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_item_order FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_item_order_tenant ON inbox_item_order;
CREATE POLICY inbox_item_order_tenant ON inbox_item_order
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE ON inbox_item_order TO app_rw;
