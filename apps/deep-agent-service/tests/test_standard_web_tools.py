import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service import standard_web_tools as web

def runtime():
 return SimpleNamespace(tool_call_id='actual-call',config={'configurable':{'run_control_callback':{'base_url':'http://gateway','key':'service-secret','org_id':'org','run_id':'run','attempt_id':'run:0','lease_epoch':2}}})

def test_official_tool_schemas_hide_runtime_identity():
 for tool in web.standard_web_tools():
  assert 'runtime' not in tool.args
  assert 'orgId' not in tool.args
  assert 'token' not in tool.args
 assert [tool.name for tool in web.standard_web_tools()]==['web_search','fetch_url']

@pytest.mark.parametrize('failure',['status','redirect','oversize','invalid'])
def test_gateway_failures_are_bounded_and_secret_free(monkeypatch,failure):
 seen=[]
 def handle(request):
  seen.append(request)
  return httpx.Response(503 if failure=='status' else 302 if failure=='redirect' else 200,stream=httpx.ByteStream(b'x'*(web._SCHEMA['limits']['maxResponseBytes']+1) if failure=='oversize' else b'{}'))
 original=httpx.AsyncClient
 monkeypatch.setattr(web.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 with pytest.raises(web.StandardWebError) as error:asyncio.run(web._invoke('fetch_url',{'url':'https://example.com'},runtime()))
 assert 'service-secret' not in str(error.value)
 assert len(seen)==1
 assert json.loads(seen[0].content)['toolCallId']=='actual-call'
 assert json.loads(seen[0].content)['orgId']=='org'


def test_unsupported_time_filter_never_dispatches(monkeypatch):
 monkeypatch.setattr(web.httpx,'AsyncClient',lambda **_:pytest.fail('must not dispatch'))
 with pytest.raises(web.StandardWebError):asyncio.run(web._invoke('web_search',{'query':'a','timeRange':{'from':'2020'}},runtime()))
