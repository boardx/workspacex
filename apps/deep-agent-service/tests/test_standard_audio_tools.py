import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service import standard_audio_tools as audio

def args():return {'attachmentId':'original'}
def runtime():return SimpleNamespace(tool_call_id='actual-call',config={'configurable':{'native_runtime':{'bindingId':'00000000-0000-4000-8000-000000000001'},'run_control_callback':{'base_url':'http://gateway','key':'service-secret','org_id':'org','run_id':'run','attempt_id':'run:0','lease_epoch':1}}})
def test_audio_tool_uses_catalog_args_and_trusted_identity(monkeypatch):
 tool=audio.audio_transcribe_tool();assert {'attachmentId','language','diarization'}==set(tool.args)
 monkeypatch.setattr(audio.httpx,'AsyncClient',lambda **_:pytest.fail('must not dispatch'))
 for extra in ({'orgId':'forged'},{'sourceUrl':'https://secret'},{'diarization':'yes'}):
  with pytest.raises(audio.StandardAudioError):asyncio.run(audio._parse(runtime(),{**args(),**extra}))
@pytest.mark.parametrize('status,body',[(503,b'{}'),(302,b'{}'),(200,b'x'*270337),(200,b'{}')])
def test_failure_has_no_retry_or_vendor_secret(monkeypatch,status,body):
 seen=[]
 def handle(request):seen.append(request);return httpx.Response(status,stream=httpx.ByteStream(body))
 original=httpx.AsyncClient;monkeypatch.setattr(audio.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 with pytest.raises(audio.StandardAudioError) as error:asyncio.run(audio._parse(runtime(),args()))
 assert 'service-secret' not in str(error.value);assert len(seen)==1
 assert json.loads(seen[0].content)['toolCallId']=='actual-call'
