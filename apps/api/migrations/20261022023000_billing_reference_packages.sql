-- Match boardx-backend DEFAULT_CN_PACKAGES consumed by boardx-web.
-- Retire the prototype catalog; keep its rows and every historical order snapshot.
UPDATE credit_packages SET enabled=false WHERE package_id IN ('pkg-basic','pkg-plus','pkg-pro');
INSERT INTO credit_packages
  (package_id,region,currency,amount_fen,base_credits,bonus_credits,bonus_rate,total_credits,owner_type,enabled,sort_order)
VALUES
  ('pkg-cn-100','cn','CNY',100,100,0,0,100,'both',true,1),
  ('pkg-cn-1000','cn','CNY',1000,1000,0,0,1000,'both',true,2),
  ('pkg-cn-3000','cn','CNY',3000,3000,0,0,3000,'both',true,3),
  ('pkg-cn-5000','cn','CNY',5000,5000,0,0,5000,'both',true,4),
  ('pkg-cn-10000','cn','CNY',10000,10000,0,0,10000,'both',true,5),
  ('pkg-cn-20000','cn','CNY',20000,20000,0,0,20000,'both',true,6)
ON CONFLICT (package_id) DO UPDATE SET region=EXCLUDED.region,currency=EXCLUDED.currency,
  amount_fen=EXCLUDED.amount_fen,base_credits=EXCLUDED.base_credits,bonus_credits=EXCLUDED.bonus_credits,
  bonus_rate=EXCLUDED.bonus_rate,total_credits=EXCLUDED.total_credits,owner_type=EXCLUDED.owner_type,
  enabled=EXCLUDED.enabled,sort_order=EXCLUDED.sort_order;
