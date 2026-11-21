-- NULL inherits the existing deployment setting during rollout.
ALTER TABLE credit_consumption_settings
 ADD COLUMN IF NOT EXISTS credit_rate_bps integer CHECK (credit_rate_bps BETWEEN 1 AND 1000000);
ALTER TABLE credit_consumption_setting_changes
 ADD COLUMN IF NOT EXISTS old_credit_rate_bps integer,
 ADD COLUMN IF NOT EXISTS new_credit_rate_bps integer;

ALTER TABLE credit_consumption_settings
 ADD COLUMN IF NOT EXISTS credit_rate_cn_bps integer CHECK (credit_rate_cn_bps BETWEEN 1 AND 1000000),
 ADD COLUMN IF NOT EXISTS credit_rate_us_bps integer CHECK (credit_rate_us_bps BETWEEN 1 AND 1000000);
ALTER TABLE credit_consumption_setting_changes
 ADD COLUMN IF NOT EXISTS credit_rate_market text CHECK (credit_rate_market IN ('cn', 'us'));
