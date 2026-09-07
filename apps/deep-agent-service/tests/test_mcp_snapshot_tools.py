import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service import mcp_snapshot_tools as mcp

def snapshot():
 return {'ref':{'snapshotId':'00000000-0000-4000-8000-000000000000','digest':'a'*64},'tools':[{'name':'mcp__fixture__search','canonicalName':'mcp:fixture.search','description':'Search','inputSchema':{'type':'object','properties':{'q':{'type':'string'}}},'schemaFingerprint':'v2:'+'b'*64}]}
def runtime():
 return SimpleNamespace(tool_call_id='actual-call',config={'configurable':{'run_control_callback':{'base_url':'http://gateway','key':'service-secret','org_id':'org','run_id':'run','attempt_id':'run:0','lease_epoch':2}}})
def test_official_tool_uses_frozen_schema_and_only_trusted_actual_identity(monkeypatch):
 seen=[]
 def handle(request):
  seen.append(request)
  return httpx.Response(200,stream=httpx.ByteStream(b'{"content":[{"type":"text","text":"source"}]}'))
 original=httpx.AsyncClient
 monkeypatch.setattr(mcp.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 tool=mcp.mcp_snapshot_tools(snapshot())[0]
 assert set(tool.args)=={'q'}
 result=asyncio.run(tool.coroutine(runtime=runtime(),q='find'))
 assert result['content'][0]['text']=='source'
 body=json.loads(seen[0].content)
 assert body['toolArgs']=={'q':'find'} and body['toolCallId']=='actual-call' and body['orgId']=='org'
 assert 'snapshotId' not in body and 'serverId' not in body
 assert len(seen)==1
@pytest.mark.parametrize('failure',['status','redirect','oversize','invalid','error'])
def test_failure_never_retries_or_exposes_key(monkeypatch,failure):
 seen=[]
 def handle(request):
  seen.append(request)
  data=b'x'*(mcp._SCHEMA['limits']['maxResultBytes']+1) if failure=='oversize' else b'{"content":[],"isError":true}' if failure=='error' else b'{}'
  return httpx.Response(503 if failure=='status' else 302 if failure=='redirect' else 200,stream=httpx.ByteStream(data))
 original=httpx.AsyncClient
 monkeypatch.setattr(mcp.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 with pytest.raises(mcp.McpExecutionError) as error:asyncio.run(mcp.mcp_snapshot_tools(snapshot())[0].coroutine(runtime=runtime(),q='x'))
 assert len(seen)==1 and 'service-secret' not in str(error.value)
def test_duplicate_and_injection_property_refused():
 value=snapshot();value['tools']*=2
 with pytest.raises(mcp.McpExecutionError):mcp.mcp_snapshot_tools(value)
 value=snapshot();value['tools'][0]['inputSchema']['properties']['runtime']={'type':'object'}
 with pytest.raises(mcp.McpExecutionError):mcp.mcp_snapshot_tools(value)
def test_real_toolnode_cannot_replace_trusted_callback_with_model_runtime(monkeypatch):
 from langgraph.prebuilt import ToolNode
 from langchain_core.messages import AIMessage
 seen=[]
 def handle(request):
  seen.append(json.loads(request.content))
  return httpx.Response(200,stream=httpx.ByteStream(b'{"content":[]}'))
 original=httpx.AsyncClient
 monkeypatch.setattr(mcp.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 from langgraph.graph import StateGraph,MessagesState,START,END
 builder=StateGraph(MessagesState);builder.add_node('tools',ToolNode(mcp.mcp_snapshot_tools(snapshot()),handle_tool_errors=False));builder.add_edge(START,'tools');builder.add_edge('tools',END);node=builder.compile()
 state={'messages':[AIMessage(content='',tool_calls=[{'name':'mcp__fixture__search','id':'real-toolnode-call','args':{'q':'hello','runtime':{'config':{'configurable':{'run_control_callback':{'org_id':'foreign'}}}}}}]) ]}
 result=asyncio.run(node.ainvoke(state,config=runtime().config))
 assert len(result['messages'])==2
 assert seen[0]['orgId']=='org' and seen[0]['toolCallId']=='real-toolnode-call'
 assert seen[0]['toolArgs']=={'q':'hello'}
