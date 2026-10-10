/*
 * Phase 21 / F01（billing-payment）—— 计费域六表 + 套餐种子。
 *
 * 依据：契约束 billing-credits `domain.md` §二（实体与表）/ §四（不变量）；
 *       requirements/02-payment-order-notify.md R6（订单状态机与可观察字段）。
 * 语义对齐 boardx-backend/src/credits（实现按本仓 Postgres 重做，不照搬 Mongoose 结构）。
 *
 * 库内门（不靠调用方自觉）：
 *  · I-4  钱包 (owner_type, owner_id) 唯一
 *  · I-7  billing_webhook_events (provider, provider_event_id) 唯一（回调幂等键）
 *  · I-2  流水 (source_type, source_id, type) 唯一（同一订单至多一次入账）
 *  · I-8  人工发放（type='grant'）必带 operator_id 与 reason
 *  · I-5  billing_orders 的快照列（主体/套餐/金额/额度/时间）由触发器拒绝 UPDATE
 *  · I-11 金额与额度一律整数（integer + CHECK）
 *  · 账本不可改：credit_transactions 只授 SELECT/INSERT（app_rw 无 UPDATE/DELETE）
 *
 * ⚠ 租户面（内核 0004 的 catalog 审计 I-6，首次全量验证时抓到本迁移，已修）：
 *   · org_billing_settings **有 org_id 列** → 是租户表，必须 ENABLE+FORCE RLS + 以
 *     app.current_org 为键的策略（豁免通道不适用），见本文件下方的 RLS 段。
 *   · 其余五张按 (owner_type, owner_id) 归属、没有 org 维度 → 审计判
 *     UNTENANTED_BUT_GRANTED（"无租户键但运行时可读"），答案按 0011 的标准**写在表上**：
 *     kernel-no-tenant-data 注释，逐表说清装什么、被攻陷的 app_rw 实际能看到什么。
 *   契约 domain.md 的「本域不设 RLS」按此收敛：五张表维持无 RLS（豁免声明型），
 *   org_billing_settings 按内核标准上 RLS。归属校验仍在应用层（I-9）。
 */

CREATE TABLE IF NOT EXISTS credit_packages (
  package_id    text PRIMARY KEY,
  region        text NOT NULL CHECK (length(region) > 0),
  currency      text NOT NULL CHECK (length(currency) > 0),
  amount_fen    integer NOT NULL CHECK (amount_fen >= 0),
  base_credits  integer NOT NULL CHECK (base_credits > 0),
  bonus_credits integer NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
  bonus_rate    numeric(6,4) NOT NULL DEFAULT 0 CHECK (bonus_rate >= 0),
  total_credits integer NOT NULL CHECK (total_credits > 0),
  owner_type    text NOT NULL DEFAULT 'both' CHECK (owner_type IN ('user', 'team', 'both')),
  enabled       boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  CHECK (total_credits = base_credits + bonus_credits)
);

CREATE TABLE IF NOT EXISTS billing_orders (
  order_no           text PRIMARY KEY CHECK (order_no ~ '^bg[0-9]{14}[A-Za-z0-9]{6}$'),
  owner_type         text NOT NULL CHECK (owner_type IN ('user', 'team')),
  owner_id           text NOT NULL CHECK (length(owner_id) > 0),
  created_by         text NOT NULL CHECK (length(created_by) > 0),
  package_id         text NOT NULL REFERENCES credit_packages (package_id),
  amount_fen         integer NOT NULL CHECK (amount_fen >= 0),
  base_credits       integer NOT NULL CHECK (base_credits > 0),
  bonus_credits      integer NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
  currency           text NOT NULL CHECK (length(currency) > 0),
  provider           text NOT NULL DEFAULT 'wechat' CHECK (provider IN ('wechat')),
  status             text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CLOSED')),
  qr_code_url        text NOT NULL CHECK (length(qr_code_url) > 0),   -- I-13：订单存在即有二维码
  channel_order_no   text,
  last_error_code    text,
  last_error_message text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz,
  notify_at          timestamptz,
  expired_at         timestamptz NOT NULL,
  closed_at          timestamptz,
  CHECK (expired_at > created_at)
);
CREATE INDEX IF NOT EXISTS billing_orders_owner_idx ON billing_orders (owner_type, owner_id, created_at DESC);
-- 关单任务（F05 后续 feature）的扫描面：只关心未支付的过期单
CREATE INDEX IF NOT EXISTS billing_orders_pending_expiry_idx
  ON billing_orders (expired_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS credit_wallets (
  wallet_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type      text NOT NULL CHECK (owner_type IN ('user', 'team')),
  owner_id        text NOT NULL CHECK (length(owner_id) > 0),
  balance         integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_purchased integer NOT NULL DEFAULT 0 CHECK (total_purchased >= 0),
  total_granted   integer NOT NULL DEFAULT 0 CHECK (total_granted >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)  -- I-4
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  txn_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     uuid NOT NULL REFERENCES credit_wallets (wallet_id),
  type          text NOT NULL CHECK (type IN ('purchase', 'bonus', 'grant')),
  direction     smallint NOT NULL DEFAULT 1 CHECK (direction IN (1, -1)),
  credits       integer NOT NULL CHECK (credits > 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),  -- 账实相符锚点（I-3）
  source_type   text NOT NULL CHECK (source_type IN ('payment_order', 'admin_grant')),
  source_id     text NOT NULL CHECK (length(source_id) > 0),  -- 订单号 / 发放记录号
  operator_id   text,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, type),  -- I-2：同一订单至多一次入账（purchase/bonus 各至多一条）
  CHECK (type <> 'grant' OR
    (source_type = 'admin_grant'
     AND operator_id IS NOT NULL AND length(btrim(operator_id)) > 0
     AND reason IS NOT NULL AND length(btrim(reason)) > 0))  -- I-8: 留痕不得为空白
);
CREATE INDEX IF NOT EXISTS credit_transactions_wallet_idx
  ON credit_transactions (wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS org_billing_settings (
  org_id         text PRIMARY KEY,
  credit_enabled boolean NOT NULL DEFAULT true,  -- 只影响新建订单（I-12）
  updated_by     text NOT NULL CHECK (length(updated_by) > 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text NOT NULL CHECK (provider IN ('wechat', 'stripe')),
  provider_event_id  text NOT NULL CHECK (length(provider_event_id) > 0),  -- 微信 notify.id / Stripe event.id
  order_no           text,      -- 微信回调关联订单；Stripe 事件为 null
  signature_verified boolean NOT NULL,
  result             text NOT NULL CHECK (result IN ('ok', 'rejected', 'ignored')),
  processed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)  -- I-7：回调幂等
);

-- I-5：下单时的快照列永不改变（状态机只允许动 status / paid_at / notify_at / closed_at / last_error_*）
CREATE OR REPLACE FUNCTION billing_order_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_type IS DISTINCT FROM OLD.owner_type
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.package_id IS DISTINCT FROM OLD.package_id
    OR NEW.amount_fen IS DISTINCT FROM OLD.amount_fen
    OR NEW.base_credits IS DISTINCT FROM OLD.base_credits
    OR NEW.bonus_credits IS DISTINCT FROM OLD.bonus_credits
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expired_at IS DISTINCT FROM OLD.expired_at THEN
    RAISE EXCEPTION 'billing order % snapshot columns are immutable (I-5)', OLD.order_no USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS billing_order_snapshot_immutable ON billing_orders;
CREATE TRIGGER billing_order_snapshot_immutable BEFORE UPDATE ON billing_orders
  FOR EACH ROW EXECUTE FUNCTION billing_order_snapshot_immutable();

-- 部署种子套餐（与 ui-preview 原型一致；total = base + bonus 由 CHECK 保证）
INSERT INTO credit_packages
  (package_id, region, currency, amount_fen, base_credits, bonus_credits, bonus_rate, total_credits, owner_type, enabled, sort_order)
VALUES
  ('pkg-basic', 'cn', 'CNY',  4900,  500,    0, 0.0000,  500, 'both', true, 1),
  ('pkg-plus',  'cn', 'CNY',  9900, 1200,  120, 0.1000, 1320, 'both', true, 2),
  ('pkg-pro',   'cn', 'CNY', 39900, 5000, 1000, 0.2000, 6000, 'both', true, 3)
ON CONFLICT (package_id) DO NOTHING;

-- ── 租户面（内核 I-6，见 0004 的 catalog 审计）──────────────────────────────

-- org_billing_settings 有 org_id → 租户表，没有豁免通道：ENABLE + FORCE + 策略。
DROP POLICY IF EXISTS org_billing_settings_tenant ON org_billing_settings;
ALTER TABLE org_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_billing_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY org_billing_settings_tenant ON org_billing_settings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- 五张无 org 维度的表：按 0004/0011 的约定，豁免声明写在表上——逐表说清装什么、
-- 被攻陷的 app_rw 实际能看到什么（披露即审查对象；\d+ 里可见，不进任何 allowlist）。
COMMENT ON TABLE credit_packages IS
  'kernel-no-tenant-data: 套餐目录（金额/额度/启用位）——每个组织看到的是同一份事实，'
  '无租户维度可泄；app_rw 只持有 SELECT。';
COMMENT ON TABLE billing_orders IS
  'kernel-no-tenant-data: 充值订单，按 (owner_type, owner_id) 归属个人或团队（契约裁决，'
  '不是组织维度）。被攻陷的 app_rw 可读到全部订单的金额、订单号与二维码链接——这是本'
  '豁免的实际敞口；归属校验在应用层（I-9）。';
COMMENT ON TABLE credit_wallets IS
  'kernel-no-tenant-data: 钱包，按 (owner_type, owner_id) 唯一归属（I-4），无 org 列。'
  '被攻陷的 app_rw 可读到全部钱包的余额与累计充/赠/发数——实际敞口如上；归属校验在应用层。';
COMMENT ON TABLE credit_transactions IS
  'kernel-no-tenant-data: 额度流水，按 wallet 归属（I-2 去重键）。被攻陷的 app_rw 可读到'
  '全部充值/赠送/发放流水，含人工发放的操作者与原因（I-8）——归属校验在应用层。';
COMMENT ON TABLE billing_webhook_events IS
  'kernel-no-tenant-data: 支付渠道回调的幂等记录（I-7），键为 (provider, provider_event_id)，'
  '是系统级去重事实。被攻陷的 app_rw 可读到全部回调事件及其关联订单号。';

-- 授权面（最小化）：账本只增不改、订单/钱包/设置可更新、套餐只读
REVOKE ALL ON credit_packages, billing_orders, credit_wallets, credit_transactions,
  org_billing_settings, billing_webhook_events FROM app_rw;
GRANT SELECT ON credit_packages TO app_rw;
GRANT SELECT, INSERT, UPDATE ON billing_orders TO app_rw;
GRANT SELECT, INSERT, UPDATE ON credit_wallets TO app_rw;
GRANT SELECT, INSERT ON credit_transactions TO app_rw;
GRANT SELECT, INSERT, UPDATE ON org_billing_settings TO app_rw;
GRANT SELECT, INSERT ON billing_webhook_events TO app_rw;
