import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service import standard_canvas_tools as web

def runtime():
 return SimpleNamespace(tool_call_id='actual-call',config={'configurable':{'run_control_callback':{'base_url':'http://gateway','key':'service-secret','org_id':'org','run_id':'run','attempt_id':'run:0','lease_epoch':2}}})

def test_official_tool_schemas_hide_runtime_identity():
 for tool in web.standard_canvas_tools():
  assert 'runtime' not in tool.args
  assert 'orgId' not in tool.args
  assert 'token' not in tool.args
 assert [tool.name for tool in web.standard_canvas_tools()]==['wx_canvas_read','wx_canvas_update']

@pytest.mark.parametrize('failure',['status','redirect','oversize','invalid'])
def test_gateway_failures_are_bounded_and_secret_free(monkeypatch,failure):
 seen=[]
 def handle(request):
  seen.append(request)
  return httpx.Response(503 if failure=='status' else 302 if failure=='redirect' else 200,stream=httpx.ByteStream(b'x'*(web._SCHEMA['limits']['maxResponseBytes']+1) if failure=='oversize' else b'{}'))
 original=httpx.AsyncClient
 monkeypatch.setattr(web.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 with pytest.raises(web.StandardCanvasError) as error:asyncio.run(web._invoke('wx_canvas_read',{'canvasId':'canvas'},runtime()))
 assert 'service-secret' not in str(error.value)
 assert len(seen)==1
 assert json.loads(seen[0].content)['toolCallId']=='actual-call'
 assert json.loads(seen[0].content)['orgId']=='org'


def test_unsupported_time_filter_never_dispatches(monkeypatch):
 monkeypatch.setattr(web.httpx,'AsyncClient',lambda **_:pytest.fail('must not dispatch'))
 with pytest.raises(web.StandardCanvasError):asyncio.run(web._invoke('wx_canvas_update',{'canvasId':'canvas','expectedRevision':1,'changes':{'kind':'pixel-edit'},'idempotencyKey':'same'},runtime()))

def test_update_tool_preserves_conflict_without_reading_or_leaking_response(monkeypatch):
 calls=[]
 def handle(request):
  calls.append(request)
  return httpx.Response(409,stream=httpx.ByteStream(b'service-secret internal SQL detail'))
 original=httpx.AsyncClient
 monkeypatch.setattr(web.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 tool=next(t for t in web.standard_canvas_tools() if t.name=='wx_canvas_update')
 with pytest.raises(web.StandardCanvasError,match='^canvas_revision_or_idempotency_conflict$'):
  asyncio.run(tool.coroutine(runtime=runtime(),canvasId='canvas',expectedRevision=1,changes={'kind':'replace-source','markdown':'source'},idempotencyKey='stable'))
 assert len(calls)==1
