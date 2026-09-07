import asyncio
import json
from types import SimpleNamespace
import httpx
import pytest
from deep_agent_service import standard_document_tools as document

def runtime():
 return SimpleNamespace(tool_call_id='actual-call',config={'configurable':{'native_runtime':{'bindingId':'00000000-0000-4000-8000-000000000001'},'run_control_callback':{'base_url':'http://gateway','key':'service-secret','org_id':'org','run_id':'run','attempt_id':'run:0','lease_epoch':1}}})

def test_tool_hides_identity_and_rejects_unimplemented_modes_before_dispatch(monkeypatch):
 tool=document.document_parse_tool()
 assert not {'runtime','orgId','bindingId','token'} & set(tool.args)
 monkeypatch.setattr(document.httpx,'AsyncClient',lambda **_:pytest.fail('must not dispatch'))
 for args in ({'workspacePath':'/inputs/a','outputMode':'chunks'},{'workspacePath':'/workspace/not-an-original'}):
  with pytest.raises(document.StandardDocumentError):asyncio.run(document._parse(runtime(),args))

@pytest.mark.parametrize('failure',['status','redirect','oversize','invalid'])
def test_unknown_responses_are_not_retried_and_hide_secrets(monkeypatch,failure):
 seen=[]
 def handle(request):
  seen.append(request)
  return httpx.Response(503 if failure=='status' else 302 if failure=='redirect' else 200,stream=httpx.ByteStream(b'x'*(document._SCHEMA['limits']['responseBytes']+1) if failure=='oversize' else b'{}'))
 original=httpx.AsyncClient
 monkeypatch.setattr(document.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs))
 with pytest.raises(document.StandardDocumentError) as error:asyncio.run(document._parse(runtime(),{'workspacePath':'/inputs/a'}))
 assert 'service-secret' not in str(error.value)
 assert len(seen)==1
 body=json.loads(seen[0].content)
 assert body['toolCallId']=='actual-call' and body['orgId']=='org'
 assert body['bindingId']==runtime().config['configurable']['native_runtime']['bindingId']

def test_ocr_reference_pair_generated_schema():
 import json
 from pathlib import Path
 import jsonschema
 schema=json.loads((Path(__file__).parents[1]/'src/deep_agent_service/generated/standard_document_schema.json').read_text())['output']
 base={'textPath':'/workspace/parsed-12345678-1234-1234-1234-123456789012/document.md','sourceHash':'a'*64,'textHash':'b'*64,'source':{'attachmentId':'a','path':'/inputs/a','mediaType':'application/pdf','sizeBytes':1},'warnings':[]}
 pair={'structurePath':'/workspace/parsed-12345678-1234-1234-1234-123456789012/structure.json','structureHash':'c'*64}
 jsonschema.validate({**base,**pair},schema)
 for key,value in pair.items():
  with pytest.raises(jsonschema.ValidationError):jsonschema.validate({**base,key:value},schema)
