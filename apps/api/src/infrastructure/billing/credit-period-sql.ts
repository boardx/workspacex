/** Closed statements shared by tenant accounting and the verified Stripe owner-global boundary. */
export const CREDIT_PERIOD_GRANT_SQL = Object.freeze({
  periodDue: "SELECT period_id,source_kind,remaining_hundredths::text FROM credit_subscription_periods WHERE wallet_id=$1 AND expired_at IS NULL AND period_end<=$2 ORDER BY period_end,period_id FOR UPDATE",
  periodExpireWallet: "UPDATE credit_wallets SET balance=balance-$2,updated_at=now() WHERE wallet_id=$1 RETURNING balance::text",
  periodExpireLedger: "INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id) VALUES($1,'subscription_expire',-1,$2,$3,'subscription_period',$4)",
  welcomePeriodExpireLedger: "INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id) VALUES($1,'welcome_expire',-1,$2,$3,'welcome_period',$4)",
  periodMarkExpired: "UPDATE credit_subscription_periods SET remaining_hundredths=0,expired_at=$2 WHERE period_id=$1",
  periodEnsureUserWallet: "INSERT INTO credit_wallets(owner_type,owner_id) VALUES('user',$1) ON CONFLICT(owner_type,owner_id) DO NOTHING",
  periodLockUserWallet: "SELECT wallet_id FROM credit_wallets WHERE owner_type='user' AND owner_id=$1 FOR UPDATE",
  periodFindIdentity: `SELECT *,granted_hundredths::text,remaining_hundredths::text FROM credit_subscription_periods
    WHERE invoice_ref=$1 OR (wallet_id=$2 AND subscription_ref=$3 AND period_start=$4 AND period_end=$5)`,
  periodWalletState: "SELECT balance::text,total_granted FROM credit_wallets WHERE wallet_id=$1",
  periodInsert: `INSERT INTO credit_subscription_periods(wallet_id,subscription_ref,invoice_ref,plan_ref,period_start,period_end,granted_hundredths,remaining_hundredths)
    VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING period_id`,
  periodGrantWallet: "UPDATE credit_wallets SET balance=$2,total_granted=total_granted+$3,updated_at=now() WHERE wallet_id=$1",
  periodGrantLedger: "INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id) VALUES($1,'subscription_grant',1,$2,$3,'subscription_period',$4)",
});
