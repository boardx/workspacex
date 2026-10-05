-- Preserve immutable native billing identity independently of rounded monetary bounds.
ALTER TABLE ai_request_reservations ADD COLUMN IF NOT EXISTS billing_kind text NOT NULL DEFAULT 'token';
ALTER TABLE ai_request_reservations ADD COLUMN IF NOT EXISTS native_unit text;
ALTER TABLE ai_request_reservations ADD COLUMN IF NOT EXISTS max_native_quantity bigint;
ALTER TABLE ai_request_reservations ADD CONSTRAINT ai_native_reservation_shape CHECK (
 (billing_kind='token' AND native_unit IS NULL AND max_native_quantity IS NULL) OR
 (billing_kind='native' AND native_unit IN ('image','pixel','millisecond','microsecond','character','request')
  AND native_unit IS NOT NULL AND max_native_quantity IS NOT NULL AND max_native_quantity>0 AND maximum_tokens=0));
CREATE FUNCTION enforce_ai_native_reservation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.billing_kind IS DISTINCT FROM OLD.billing_kind OR NEW.native_unit IS DISTINCT FROM OLD.native_unit
  OR NEW.max_native_quantity IS DISTINCT FROM OLD.max_native_quantity THEN
  RAISE EXCEPTION 'AI_NATIVE_RESERVATION_IDENTITY_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_native_reservation_identity_immutable BEFORE UPDATE ON ai_request_reservations
 FOR EACH ROW EXECUTE FUNCTION enforce_ai_native_reservation_identity();
