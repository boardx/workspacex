-- Additive occupancy: legacy gross holds and receipt semantics remain unchanged.
SET LOCAL row_security=off;
LOCK TABLE public.credit_wallets, public.credit_consumption_requests IN ACCESS EXCLUSIVE MODE NOWAIT;
ALTER TABLE public.credit_wallets ADD COLUMN IF NOT EXISTS remaining_held_hundredths bigint NOT NULL DEFAULT 0 CHECK(remaining_held_hundredths>=0);
CREATE OR REPLACE FUNCTION public.kernel_credit_remaining_hold_delta() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior bigint:=0; next_hold bigint:=0; wallet uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  wallet:=OLD.wallet_id;
  IF OLD.state<>'settled' THEN prior:=GREATEST(OLD.reserved_hundredths-COALESCE(OLD.debited_hundredths,0),0); END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  IF TG_OP='UPDATE' AND NEW.wallet_id IS DISTINCT FROM OLD.wallet_id THEN RAISE EXCEPTION 'credit_request_wallet_immutable'; END IF;
  wallet:=NEW.wallet_id;
  IF NEW.state<>'settled' THEN next_hold:=GREATEST(NEW.reserved_hundredths-COALESCE(NEW.debited_hundredths,0),0); END IF;
 END IF;
 IF next_hold<>prior THEN
  UPDATE public.credit_wallets SET remaining_held_hundredths=remaining_held_hundredths+next_hold-prior WHERE wallet_id=wallet;
  IF NOT FOUND THEN RAISE EXCEPTION 'credit_hold_wallet_missing'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kernel_credit_remaining_hold_delta() FROM PUBLIC;
DROP TRIGGER IF EXISTS credit_remaining_hold_delta ON public.credit_consumption_requests;
CREATE TRIGGER credit_remaining_hold_delta AFTER INSERT OR UPDATE OR DELETE ON public.credit_consumption_requests
FOR EACH ROW EXECUTE FUNCTION public.kernel_credit_remaining_hold_delta();
-- Privileged migration snapshot only; runtime never aggregates other tenant rows.
UPDATE public.credit_wallets w SET remaining_held_hundredths=COALESCE((
 SELECT SUM(GREATEST(r.reserved_hundredths-COALESCE(r.debited_hundredths,0),0))
 FROM public.credit_consumption_requests r WHERE r.wallet_id=w.wallet_id AND r.state<>'settled'),0);
