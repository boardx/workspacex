import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service import standard_image_tools as image

def args():return {'prompt':'A square picture','sizeProfile':'square','idempotencyKey':'one-intent'}
def runtime():return SimpleNamespace(tool_call_id='actual-call',config={'configurable':{'native_runtime':{'bindingId':'00000000-0000-4000-8000-000000000001'},'run_control_callback':{'base_url':'http://gateway','key':'service-secret','org_id':'org','run_id':'run','attempt_id':'run:0','lease_epoch':1}}})
def test_image_tool_uses_catalog_args_and_trusted_identity(monkeypatch):
 tool=image.image_generate_tool();assert {'prompt','referenceAttachmentIds','sizeProfile','idempotencyKey'}==set(tool.args)
 monkeypatch.setattr(image.httpx,'AsyncClient',lambda **_:pytest.fail('must not dispatch'))
 for extra in ({'orgId':'forged'},{'referencePaths':['/secret']},{'sizeProfile':'wide'}):
  with pytest.raises(image.StandardImageError):asyncio.run(image._parse(runtime(),{**args(),**extra}))
@pytest.mark.parametrize('status,body',[(503,b'{}'),(302,b'{}'),(200,b'x'*32769),(200,b'{}')])
def test_failure_has_no_retry_or_vendor_secret(monkeypatch,status,body):
 seen=[]
 def handle(request):seen.append(request);return httpx.Response(status,stream=httpx.ByteStream(body))
 original=httpx.AsyncClient;monkeypatch.setattr(image.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 with pytest.raises(image.StandardImageError) as error:asyncio.run(image._parse(runtime(),args()))
 assert 'service-secret' not in str(error.value);assert len(seen)==1
 assert json.loads(seen[0].content)['toolCallId']=='actual-call'
