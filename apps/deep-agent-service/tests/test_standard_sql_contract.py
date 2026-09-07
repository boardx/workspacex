"""No database needed for metadata and upstream compatibility failures."""
import asyncio
import pytest
from langchain_core.language_models.fake import FakeListLLM
from deep_agent_service.standard_sql import standard_sql_tools
from deep_agent_service import standard_sql_database as database


def test_metadata_keeps_official_names_and_hides_authority_identity():
    tools=standard_sql_tools(FakeListLLM(responses=['SELECT 1']))
    assert {tool.name for tool in tools}=={'sql_db_list_tables','sql_db_schema','sql_db_query','sql_db_query_checker'}
    for tool in tools:
        assert tool.args_schema['additionalProperties'] is False
        assert not {'dsn','runtime','orgId','userId','dataSourceId'} & set(tool.args_schema['properties'])


def test_unknown_upstream_refused_before_engine_and_slot_released(monkeypatch):
    monkeypatch.setattr(database,'version',lambda _: 'unknown')
    monkeypatch.setattr(database,'create_async_engine',lambda *a,**k:pytest.fail('engine opened for unknown upstream'))
    with pytest.raises(database.StandardSqlError,match='upstream_requires_review'):
        asyncio.run(database.call_sql_database({},'sql_db_list_tables',{},FakeListLLM(responses=['unused'])))
    assert database._SLOTS._value==8


def test_changed_upstream_source_refused(monkeypatch):
    monkeypatch.setitem(database._UPSTREAM,'databaseSourceSha256','0'*64)
    monkeypatch.setattr(database,'create_async_engine',lambda *a,**k:pytest.fail('engine opened for modified source'))
    with pytest.raises(database.StandardSqlError,match='upstream_requires_review'):
        asyncio.run(database.call_sql_database({},'sql_db_list_tables',{},FakeListLLM(responses=['unused'])))
    assert database._SLOTS._value==8
