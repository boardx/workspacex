import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service import standard_skill_draft as draft

def args():return {'stableName':'example','name':'Example','description':'Example description','semanticVersion':'1.0.0','files':[{'workspacePath':'/workspace/SKILL.md','packagePath':'SKILL.md'}],'inputSchema':{},'outputSchema':{},'dependencies':[]}
def runtime():return SimpleNamespace(tool_call_id='actual-call',config={'configurable':{'native_runtime':{'bindingId':'00000000-0000-4000-8000-000000000001'},'run_control_callback':{'base_url':'http://gateway','key':'service-secret','org_id':'org','run_id':'run','attempt_id':'run:0','lease_epoch':1}}})
def test_identity_and_call_id_are_trusted_not_model_fields(monkeypatch):
 tool=draft.skill_draft_tool();assert not {'runtime','orgId','bindingId','token','idempotencyKey'} & set(tool.args)
 monkeypatch.setattr(draft.httpx,'AsyncClient',lambda **_:pytest.fail('must not dispatch'))
 for extra in ({'orgId':'forged'},{'toolCallId':'forged'},{'idempotencyKey':'forged'}):
  with pytest.raises(draft.SkillDraftError):asyncio.run(draft._parse(runtime(),{**args(),**extra}))
@pytest.mark.parametrize('status,body',[(503,b'{}'),(302,b'{}'),(200,b'x'*32769),(200,b'{}')])
def test_failure_is_bounded_not_retried_and_has_no_secret(monkeypatch,status,body):
 seen=[]
 def handle(request):seen.append(request);return httpx.Response(status,stream=httpx.ByteStream(body))
 original=httpx.AsyncClient;monkeypatch.setattr(draft.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 with pytest.raises(draft.SkillDraftError) as error:asyncio.run(draft._parse(runtime(),args()))
 assert 'service-secret' not in str(error.value);assert len(seen)==1
 sent=json.loads(seen[0].content);assert sent['toolCallId']=='actual-call' and sent['orgId']=='org';assert seen[0].url.path=='/internal/agent-runs/run/skill-draft'
