-- F05: a durable, verified receipt is the recovery source; the existing webhook
-- events table remains an insert-only terminal audit, never an in-memory queue.
CREATE TABLE IF NOT EXISTS billing_payment_receipts (
  provider_event_id text PRIMARY KEY,
  order_no text NOT NULL,
  app_id text NOT NULL,
  mch_id text NOT NULL,
  amount_fen integer NOT NULL CHECK (amount_fen >= 0),
  currency text NOT NULL,
  transaction_id text,
  trade_state text NOT NULL,
  paid_at timestamptz,
  receipt_hash text NOT NULL CHECK (receipt_hash ~ '^[a-f0-9]{64}$'),
  signature_verified boolean NOT NULL CHECK (signature_verified),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','ignored','failed')),
  previous_closed_at timestamptz,
  recovery_source_id text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CHECK (trade_state <> 'SUCCESS' OR (transaction_id IS NOT NULL AND paid_at IS NOT NULL))
);
-- No order FK: its implicit lock would invert inbox -> order. The accepting
-- transaction explicitly locks/validates that order before the receipt commits.
CREATE INDEX IF NOT EXISTS billing_payment_receipts_pending_idx
  ON billing_payment_receipts(retry_at,received_at) WHERE state='pending';
CREATE OR REPLACE FUNCTION billing_receipt_facts_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.provider_event_id,NEW.order_no,NEW.app_id,NEW.mch_id,NEW.amount_fen,
         NEW.currency,NEW.transaction_id,NEW.trade_state,NEW.paid_at,NEW.receipt_hash,NEW.signature_verified)
     IS DISTINCT FROM
     ROW(OLD.provider_event_id,OLD.order_no,OLD.app_id,OLD.mch_id,OLD.amount_fen,
         OLD.currency,OLD.transaction_id,OLD.trade_state,OLD.paid_at,OLD.receipt_hash,OLD.signature_verified) THEN
    RAISE EXCEPTION 'verified billing receipt facts are immutable' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS billing_receipt_facts_immutable ON billing_payment_receipts;
CREATE TRIGGER billing_receipt_facts_immutable BEFORE UPDATE ON billing_payment_receipts
  FOR EACH ROW EXECUTE FUNCTION billing_receipt_facts_immutable();
COMMENT ON TABLE billing_payment_receipts IS
  'kernel-no-tenant-data: verified WeChat receipt recovery queue across personal/team owners; '
  'contains merchant/order/amount/transaction facts, no payer or decrypted raw payload. '
  'app_rw can see all receipts; only signature-verified acceptance and the global billing '
  'transaction boundary may consume it. No organization settings/identity data here.';
REVOKE ALL ON billing_payment_receipts FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON billing_payment_receipts TO app_rw;
