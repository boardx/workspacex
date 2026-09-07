from deep_agent_service.standard_run_status import run_status_tool
def test_model_schema_cannot_supply_identity():
 tool=run_status_tool();assert tool.name=='wx_run_status';assert set(tool.args_schema['properties'])=={'runId'}
