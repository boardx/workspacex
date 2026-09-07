import asyncio
import pytest
from deep_agent_service.retrieval_rerank import rerank_documents, RetrievalRerankUnavailable

def test_no_model_default(monkeypatch):
    monkeypatch.delenv('KERNEL_RERANK_MODEL_ID',raising=False)
    with pytest.raises(RetrievalRerankUnavailable):
        asyncio.run(rerank_documents('question',[{'id':'a','content':'evidence'}]))

@pytest.mark.parametrize('ranking,valid',[([1,0],True),([0,0],False),([8,0],False),([0],False)])
def test_official_runnable_ranks_actual_documents_and_refuses_invalid_output(monkeypatch,ranking,valid):
    import json
    import httpx
    from deep_agent_service import retrieval_rerank as module
    for key,value in {'KERNEL_MODEL_BASE_URL':'https://trusted.test/v1','KERNEL_MODEL_API_KEY':'private-secret','KERNEL_RERANK_MODEL_ID':'explicit-rank','KERNEL_RERANK_MODEL_VERSION':'1'}.items():monkeypatch.setenv(key,value)
    seen=[]
    async def send(self,request,**kwargs):
        seen.append(request)
        return httpx.Response(200,request=request,json={'id':'test','object':'chat.completion','created':1,'model':'explicit-rank','choices':[{'index':0,'message':{'role':'assistant','content':json.dumps({'ranked_document_ids':ranking})},'finish_reason':'stop'}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}})
    monkeypatch.setattr(httpx.AsyncClient,'send',send)
    async def run():return await module.rerank_documents('question',[{'id':'a','content':'First real source'},{'id':'b','content':'Second real source'}])
    if valid:assert asyncio.run(run())['ids']==['b','a']
    else:
        with pytest.raises(module.RetrievalRerankUnavailable) as error:asyncio.run(run())
        assert 'private-secret' not in str(error.value)
    assert len(seen)==1
    assert b'First real source' in seen[0].content
    assert seen[0].headers['authorization']=='Bearer private-secret'

def test_route_auth_strict_input_and_deadline(monkeypatch):
    import httpx
    from deep_agent_service import retrieval_rerank as module
    from deep_agent_service.retrieval_embeddings import app
    monkeypatch.setenv('DEEP_AGENT_SERVICE_INTERNAL_KEY','internal')
    called=[]
    async def stalled(*_):
        called.append(True)
        await asyncio.sleep(1)
    monkeypatch.setattr(module,'rerank_documents',stalled)
    monkeypatch.setitem(module._L,'deadlineMs',10)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='http://local') as c:
            good={'query':'question','candidates':[{'id':'a','content':'text'}]}
            assert (await c.post('/internal/retrieval/rerank',json=good)).status_code==401
            assert (await c.post('/internal/retrieval/rerank',json={**good,'model':'forged'},headers={'x-deep-agent-internal-key':'internal'})).status_code==400
            assert not called
            assert (await c.post('/internal/retrieval/rerank',json=good,headers={'x-deep-agent-internal-key':'internal'})).status_code==503
    asyncio.run(run())
