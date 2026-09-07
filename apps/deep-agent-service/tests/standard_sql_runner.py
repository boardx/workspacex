import asyncio
import json
import os
import sys
from unittest.mock import patch
from langchain_core.language_models.fake import FakeListLLM
from langchain_core.messages import AIMessage
from langgraph.graph import StateGraph,MessagesState,START,END
from langgraph.prebuilt import ToolNode
from deep_agent_service.standard_sql import standard_sql_tools
from test_standard_sql_database import source as source_fixture

config=json.load(sys.stdin)
fixture=source_fixture.__wrapped__();source=next(fixture)
os.environ['STANDARD_SQL_SOURCES']=json.dumps({'readonly':source})
try:
    model=FakeListLLM(responses=['SELECT count(*) FROM allowed'])
    graph=StateGraph(MessagesState)
    graph.add_node('tools',ToolNode(standard_sql_tools(model),handle_tool_errors=False));graph.add_edge(START,'tools');graph.add_edge('tools',END)
    compiled=graph.compile()
    def invoke(name,args,asynchronous=False):
        state={'messages':[AIMessage(content='',tool_calls=[{'id':'actual-'+name,'name':name,'args':args}])]}
        output=asyncio.run(compiled.ainvoke(state,config)) if asynchronous else compiled.invoke(state,config)
        value=output['messages'][-1].content
        try:return json.loads(value)
        except json.JSONDecodeError:return value
    with patch('deep_agent_service.standard_sql_database.create_async_engine',side_effect=AssertionError('checker opened DB')):
        checked=invoke('sql_db_query_checker',{'query':'SELEC count(*) FROM allowed'},True)
    listed=invoke('sql_db_list_tables',{})
    schema=invoke('sql_db_schema',{'table_names':'allowed'},True)
    queried=invoke('sql_db_query',{'query':checked},True)
    print(json.dumps({'checked':checked,'tables':listed,'schema':schema,'query':queried}))
finally:
    try:next(fixture)
    except StopIteration:pass
