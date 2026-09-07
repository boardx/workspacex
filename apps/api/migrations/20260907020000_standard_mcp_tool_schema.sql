-- WX-E005: preserve actual discovery schemas; NULL remains legacy/non-executable metadata.
ALTER TABLE mcp_tools ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE mcp_tools ADD COLUMN IF NOT EXISTS input_schema jsonb CHECK (jsonb_typeof(input_schema)='object');
ALTER TABLE mcp_tools ADD COLUMN IF NOT EXISTS output_schema jsonb CHECK (jsonb_typeof(output_schema)='object');
