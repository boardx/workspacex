-- F177 (BP-03)：换时长档位 —— `blueprints` 加行级 `revision`（CAS 令牌）
-- 契约：templates.setDurationTier（束已签核 2026-07-30，covers 含 F177）
--
-- ## 为什么 blueprints 需要一个行级 revision，而不是复用 version_number
--
-- `version_number`（BP-01 已有列）语义是「已发布过几个版本」，草稿期恒为 0——
-- 它不随草稿期的编辑变化，不能拿来做乐观并发令牌（两次编辑之间它永远相等）。
-- `updated_at` 理论上能做令牌，但精度只到毫秒，两次并发写入落在同一毫秒时
-- 无法区分先后——见 BP-02 迁移同款理由（`item_revision` 不用时间戳）。
-- 故沿用 BP-02 的做法：加一个 `gen_random_uuid()::text` 驱动的令牌列，每次成功写入
-- （不仅是设计环节，未来 setFormatAndLanguage/setModelStrategy/setQuotaPolicy 等
-- 蓝本行级写操作共用）滚动一次。
--
-- ## ⚠ 已知契约缺口（如实登记，不是本迁移能解的）
--
-- 契约 `setDurationTier.in` 要求调用方传入 `expectedVersion`，但**没有任何契约操作
-- 把这个值读出来给调用方**——`listBlueprints.out`（`BlueprintRow`）不含它，也没有
-- `getBlueprint` 单条读操作。这意味着今天没有客户端能合法地拿到第一个 `expectedVersion`
-- 去发起第一次调用。已登记为 `packages/contracts/src/templates.ts`
-- `KNOWN_CONTRACT_GAPS.T9`（同 T1-T8 的性质：契约签核时留下的缺口，不是本 feature
-- 发明的，也不由本 feature 单方补——补它是新增契约面，要走 delta 重签）。
-- 本 feature 的后端因此是**真实、可测、但暂时无法被真实前端消费**的状态，
-- 与 BP-01 对 `reverse-from-project` 的处理是同一类诚实：宁可可测但暂不可达，
-- 不要为了「让它看起来能用」去发明一个契约没有的读端点。

ALTER TABLE blueprints
  ADD COLUMN IF NOT EXISTS revision text NOT NULL DEFAULT gen_random_uuid()::text;

COMMENT ON COLUMN blueprints.revision IS
  'F177 (BP-03)：行级乐观并发令牌，随任何蓝本行级写操作滚动。不是 version_number（发布计数）。';
