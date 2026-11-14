-- Add a personal-only CNY top-up. Existing SKUs and order snapshots keep their prices.
INSERT INTO credit_packages (
  package_id, region, currency, amount_fen, base_credits, bonus_credits,
  bonus_rate, total_credits, owner_type, enabled, sort_order, product_kind
)
VALUES ('credit-cn-10-v1', 'cn', 'CNY', 100, 10, 0, 0, 10, 'user', true, 4, 'credit_topup')
ON CONFLICT (package_id) DO NOTHING;
