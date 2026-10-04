import asyncio
import json
import sqlite3
import httpx
import pytest
from deep_agent_service import model_request_accounting as a

ORIGINAL_OWNERSHIP=a.ownership
OWNER={"base_url":"http://api.example.test","key":"fixture-secret-must-not-persist","org_id":"org-A","run_id":"run-A","attempt_id":"run-A:1","lease_epoch":3}
@pytest.fixture
def context(monkeypatch,tmp_path):
    monkeypatch.setattr(a,"_durability_fault",False)
    monkeypatch.setenv("DEEP_AGENT_SERVICE_INTERNAL_KEY",OWNER["key"])
    monkeypatch.setenv("DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED","1")
    monkeypatch.setenv("DEEP_AGENT_USAGE_SPOOL_DIR",str(tmp_path))
    monkeypatch.setattr(a,"ownership",lambda:dict(OWNER))
    calls=[]
    monkeypatch.setattr(a,"post",lambda owner,run,phase,body:calls.append((run,phase,dict(body))))
    return calls,tmp_path

def request():
    return httpx.Request("POST","http://vendor.example.test/v1/chat/completions",json={"model":"fixture-model","messages":[{"role":"user","content":"prompt-never-persist"}]})

def response(body,status=200,content_type="application/json"):
    return httpx.Response(status,headers={"content-type":content_type},stream=httpx.ByteStream(body))

def test_sync_dispatch_start_ack_and_terminal_same_identity(context):
    calls,path=context
    def vendor(req):
        assert calls[-1][1]=="start"
        return response(json.dumps({"choices":[{"message":{"content":"response-never-persist"}}],"usage":{"total_tokens":9,"prompt_tokens":6,"completion_tokens":3}}).encode())
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(vendor))) as client:
        result=client.send(request());assert result.json()["usage"]["total_tokens"]==9
    assert [x[1] for x in calls]==["start","terminal"]
    assert calls[0][2]["requestId"]==calls[1][2]["requestId"]
    assert calls[1][2]["usage"]=={"total":9,"prompt":6,"completion":3}
    assert a.Journal(str(path)).pending(OWNER)==[]

def test_start_denial_prevents_paid_dispatch(context,monkeypatch):
    called=[]
    monkeypatch.setattr(a,"post",lambda *args:(_ for _ in ()).throw(a.RuntimeUsageError("denied")))
    transport=a.AccountingTransport(httpx.MockTransport(lambda r:called.append(r)))
    with pytest.raises(a.RuntimeUsageError):transport.handle_request(request())
    assert called==[]

def test_terminal_outage_survives_restart_and_replay_does_not_retry_old_model(context,monkeypatch):
    calls,path=context;paid=[]
    def send(owner,run,phase,body):
        calls.append((run,phase,dict(body)))
        if phase=="terminal":raise a.RuntimeUsageError("outage")
    monkeypatch.setattr(a,"post",send)
    def vendor(req):paid.append(req);return response(b'{"usage":{"total_tokens":7}}')
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(vendor))) as client:client.send(request())
    pending=a.Journal(str(path)).pending(OWNER);assert len(pending)==1
    assert "fixture-secret" not in pending[0][2] and "prompt-never" not in pending[0][2] and "vendor.example" not in pending[0][2]
    monkeypatch.setattr(a,"post",lambda owner,run,phase,body:calls.append((run,phase,dict(body))))
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(vendor))) as client:client.send(request())
    assert len(paid)==2 # two explicitly requested calls; replay never dispatches the old model
    assert calls[2][1]=="terminal" and calls[2][2]["requestId"]==pending[0][0]
    assert a.Journal(str(path)).pending(OWNER)==[]

def test_stream_cancel_keeps_reported_subsets(context):
    calls,_=context
    data=b'data: {"usage":{"total_tokens":12,"prompt_tokens":10,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":6},"completion_tokens_details":{"reasoning_tokens":1}}}\r\n\r\n'
    transport=a.AccountingTransport(httpx.MockTransport(lambda req:response(data,content_type="text/event-stream")))
    result=transport.handle_request(request());stream=iter(result.stream);next(stream);result.close()
    assert calls[-1][2]["outcome"]=="failed"
    assert calls[-1][2]["usage"]=={"total":12,"prompt":10,"completion":2,"cacheInput":6,"reasoningOutput":1}
    stream.close();assert len(calls)==2

def test_usage_parser_split_invalid_details_and_corrected_parent():
    parser=a.UsageParser("text/event-stream")
    for part in [b'data: {"usage":{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":60}}}\n',b'\ndata: {"usage":{"total_tokens":55,"prompt_tokens":50,',b'"completion_tokens":5,"completion_tokens_details":42}}\n\n']:
        parser.feed(part)
    assert parser.usage=={"total":55,"prompt":50,"completion":5}

def test_two_actual_transport_attempts_have_distinct_ids_and_failure_is_not_free(context):
    calls,_=context
    statuses=iter([429,200])
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda r:response(b'{"usage":{"total_tokens":4}}',next(statuses))))) as client:
        client.send(request());client.send(request())
    terminals=[x[2] for x in calls if x[1]=="terminal"]
    assert len({x["requestId"] for x in terminals})==2
    assert terminals[0]["outcome"]=="failed" and terminals[0]["usage"]["total"]==4

def test_async_dispatch_terminal_and_transport_failure(context,monkeypatch):
    calls,path=context
    async def send(owner,run,phase,body):calls.append((run,phase,dict(body)))
    monkeypatch.setattr(a,"apost",send)
    class Bytes(httpx.AsyncByteStream):
        async def __aiter__(self):yield b'{"usage":{"total_tokens":8}}'
    async def vendor(req):return httpx.Response(200,headers={"content-type":"application/json"},stream=Bytes())
    async def execute():
        async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(vendor))) as client:
            result=await client.send(request());assert result.json()["usage"]["total_tokens"]==8
    asyncio.run(execute());assert calls[-1][2]["usage"]=={"total":8}
    assert a.Journal(str(path)).pending(OWNER)==[]

def test_missing_spool_and_disabled_runtime_fail_closed(context,monkeypatch):
    monkeypatch.delenv("DEEP_AGENT_USAGE_SPOOL_DIR")
    with pytest.raises(a.RuntimeUsageError):a.prepare(request())
    monkeypatch.setenv("DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED","0")
    monkeypatch.setattr(a,"receipt_requested",lambda:True)
    paid=[];transport=a.AccountingTransport(httpx.MockTransport(lambda r:paid.append(r)))
    with pytest.raises(a.RuntimeUsageError):transport.handle_request(request())
    assert not paid


def test_journal_failure_preserves_provider_result_and_blocks_next_dispatch(context,monkeypatch):
    calls,_=context;paid=[]
    monkeypatch.setattr(a.Journal,"save",lambda *args:(_ for _ in ()).throw(sqlite3.OperationalError("disk full")))
    def vendor(req):
        paid.append(req)
        return response(b'{"usage":{"total_tokens":7}}')
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(vendor))) as client:
        assert client.send(request()).json()["usage"]["total_tokens"]==7
        with pytest.raises(a.RuntimeUsageError,match="durability_fault"):
            client.send(request())
    assert len(paid)==1
    assert [call[1] for call in calls]==["start","terminal"]


def test_real_openai_sdk_retry_accounts_each_actual_attempt(context):
    from openai import OpenAI
    calls,_=context;paid=[]
    def vendor(req):
        paid.append(req)
        if len(paid)==1:
            return response(b'{"error":{"message":"fixture","type":"rate_limit"},"usage":{"total_tokens":4}}',429)
        return response(b'{"id":"fixture","object":"chat.completion","created":1,"model":"fixture-model","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"total_tokens":7,"prompt_tokens":5,"completion_tokens":2}}')
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(vendor))) as client:
        sdk=OpenAI(api_key="fixture-key",base_url="http://vendor.example.test/v1",http_client=client,max_retries=1)
        result=sdk.chat.completions.create(model="fixture-model",messages=[{"role":"user","content":"fixture"}])
        assert result.choices[0].message.content=="ok"
    terminals=[x[2] for x in calls if x[1]=="terminal"]
    assert len(paid)==len(terminals)==2
    assert len({x["requestId"] for x in terminals})==2
    assert [x["usage"]["total"] for x in terminals]==[4,7]
    assert [x["outcome"] for x in terminals]==["failed","succeeded"]


@pytest.mark.parametrize("run_id,attempt_id,call_purpose",[("root-run","root-run:1","primary"),("child-run","child-run:1","primary"),("root-run","root-run:lease:3:history-summary","history-summary")])
def test_real_langgraph_async_node_propagates_receipt_context(context,monkeypatch,run_id,attempt_id,call_purpose):
    from typing import TypedDict
    from langgraph.graph import StateGraph, START, END
    from langchain_openai import ChatOpenAI
    calls,path=context
    monkeypatch.setattr(a,"ownership",ORIGINAL_OWNERSHIP)
    async def callback(owner,run,phase,body):
        assert owner["run_id"]==run_id and owner["attempt_id"]==attempt_id
        calls.append((run,phase,dict(body)))
    monkeypatch.setattr(a,"apost",callback)
    class State(TypedDict):
        result:str
    async def vendor(req):
        assert calls[-1][1]=="start"
        class Bytes(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield json.dumps({"id":"fixture","object":"chat.completion","created":1,"model":"fixture-model","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"total_tokens":7,"prompt_tokens":5,"completion_tokens":2}}).encode()
        return httpx.Response(200,headers={"content-type":"application/json"},stream=Bytes())
    async def execute():
        async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(vendor))) as client:
            model=ChatOpenAI(api_key="fixture-key",base_url="http://vendor.example.test/v1",model="fixture-model",http_async_client=client,max_retries=0)
            async def node(state):
                result=await model.ainvoke("fixture")
                return {"result":result.content}
            graph=StateGraph(State);graph.add_node("model",node);graph.add_edge(START,"model");graph.add_edge("model",END)
            cfg={"configurable":{"model_request_accounting":{**{k:v for k,v in OWNER.items() if k!="key"},"run_id":run_id,"attempt_id":attempt_id,"call_purpose":call_purpose}}}
            assert (await graph.compile().ainvoke({"result":""},cfg))["result"]=="ok"
    asyncio.run(execute())
    assert [x[1] for x in calls]==["start","terminal"]
    assert calls[0][2]["callPurpose"]==call_purpose
    assert calls[1][2]["usage"]["total"]==7
    assert a.Journal(str(path)).pending(OWNER)==[]


def test_idle_repair_reopens_spool_without_any_paid_model_dispatch(context, monkeypatch):
    _, path = context
    body = {"orgId":"org-A","attemptId":"run-A:1","leaseEpoch":3,"requestId":"idle-receipt","endedAt":a.now(),"outcome":"failed","usage":{"total":2}}
    a.Journal(str(path)).save(OWNER, body)
    delivered = []
    async def send(owner, run, phase, payload):
        delivered.append((run,phase,payload))
    monkeypatch.setattr(a,"apost",send)
    assert asyncio.run(a.replay_pending_batch(dict(OWNER),a.Journal(str(path)))) == 1
    assert delivered == [("run-A","terminal",body)]
    assert a.Journal(str(path)).pending(OWNER) == []


def test_idle_repair_failure_or_foreign_receiver_never_acknowledges(context, monkeypatch):
    _, path = context
    body = {"orgId":"org-A","attemptId":"run-A:1","leaseEpoch":3,"requestId":"idle-retained","endedAt":a.now(),"outcome":"failed","usage":{}}
    journal = a.Journal(str(path));journal.save(OWNER,body)
    async def fail(*args):
        raise a.RuntimeUsageError("outage")
    monkeypatch.setattr(a,"apost",fail)
    assert asyncio.run(a.replay_pending_batch(OWNER,journal)) == 0
    assert asyncio.run(a.replay_pending_batch(dict(OWNER,base_url="http://foreign.test"),journal)) == 0
    assert len(journal.pending(OWNER)) == 1


def test_idle_configuration_requires_explicit_receiver_and_existing_internal_key(context,monkeypatch):
    monkeypatch.setenv("DEEP_AGENT_USAGE_IDLE_REPLAY_ENABLED","1")
    monkeypatch.delenv("DEEP_AGENT_USAGE_CALLBACK_BASE_URL",raising=False)
    with pytest.raises(a.RuntimeUsageError,match="receiver_unconfigured"):
        a.idle_replay_configuration()
    for invalid in ["http://user:secret@api.test", "http://api.test?secret=x", "http://api.test#fragment", "relative"]:
        monkeypatch.setenv("DEEP_AGENT_USAGE_CALLBACK_BASE_URL",invalid)
        with pytest.raises(a.RuntimeUsageError):
            a.idle_replay_configuration()
    monkeypatch.setenv("DEEP_AGENT_USAGE_CALLBACK_BASE_URL",OWNER["base_url"])
    owner,_ = a.idle_replay_configuration();assert owner == {"base_url":OWNER["base_url"],"key":OWNER["key"]}
    monkeypatch.setenv("DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED","0")
    with pytest.raises(a.RuntimeUsageError,match="accounting_disabled"):
        a.idle_replay_configuration()


def test_idle_worker_cancel_keeps_pending_receipts(context,monkeypatch):
    _,path=context;journal=a.Journal(str(path));journal.save(OWNER,{"requestId":"idle-cancelled","usage":{}})
    entered=asyncio.Event()
    async def wait_for_cancel(*args):
        entered.set();await asyncio.Future()
    monkeypatch.setattr(a,"apost",wait_for_cancel)
    async def check():
        task=asyncio.create_task(a.replay_pending_receipts(OWNER,journal))
        await entered.wait();task.cancel()
        with pytest.raises(asyncio.CancelledError):await task
    asyncio.run(check());assert len(journal.pending(OWNER)) == 1


def test_idle_poison_receipt_rotates_and_does_not_starve_valid_followers(context,monkeypatch):
    _,path=context;journal=a.Journal(str(path))
    journal.save(OWNER,{"requestId":"poison","usage":{}})
    journal.save(OWNER,{"requestId":"valid","usage":{"total":1}})
    delivered=[]
    async def send(owner,run,phase,body):
        if body["requestId"]=="poison":raise a.RuntimeUsageError("permanently rejected")
        delivered.append(body["requestId"])
    monkeypatch.setattr(a,"apost",send)
    assert asyncio.run(a.replay_pending_batch(OWNER,journal))==1
    assert delivered==["valid"]
    assert [row[0] for row in a.Journal(str(path)).pending(OWNER)]==["poison"]


def test_idle_twenty_poison_rows_cannot_starve_rows_beyond_batch_limit(context,monkeypatch):
    _,path=context;journal=a.Journal(str(path))
    for index in range(22):journal.save(OWNER,{"requestId":str(index),"usage":{}})
    delivered=[]
    async def send(owner,run,phase,body):
        if int(body["requestId"])<20:raise a.RuntimeUsageError("permanently rejected")
        delivered.append(body["requestId"])
    monkeypatch.setattr(a,"apost",send)
    assert asyncio.run(a.replay_pending_batch(OWNER,journal))==0
    # Rotation survives reopening; the formerly invisible valid receipts now lead.
    assert asyncio.run(a.replay_pending_batch(OWNER,a.Journal(str(path))))==2
    assert delivered==["20","21"]


def test_spool_replay_identity_includes_receiver_and_run_not_only_payload(context):
    _,path=context;journal=a.Journal(str(path));body={"requestId":"same-id","usage":{}}
    journal.save(OWNER,body);journal.save(OWNER,body)
    for other in [dict(OWNER,base_url="http://other.test"),dict(OWNER,run_id="other-run")]:
        with pytest.raises(a.RuntimeUsageError,match="replay_mismatch"):journal.save(other,body)
    assert len(journal.pending(OWNER))==1


def test_private_admission_precedes_real_http_and_never_spools_body(context,monkeypatch):
    calls,path=context
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    req=httpx.Request("POST","http://vendor.example.test/v1/chat/completions",json={"model":"fixture-model","max_tokens":10,"messages":[{"role":"user","content":"prompt-never-persist"}]})
    def vendor(request):
        assert calls[-1][1]=="admit"
        assert calls[-1][2]["serializedBody"]==request.content.decode()
        assert calls[-1][2]["outputTokenLimit"]==10
        return response(b'{"usage":{"total_tokens":2,"prompt_tokens":1,"completion_tokens":1}}')
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(vendor))) as client:
        client.send(req)
    assert [entry[1] for entry in calls]==["admit","terminal"]
    assert "serializedBody" not in calls[-1][2]
    start=calls[0][2]
    other=dict(OWNER,lease_epoch=99,attempt_id="run-A:9")
    assert a.admission_payload(req,other,start)["logicalCallId"]==start["logicalCallId"]
    with sqlite3.connect(str(path / "model-usage.sqlite3")) as db:
        assert db.execute("SELECT count(*) FROM pending").fetchone()[0]==0


def test_admission_missing_output_bound_or_denial_sends_no_vendor_request(context,monkeypatch):
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    paid=[]
    transport=a.AccountingTransport(httpx.MockTransport(lambda req:paid.append(req)))
    with pytest.raises(a.RuntimeUsageError,match="admission_output_cap_unverified"):
        transport.handle_request(request())
    monkeypatch.setattr(a,"post",lambda *args:(_ for _ in ()).throw(a.RuntimeUsageError("denied")))
    req=httpx.Request("POST","http://vendor.example.test/v1/chat/completions",json={"model":"fixture-model","max_tokens":10})
    with pytest.raises(a.RuntimeUsageError):transport.handle_request(req)
    assert paid==[]


def test_async_private_admission_before_vendor(context,monkeypatch):
    calls,_=context
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    async def callback(owner,run,phase,body):calls.append((run,phase,dict(body)))
    monkeypatch.setattr(a,"apost",callback)
    async def vendor(req):
        assert calls[-1][1]=="admit"
        return response(b'{"usage":{"total_tokens":2,"prompt_tokens":1,"completion_tokens":1}}')
    async def run():
        async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(vendor))) as client:
            await client.send(httpx.Request("POST","http://vendor.example.test/v1/chat/completions",json={"model":"fixture-model","max_completion_tokens":10}))
    asyncio.run(run())
    assert [entry[1] for entry in calls]==["admit","terminal"]


def test_admission_model_builder_requires_explicit_existing_bound_and_disables_sdk_retry(context,monkeypatch):
    from deep_agent_service.model import build_chat_model, DeepAgentModelConfigError
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL","http://vendor.example.test/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY","fixture")
    monkeypatch.delenv("KERNEL_MODEL_MAX_OUTPUT_TOKENS",raising=False)
    with pytest.raises(DeepAgentModelConfigError,match="explicitly configured"):
        build_chat_model("fixture-model")
    monkeypatch.setenv("KERNEL_MODEL_MAX_OUTPUT_TOKENS","10")
    model=build_chat_model("fixture-model")
    assert model.max_tokens==10 and model.max_retries==0


def test_artifact_actual_transport_has_opaque_subject_no_agent_identity_and_start_before_http(monkeypatch,tmp_path):
    monkeypatch.setattr(a,"_durability_fault",False)
    for k,v in {"DEEP_AGENT_SERVICE_INTERNAL_KEY":"private","DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED":"1","DEEP_AGENT_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED":"1","DEEP_AGENT_USAGE_CALLBACK_BASE_URL":"http://api.example.test","DEEP_AGENT_USAGE_SPOOL_DIR":str(tmp_path)}.items():monkeypatch.setenv(k,v)
    monkeypatch.delenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED",raising=False)
    ref={"kind":"artifact-index","orgId":"org-A","operationId":"84f45cd6-e5b7-432b-b8d6-70a377f01ddd"}
    callbacks=[];paid=[]
    async def send(owner,subject,phase,body):callbacks.append((a.callback_url(owner,subject,phase),dict(body)))
    monkeypatch.setattr(a,"apost",send)
    def vendor(req):
        assert callbacks[-1][0].endswith('/start')
        paid.append(req)
        return response(json.dumps({"data":[],"usage":{"prompt_tokens":4,"total_tokens":4}}).encode())
    async def check():
        with a.retrieval_accounting_scope(ref,"retrieval-embedding"):
            async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(vendor))) as client:
                await client.post('http://vendor.example.test/v1/embeddings',json={"model":"fixture-model","input":["transient"]})
    asyncio.run(check())
    assert len(paid)==1 and len(callbacks)==2
    assert all('/internal/artifact-index/'+ref['operationId']+'/model-requests/' in url for url,_ in callbacks)
    assert set(callbacks[0][1])=={'orgId','requestId','startedAt','modelId'}
    assert callbacks[1][1]['usage']=={'total':4,'prompt':4}
    assert not {'runId','attemptId','leaseEpoch','userId'} & set(callbacks[1][1])


def test_artifact_accounting_rejects_asserted_actor_wrong_purpose_and_admission_before_vendor(monkeypatch,tmp_path):
    monkeypatch.setattr(a,"_durability_fault",False)
    for k,v in {"DEEP_AGENT_SERVICE_INTERNAL_KEY":"private","DEEP_AGENT_REQUEST_ACCOUNTING_ENABLED":"1","DEEP_AGENT_RETRIEVAL_REQUEST_ACCOUNTING_ENABLED":"1","DEEP_AGENT_USAGE_CALLBACK_BASE_URL":"http://api.example.test","DEEP_AGENT_USAGE_SPOOL_DIR":str(tmp_path)}.items():monkeypatch.setenv(k,v)
    ref={"kind":"artifact-index","orgId":"org-A","operationId":"84f45cd6-e5b7-432b-b8d6-70a377f01ddd"}
    for bad,purpose in [(ref|{'userId':'forged'},'retrieval-embedding'),(ref,'retrieval-rerank')]:
        with pytest.raises(a.RuntimeUsageError):
            with a.retrieval_accounting_scope(bad,purpose):pytest.fail('must deny scope')
    monkeypatch.setenv('DEEP_AGENT_MODEL_ADMISSION_ENABLED','1')
    paid=[]
    async def check():
        with a.retrieval_accounting_scope(ref,'retrieval-embedding'):
            async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(lambda r:paid.append(r)))) as client:
                with pytest.raises(a.RuntimeUsageError,match='artifact_embedding_admission_unimplemented'):
                    await client.post('http://vendor.example.test/v1/embeddings',json={'model':'fixture-model','input':['transient']})
    asyncio.run(check());assert paid==[]


def test_artifact_receipt_restart_replays_original_subject_kind_without_model(context,monkeypatch):
    _,path=context;owner={**OWNER,'subject_kind':'artifact-index','operation_id':'84f45cd6-e5b7-432b-b8d6-70a377f01ddd'}
    journal=a.Journal(str(path));journal.save(owner,{'requestId':'artifact-terminal','orgId':'org-A','usage':{}})
    delivered=[]
    async def send(replay_owner,subject,phase,body):delivered.append(a.callback_url(replay_owner,subject,phase))
    monkeypatch.setattr(a,'apost',send)
    assert asyncio.run(a.replay_pending_batch(OWNER,a.Journal(str(path))))==1
    assert delivered==['http://api.example.test/internal/artifact-index/'+owner['operation_id']+'/model-requests/terminal']
    assert journal.pending(OWNER)==[]
