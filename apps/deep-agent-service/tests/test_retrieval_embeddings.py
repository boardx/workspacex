import asyncio
import httpx
import pytest
from deep_agent_service import retrieval_embeddings as module

@pytest.fixture(autouse=True)
def config(monkeypatch):
 monkeypatch.setenv('DEEP_AGENT_SERVICE_INTERNAL_KEY','existing-service-secret')
 monkeypatch.setenv('KERNEL_MODEL_BASE_URL','https://trusted-provider.test/v1')
 monkeypatch.setenv('KERNEL_MODEL_API_KEY','existing-model-secret')
 monkeypatch.setenv('KERNEL_EMBEDDING_MODEL_ID','explicit-embedding')
 monkeypatch.setenv('KERNEL_EMBEDDING_MODEL_VERSION','revision-1')

def test_official_langchain_adapter_uses_explicit_model_and_actual_text(monkeypatch):
 seen=[]
 def provider(request):
  seen.append(request)
  return httpx.Response(200,json={'object':'list','data':[{'object':'embedding','index':0,'embedding':[0.5,0.25]}],'model':'explicit-embedding','usage':{'prompt_tokens':1,'total_tokens':1}})
 async def send(self,request,**kwargs):
  response=provider(request)
  response.request=request
  return response
 monkeypatch.setattr(httpx.AsyncClient,'send',send)
 result=asyncio.run(module.embed_texts(['Actual 中文 source']))
 assert result=={'model':'explicit-embedding','modelVersion':'revision-1','vectors':[[0.5,0.25]]}
 assert len(seen)==1
 assert seen[0].headers['authorization']=='Bearer existing-model-secret'
 assert b'Actual' in seen[0].content

def test_provider_requests_never_exceed_ten_texts(monkeypatch):
 sizes=[]
 async def send(self,request,**kwargs):
  import json as _json
  inputs=_json.loads(request.content)['input']
  sizes.append(len(inputs))
  response=httpx.Response(200,json={'object':'list','data':[{'object':'embedding','index':i,'embedding':[float(len(sizes)),float(i)]} for i in range(len(inputs))],'model':'explicit-embedding','usage':{'prompt_tokens':1,'total_tokens':1}})
  response.request=request
  return response
 monkeypatch.setattr(httpx.AsyncClient,'send',send)
 texts=[f'text {i}' for i in range(module._L['maxBatch'])]
 result=asyncio.run(module.embed_texts(texts))
 assert sizes and max(sizes)<=10 and sum(sizes)==len(texts)
 assert len(result['vectors'])==len(texts)
 assert result['vectors'][10]==[2.0,0.0]

def test_consecutive_requests_reuse_one_pooled_provider_connection(monkeypatch):
 clients=[]
 async def send(self,request,**kwargs):
  clients.append(id(self))
  return httpx.Response(200,json={'data':[{'index':0,'embedding':[0.1,0.2]}],'model':'explicit-embedding','usage':{'prompt_tokens':1,'total_tokens':1}},request=request)
 monkeypatch.setattr(httpx.AsyncClient,'send',send)
 async def run():
  await module.embed_texts(['first'])
  await module.embed_texts(['second'])
 asyncio.run(run())
 # A fresh client per request re-did TCP+TLS every time (~530ms vs ~220ms warm on devapp),
 # blowing the API's 400ms vector recall budget on every turn.
 assert len(clients)==2 and len(set(clients))==1

@pytest.mark.parametrize('body,status',[({'texts':['valid']},200),({'texts':['x'],'model':'override'},400),({'texts':['x'*32769]},400)])
def test_authenticated_route_has_bounded_strict_request(monkeypatch,body,status):
 async def fake(texts):return {'model':'explicit','modelVersion':'1','vectors':[[1,0] for _ in texts]}
 monkeypatch.setattr(module,'embed_texts',fake)
 async def run():
  async with httpx.AsyncClient(transport=httpx.ASGITransport(module.app),base_url='http://local') as client:
   return await client.post('/internal/retrieval/embeddings',json=body,headers={'x-deep-agent-internal-key':'existing-service-secret'})
 assert asyncio.run(run()).status_code==status

def test_unauthenticated_request_never_reaches_provider(monkeypatch):
 async def forbidden(_):pytest.fail('provider must not be called')
 monkeypatch.setattr(module,'embed_texts',forbidden)
 async def run():
  async with httpx.AsyncClient(transport=httpx.ASGITransport(module.app),base_url='http://local') as client:
   return await client.post('/internal/retrieval/embeddings',json={'texts':['source']})
 assert asyncio.run(run()).status_code==401

def test_missing_model_has_no_default_and_no_secret_in_failure(monkeypatch):
 monkeypatch.delenv('KERNEL_EMBEDDING_MODEL_ID')
 with pytest.raises(module.RetrievalEmbeddingUnavailable) as error:asyncio.run(module.embed_texts(['source']))
 assert 'existing-model-secret' not in str(error.value)

def test_provider_stream_limit_closes_transport_before_sdk_json(monkeypatch):
 closed=[]
 class Huge(httpx.AsyncByteStream):
  async def __aiter__(self):
   yield b'x'*module._L['maxResponseBytes']
   yield b'overflow'
  async def aclose(self):closed.append(True)
 async def run():
  response=httpx.Response(200,stream=Huge())
  stream=module._BoundedStream(response)
  async for _ in stream:pass
 with pytest.raises(module.RetrievalEmbeddingUnavailable):asyncio.run(run())
 assert closed

def test_total_route_deadline_cancels_pending_embedding(monkeypatch):
 cancelled=[]
 monkeypatch.setitem(module._L,'deadlineMs',10)
 async def delayed(_):
  try:await asyncio.sleep(10)
  finally:cancelled.append(True)
 monkeypatch.setattr(module,'embed_texts',delayed)
 async def run():
  async with httpx.AsyncClient(transport=httpx.ASGITransport(module.app),base_url='http://local') as client:
   return await client.post('/internal/retrieval/embeddings',json={'texts':['source']},headers={'x-deep-agent-internal-key':'existing-service-secret'})
 response=asyncio.run(run());assert response.status_code==503;assert cancelled
 assert 'existing-model-secret' not in response.text

def test_pooled_connection_outlives_httpx_default_idle_expiry():
 # httpx's 5s default dropped the warm connection between chat turns; the provider keeps it >=90s.
 transport=module._BoundedTransport()
 assert transport.transport._pool._keepalive_expiry==module._KEEPALIVE_S>=60

def test_warm_loop_pings_when_idle_and_stays_silent_when_unconfigured(monkeypatch):
 calls=[]
 async def fake(texts):calls.append(texts)
 monkeypatch.setattr(module,'embed_texts',fake)
 monkeypatch.setattr(module,'_last_provider_use',0.0)
 async def run(seconds):
  task=asyncio.create_task(module.keep_provider_connection_warm(check_every=0.01,idle_after=0))
  await asyncio.sleep(seconds);task.cancel()
 asyncio.run(run(0.05))
 assert calls and calls[0]==['ping']
 calls.clear();monkeypatch.delenv('KERNEL_EMBEDDING_MODEL_ID')
 asyncio.run(run(0.05))
 assert calls==[]

def test_warm_loop_skips_while_connection_recently_used(monkeypatch):
 calls=[]
 async def fake(texts):calls.append(texts)
 monkeypatch.setattr(module,'embed_texts',fake)
 monkeypatch.setattr(module,'_last_provider_use',module.time.monotonic())
 async def run():
  task=asyncio.create_task(module.keep_provider_connection_warm(check_every=0.01,idle_after=60))
  await asyncio.sleep(0.05);task.cancel()
 asyncio.run(run())
 assert calls==[]
