ALTER TABLE kg_turn_recalls ADD COLUMN IF NOT EXISTS degraded_channels text[] NOT NULL DEFAULT '{}';
