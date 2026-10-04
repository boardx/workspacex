"""Actual SDK→httpx transport accounting; no database, provider or model download."""
import asyncio
import json
import httpx
import pytest
from deep_agent_service import model_request_accounting as accounting
from deep_agent_service import retrieval_embeddings as embeddings
from deep_agent_service import retrieval_rerank as rerank

REF={"orgId":"org-A","runId":"run-A","attemptId":"run-A:0","leaseEpoch":1}
@pytest.fixture
def wired(monkeypatch,tmp_path):
    for key,value in {"DEEP_AGENT_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED":"1","DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED":"1",
                      "DEEP_AGENT_USAGE_CALLBACK_BASE_URL":"http://api.example.test","DEEP_AGENT_SERVICE_INTERNAL_KEY":"fixture-secret",
                      "DEEP_AGENT_USAGE_SPOOL_DIR":str(tmp_path),"KERNEL_MODEL_BASE_URL":"http://vendor.example.test/v1",
                      "KERNEL_MODEL_API_KEY":"provider-secret","KERNEL_EMBEDDING_MODEL_ID":"actual-embedding",
                      "KERNEL_EMBEDDING_MODEL_VERSION":"v1","KERNEL_RERANK_MODEL_ID":"actual-rerank","KERNEL_RERANK_MODEL_VERSION":"v1"}.items():
        monkeypatch.setenv(key,value)
    monkeypatch.delenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED",raising=False)
    monkeypatch.setattr(accounting,"_durability_fault",False)
    monkeypatch.setattr(embeddings,"_CLIENT",None)
    monkeypatch.setattr(embeddings,"_CLIENT_LOOP",None)
    callbacks=[];paid=[]
    async def post(owner,run,phase,body):
        callbacks.append((owner["org_id"],run,phase,dict(body)))
    monkeypatch.setattr(accounting,"apost",post)
    async def vendor(request):
        raw=json.loads(request.content);paid.append((accounting.ownership()["org_id"],raw))
        assert callbacks[-1][2] in ("start","admit")
        await asyncio.sleep(0)
        def respond(payload):
            return httpx.Response(200,request=request,headers={"content-type":"application/json"},stream=httpx.ByteStream(json.dumps(payload).encode()))
        if request.url.path.endswith("embeddings"):
            values=raw["input"]
            return respond({"object":"list","model":"actual-embedding",
               "data":[{"object":"embedding","index":i,"embedding":[1.0,0.0]} for i in range(len(values))],
               "usage":{"prompt_tokens":len(values),"total_tokens":len(values)}})
        return respond({"id":"chat","object":"chat.completion","created":1,"model":"actual-rerank",
          "choices":[{"index":0,"message":{"role":"assistant","content":json.dumps({"ranked_document_ids":[0]})},"finish_reason":"stop"}],
          "usage":{"total_tokens":3,"prompt_tokens":2,"completion_tokens":1}})
    monkeypatch.setattr(embeddings,"_BoundedTransport",lambda:httpx.MockTransport(vendor))
    return callbacks,paid,tmp_path

def test_embedding_sdk_batches_have_per_http_ids_and_report_only_actual_input_usage(wired):
    callbacks,paid,path=wired
    result=asyncio.run(embeddings.embed_texts(["transient-source"]*11,REF))
    assert len(result["vectors"])==11 and len(paid)==2
    starts=[c for c in callbacks if c[2]=="start"];terminals=[c for c in callbacks if c[2]=="terminal"]
    assert len(starts)==len(terminals)==2
    assert len({c[3]["requestId"] for c in starts})==2
    assert {c[3]["requestId"] for c in starts}=={c[3]["requestId"] for c in terminals}
    assert all(c[3]["callPurpose"]=="retrieval-embedding" for c in starts)
    assert sum(c[3]["usage"]["total"] for c in terminals)==11
    assert all("completion" not in c[3]["usage"] for c in terminals) # no invented zero or price
    journal=accounting.Journal(str(path))
    with journal.connect() as db:assert db.execute("SELECT count(*) FROM pending").fetchone()[0]==0
    assert accounting._scoped_owner.get() is None

def test_rerank_actual_sdk_call_uses_same_ledger_receipt_protocol(wired):
    callbacks,paid,_=wired
    result=asyncio.run(rerank.rerank_documents("query",[{"id":"a","content":"transient-evidence"}],REF))
    assert result["ids"]==["a"] and len(paid)==1
    assert [c[2] for c in callbacks]==["start","terminal"]
    assert callbacks[0][3]["callPurpose"]=="retrieval-rerank"
    assert callbacks[1][3]["usage"]=={"total":3,"prompt":2,"completion":1}
    assert "transient-evidence" not in json.dumps(callbacks)

def test_unowned_service_warmup_or_forged_reference_never_dispatches(wired):
    _,paid,_=wired
    for reference in (None,REF|{"userId":"invented"},REF|{"leaseEpoch":0}):
        with pytest.raises(accounting.RuntimeUsageError):asyncio.run(embeddings.embed_texts(["ping"],reference))
    assert paid==[] and accounting._scoped_owner.get() is None

def test_ack_denial_prevents_real_vendor_and_concurrent_contexts_do_not_leak(wired,monkeypatch):
    callbacks,paid,_=wired
    original=accounting.apost
    async def deny(*args):raise accounting.RuntimeUsageError("denied")
    monkeypatch.setattr(accounting,"apost",deny)
    with pytest.raises(embeddings.RetrievalEmbeddingUnavailable):asyncio.run(embeddings.embed_texts(["source"],REF))
    assert paid==[]
    monkeypatch.setattr(accounting,"apost",original)
    async def run():
        return await asyncio.gather(embeddings.embed_texts(["one"],REF),embeddings.embed_texts(["two"],REF|{"orgId":"org-B","runId":"run-B","attemptId":"run-B:0"}))
    asyncio.run(run())
    assert {p[0] for p in paid}=={"org-A","org-B"}
    assert {(c[0],c[1]) for c in callbacks}=={("org-A","run-A"),("org-B","run-B")}
    assert accounting._scoped_owner.get() is None

def test_embedding_admission_without_verified_input_only_mode_is_safe_hard_stop(wired,monkeypatch):
    _,paid,_=wired;monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    with pytest.raises(embeddings.RetrievalEmbeddingUnavailable):asyncio.run(embeddings.embed_texts(["source"],REF))
    assert paid==[]

def test_rerank_admission_requires_explicit_output_cap_and_no_sdk_retry(wired,monkeypatch):
    callbacks,paid,_=wired;monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    with pytest.raises(rerank.RetrievalRerankUnavailable):asyncio.run(rerank.rerank_documents("query",[{"id":"a","content":"source"}],REF))
    assert paid==[]
    monkeypatch.setenv("KERNEL_RERANK_MAX_OUTPUT_TOKENS","7")
    asyncio.run(rerank.rerank_documents("query",[{"id":"a","content":"source"}],REF))
    assert len(paid)==1 and [c[2] for c in callbacks]==["admit","terminal"]
    assert callbacks[0][3]["outputTokenLimit"]==7 and paid[0][1].get("max_tokens",paid[0][1].get("max_completion_tokens"))==7

def test_missing_vendor_usage_stays_unknown(wired,monkeypatch):
    callbacks,paid,_=wired
    async def vendor(request):
        paid.append(request)
        payload={"object":"list","model":"actual-embedding","data":[{"object":"embedding","index":0,"embedding":[1.0,0.0]}]}
        return httpx.Response(200,request=request,headers={"content-type":"application/json"},stream=httpx.ByteStream(json.dumps(payload).encode()))
    monkeypatch.setattr(embeddings,"_BoundedTransport",lambda:httpx.MockTransport(vendor))
    asyncio.run(embeddings.embed_texts(["source"],REF))
    assert len(paid)==1 and [c[2] for c in callbacks]==["start","terminal"]
    assert callbacks[-1][3]["usage"]=={}

def test_vendor_failure_has_one_failed_receipt_without_sdk_retry(wired,monkeypatch):
    callbacks,paid,_=wired
    async def vendor(request):
        paid.append(request)
        return httpx.Response(503,request=request,headers={"content-type":"application/json"},stream=httpx.ByteStream(b'{"error":{"message":"unavailable"}}'))
    monkeypatch.setattr(embeddings,"_BoundedTransport",lambda:httpx.MockTransport(vendor))
    with pytest.raises(embeddings.RetrievalEmbeddingUnavailable):asyncio.run(embeddings.embed_texts(["source"],REF))
    assert len(paid)==1 and [c[2] for c in callbacks]==["start","terminal"]
    assert callbacks[-1][3]["outcome"]=="failed" and callbacks[-1][3]["usage"]=={}

def test_cancel_and_callback_outage_keep_durable_terminal_and_restore_context(wired,monkeypatch):
    callbacks,paid,path=wired
    async def vendor(request):
        paid.append(request)
        raise asyncio.CancelledError()
    async def post(owner,run,phase,body):
        callbacks.append((owner["org_id"],run,phase,dict(body)))
        if phase=="terminal":raise accounting.RuntimeUsageError("callback unavailable")
    monkeypatch.setattr(embeddings,"_BoundedTransport",lambda:httpx.MockTransport(vendor))
    monkeypatch.setattr(accounting,"apost",post)
    with pytest.raises(asyncio.CancelledError):asyncio.run(embeddings.embed_texts(["private-source"],REF))
    assert len(paid)==1 and [c[2] for c in callbacks]==["start","terminal"]
    pending=accounting.Journal(str(path)).pending({"base_url":"http://api.example.test"})
    assert len(pending)==1 and json.loads(pending[0][2])["outcome"]=="failed"
    assert "private-source" not in json.dumps(pending) and "fixture-secret" not in json.dumps(pending)
    assert accounting._scoped_owner.get() is None
