-- Reference-backend compatibility accepts AES-GCM-authenticated callbacks when
-- no platform RSA key is configured. Record this honestly rather than treating
-- skipped RSA verification as success. Existing signed receipts stay unchanged.
ALTER TABLE billing_payment_receipts
  DROP CONSTRAINT IF EXISTS billing_payment_receipts_signature_verified_check;
COMMENT ON COLUMN billing_payment_receipts.signature_verified IS
  'Whether platform RSA verification actually succeeded; false for reference compatibility acceptance with API-v3 AES-GCM authentication.';
COMMENT ON TABLE billing_payment_receipts IS
  'kernel-no-tenant-data: AES-GCM-authenticated WeChat receipt recovery queue across personal/team owners; '
  'platform RSA verification is recorded separately. Contains merchant/order/amount/transaction facts, '
  'no payer or decrypted raw payload. The global billing transaction boundary validates orders before crediting.';
