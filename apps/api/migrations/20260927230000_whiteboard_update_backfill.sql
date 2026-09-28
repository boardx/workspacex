-- Permit only a one-way, byte-preserving legacy update-body migration. Row identity,
-- sequence, request hash and receipt fields remain immutable to app_rw; tenant/freeze
-- RLS continues to run because this is not a SECURITY DEFINER operation.
CREATE FUNCTION whiteboard_guard_update_backfill() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE expected_hash text;
BEGIN
  IF current_user <> 'app_rw' THEN RETURN NEW; END IF;
  expected_hash := encode(sha256(OLD.update), 'hex');
  IF OLD.update IS NULL OR OLD.update_object_key IS NOT NULL OR NEW.update IS NOT NULL
    OR NEW.update_hash IS DISTINCT FROM expected_hash
    OR NEW.update_size IS DISTINCT FROM octet_length(OLD.update)::bigint
    OR NEW.update_object_key IS DISTINCT FROM
      ('whiteboards/tenants/' || substr(encode(sha256(convert_to(OLD.org_id,'UTF8')),'hex'),1,32)
       || '/boards/' || OLD.board_id::text || '/epochs/' || OLD.epoch::text
       || '/updates/' || OLD.seq::text || '-' || expected_hash || '.yjs')
  THEN RAISE EXCEPTION 'invalid immutable whiteboard update migration' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION whiteboard_guard_update_backfill() FROM PUBLIC;
CREATE TRIGGER whiteboard_update_backfill_guard BEFORE UPDATE ON whiteboard_updates
FOR EACH ROW EXECUTE FUNCTION whiteboard_guard_update_backfill();
GRANT UPDATE(update,update_object_key,update_hash,update_size) ON whiteboard_updates TO app_rw;
