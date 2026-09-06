-- The existing FIFO is authoritative. Journal projection is transactional, not an API side effect.
CREATE OR REPLACE FUNCTION workbench_journal_interjection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status<>'applied') THEN RETURN NEW; END IF;
 PERFORM id FROM agent_runs WHERE org_id=NEW.org_id AND id=NEW.run_id FOR UPDATE;
 SELECT COALESCE(MAX(seq)+1,0) INTO n FROM agent_execution_events WHERE org_id=NEW.org_id AND run_id=NEW.run_id;
 INSERT INTO agent_execution_events(org_id,run_id,seq,payload,created_at) VALUES(NEW.org_id,NEW.run_id,n,
  jsonb_build_object('kind','interjection','interjectionId',NEW.interjection_id,'text',NEW.text,'status',CASE WHEN NEW.status='applied' THEN 'applied' ELSE 'received' END),
  CASE WHEN NEW.status='applied' THEN NEW.applied_at ELSE NEW.received_at END);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workbench_interjection_journal ON agent_run_interjections;
CREATE TRIGGER workbench_interjection_journal AFTER INSERT OR UPDATE OF status ON agent_run_interjections FOR EACH ROW EXECUTE FUNCTION workbench_journal_interjection();
CREATE OR REPLACE FUNCTION workbench_journal_unapplied_interjections() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record; n integer;
BEGIN
 IF NEW.status NOT IN('succeeded','failed','cancelled') THEN RETURN NEW; END IF;
 FOR item IN SELECT * FROM agent_run_interjections WHERE org_id=NEW.org_id AND run_id=NEW.id AND status<>'applied' ORDER BY sequence LOOP
  SELECT COALESCE(MAX(seq)+1,0) INTO n FROM agent_execution_events WHERE org_id=NEW.org_id AND run_id=NEW.id;
  INSERT INTO agent_execution_events(org_id,run_id,seq,payload) VALUES(NEW.org_id,NEW.id,n,
    jsonb_build_object('kind','interjection','interjectionId',item.interjection_id,'text',item.text,'status','not_applied'));
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workbench_unapplied_interjections ON agent_runs;
CREATE TRIGGER workbench_unapplied_interjections AFTER UPDATE OF status ON agent_runs FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION workbench_journal_unapplied_interjections();
