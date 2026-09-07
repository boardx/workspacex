from deep_agent_service.standard_schedule import standard_schedule_tools

def test_model_schemas_have_root_objects_and_no_identity_fields():
    tools=standard_schedule_tools()
    assert {t.name for t in tools}=={'wx_schedule_create','wx_schedule_list','wx_schedule_cancel'}
    for tool in tools:
        assert tool.args_schema['type']=='object'
        assert tool.args_schema['additionalProperties'] is False
        assert not {'orgId','userId','runtime','threadId','agentId','callback'}&set(tool.args_schema['properties'])
