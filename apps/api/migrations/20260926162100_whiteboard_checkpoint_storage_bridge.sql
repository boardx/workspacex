-- R7's JSON checkpoint manifests predate R8's ObjectStore manifest columns.
-- Promote legacy metadata before the GC migration creates root indexes/functions.
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS manifest jsonb;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS actor_id text;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS version integer;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS epoch integer;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS seq bigint;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS object_key text;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS byte_size bigint;
ALTER TABLE whiteboard_checkpoints ADD COLUMN IF NOT EXISTS created_by text;
UPDATE whiteboard_checkpoints SET version=(manifest->>'version')::integer,epoch=(manifest->>'epoch')::integer,
 seq=(manifest->>'seq')::bigint,object_key=manifest->>'objectKey',content_hash=manifest->>'contentHash',
 byte_size=(manifest->>'byteSize')::bigint,created_by=manifest->>'createdBy'
 WHERE object_key IS NULL AND manifest IS NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN manifest DROP NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN version SET NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN epoch SET NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN seq SET NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN object_key SET NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN content_hash SET NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN byte_size SET NOT NULL;
ALTER TABLE whiteboard_checkpoints ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE whiteboard_recovery_events DROP CONSTRAINT IF EXISTS whiteboard_recovery_events_event_type_check;
ALTER TABLE whiteboard_recovery_events ADD CONSTRAINT whiteboard_recovery_events_event_type_check CHECK(event_type IN('CheckpointCreated','BoardRestored','CheckpointFallbackUsed'));
ALTER TABLE whiteboard_checkpoints DROP CONSTRAINT IF EXISTS whiteboard_checkpoint_manifest_columns_guard;
ALTER TABLE whiteboard_checkpoints ADD CONSTRAINT whiteboard_checkpoint_manifest_columns_guard CHECK(
 version=1 AND epoch>0 AND seq BETWEEN 0 AND 9007199254740991
 AND content_hash ~ '^sha256:[a-f0-9]{64}$' AND byte_size BETWEEN 1 AND 33554432
);
-- Preserve R7 restore receipts exposed through its durable audit event, so a
-- retry after the epoch changes remains a replay rather than a stale-head error.
INSERT INTO whiteboard_recovery_events(org_id,board_id,event_id,event_type,actor_id,epoch,checkpoint_id,event,occurred_at)
 SELECT e.org_id,e.board_id,e.event_id,e.event_type,e.actor_id,
 COALESCE((e.payload->>'epoch')::integer,(r.response->>'epoch')::integer),
 COALESCE(e.payload->>'checkpointId',e.payload->>'requestedCheckpointId')::uuid,e.payload,
 (e.payload->>'occurredAt')::timestamptz
 FROM whiteboard_collaboration_events e
 LEFT JOIN whiteboard_restore_requests r ON r.org_id=e.org_id AND r.board_id=e.board_id
 AND r.actor_id=e.actor_id AND r.request_id::text=e.payload->>'operationId'
 WHERE e.event_type IN('CheckpointCreated','BoardRestored','CheckpointFallbackUsed')
 ON CONFLICT(org_id,board_id,event_id) DO NOTHING;
