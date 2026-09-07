import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service import standard_subtask_tools as task

def args():return {'description':'Summarize authorized source','contextRefs':[json.dumps({'sourceId':'chat-attachment:source','versionId':'sha256:source'})],'idempotencyKey':'logical-one'}
def runtime():return SimpleNamespace(tool_call_id='actual-call',config={'configurable':{'native_runtime':{'bindingId':'00000000-0000-4000-8000-000000000001'},'run_control_callback':{'base_url':'http://gateway','key':'service-secret','org_id':'org','run_id':'run','attempt_id':'run:0','lease_epoch':1}}})
def test_model_cannot_override_identity(monkeypatch):
 tool=task.spawn_async_task_tool();assert not {'runtime','orgId','bindingId','token','toolCallId'} & set(tool.args)
 monkeypatch.setattr(task.httpx,'AsyncClient',lambda **_:pytest.fail('must not dispatch'))
 for extra in ({'orgId':'forged'},{'toolCallId':'forged'}):
  with pytest.raises(task.StandardSubtaskError):asyncio.run(task._parse(runtime(),{**args(),**extra}))
@pytest.mark.parametrize('status,body',[(503,b'{}'),(302,b'{}'),(200,b'x'*16385),(200,b'{}')])
def test_failure_bounded_without_retry_or_secrets(monkeypatch,status,body):
 seen=[]
 def handle(request):seen.append(request);return httpx.Response(status,stream=httpx.ByteStream(body))
 original=httpx.AsyncClient;monkeypatch.setattr(task.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 with pytest.raises(task.StandardSubtaskError) as error:asyncio.run(task._parse(runtime(),args()))
 assert 'service-secret' not in str(error.value);assert len(seen)==1
 sent=json.loads(seen[0].content);assert sent['toolCallId']=='actual-call' and sent['orgId']=='org';assert seen[0].url.path=='/internal/agent-runs/run/subtasks/spawn'
def test_replay_status_is_not_rewritten_as_queued(monkeypatch):
 original=httpx.AsyncClient
 monkeypatch.setattr(task.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(lambda _:httpx.Response(200,stream=httpx.ByteStream(b'{"childRunId":"child","status":"completed"}'))),**kwargs))
 assert asyncio.run(task._parse(runtime(),args()))=={'childRunId':'child','status':'completed'}
