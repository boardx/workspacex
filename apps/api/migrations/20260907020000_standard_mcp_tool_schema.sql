-- WX-E005: preserve actual discovery schemas; NULL remains legacy/non-executable metadata.
ALTER TABLE mcp_tools ADD COLUMN description text;
ALTER TABLE mcp_tools ADD COLUMN input_schema jsonb CHECK (jsonb_typeof(input_schema)='object');
ALTER TABLE mcp_tools ADD COLUMN output_schema jsonb CHECK (jsonb_typeof(output_schema)='object');
