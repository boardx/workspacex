from deep_agent_service.standard_run_cancel import run_cancel_tool
def test_cancel_model_schema_has_no_identity():
 tool=run_cancel_tool();assert tool.name=='wx_run_cancel';assert set(tool.args_schema['properties'])=={'runId','reason','idempotencyKey'}
