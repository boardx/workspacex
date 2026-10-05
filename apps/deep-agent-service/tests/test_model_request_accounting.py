import asyncio
import json
import sqlite3
import httpx
import pytest
from deep_agent_service import model_request_accounting as a

ORIGINAL_POST=a.post
ORIGINAL_APOST=a.apost
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


def test_private_identical_body_calls_keep_distinct_physical_admission_identity(context,monkeypatch):
    calls,_=context
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    paid=[]
    def vendor(req):
        paid.append(req.content)
        return response(b'{"usage":{"total_tokens":2,"prompt_tokens":1,"completion_tokens":1}}')
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(vendor))) as client:
        for _ in range(2):
            client.send(httpx.Request("POST","http://vendor.example.test/v1/chat/completions",json={"model":"fixture-model","max_tokens":10}))
    starts=[body for _,phase,body in calls if phase=="admit"]
    assert len(paid)==2 and paid[0]==paid[1]
    assert len(starts)==2 and starts[0]["requestId"]!=starts[1]["requestId"]
    assert starts[0]["logicalCallId"]!=starts[1]["logicalCallId"]
    req=httpx.Request("POST","http://vendor.example.test/v1/chat/completions",content=paid[0])
    assert a.admission_payload(req,OWNER,starts[0])["logicalCallId"]==starts[0]["logicalCallId"]


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
    paid=[];attempted=[]
    async def deny(owner,subject,phase,body):
        attempted.append((phase,dict(body)))
        raise a.RuntimeUsageError('input_only_admission_unconfigured')
    monkeypatch.setattr(a,'apost',deny)
    async def check():
        with a.retrieval_accounting_scope(ref,'retrieval-embedding'):
            async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(lambda r:paid.append(r)))) as client:
                with pytest.raises(a.RuntimeUsageError,match='input_only_admission_unconfigured'):
                    await client.post('http://vendor.example.test/v1/embeddings',json={'model':'fixture-model','input':['transient']})
    asyncio.run(check());assert paid==[]
    assert attempted[0][0]=='admit' and attempted[0][1]['billingMode']=='input-only'
    assert 'outputTokenLimit' not in attempted[0][1] and 'attemptId' not in attempted[0][1]


def test_artifact_receipt_restart_replays_original_subject_kind_without_model(context,monkeypatch):
    _,path=context;owner={**OWNER,'subject_kind':'artifact-index','operation_id':'84f45cd6-e5b7-432b-b8d6-70a377f01ddd'}
    journal=a.Journal(str(path));journal.save(owner,{'requestId':'artifact-terminal','orgId':'org-A','usage':{}})
    delivered=[]
    async def send(replay_owner,subject,phase,body):delivered.append(a.callback_url(replay_owner,subject,phase))
    monkeypatch.setattr(a,'apost',send)
    assert asyncio.run(a.replay_pending_batch(OWNER,a.Journal(str(path))))==1
    assert delivered==['http://api.example.test/internal/artifact-index/'+owner['operation_id']+'/model-requests/terminal']
    assert journal.pending(OWNER)==[]


def test_fault_marker_survives_restarted_state_and_blocks_both_transports(context,monkeypatch):
    calls,path=context;paid=[]
    monkeypatch.setattr(a.Journal,"save",lambda *args:(_ for _ in ()).throw(sqlite3.OperationalError("disk full")))
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda req:(paid.append(req),response(b'{"usage":{"total_tokens":7}}'))[1]))) as client:
        assert client.send(request()).json()["usage"]["total_tokens"]==7
    assert (path/"receipt-durability-fault").read_text()=="usage_receipt_durability_fault\n"
    assert (path/"receipt-durability-fault").stat().st_mode & 0o777 == 0o600
    monkeypatch.setattr(a,"_durability_fault",False)
    before=list(calls)
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda req:paid.append(req)))) as client:
        with pytest.raises(a.RuntimeUsageError,match="durability_fault"):client.send(request())
    async def run():
        async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(lambda req:paid.append(req)))) as client:
            with pytest.raises(a.RuntimeUsageError,match="durability_fault"):await client.send(request())
    asyncio.run(run());assert len(paid)==1;assert calls==before


def test_fault_marker_keeps_callback_only_repair_available(context,monkeypatch):
    async def acknowledge(*args):pass
    monkeypatch.setattr(a,"apost",acknowledge)
    _,path=context;journal=a.Journal(str(path));journal.save(OWNER,{"requestId":"repair-with-fault","usage":{}});journal.persist_fault()
    assert asyncio.run(a.replay_pending_batch(OWNER,journal))==1
    assert journal.pending(OWNER)==[]
    with pytest.raises(a.RuntimeUsageError,match="durability_fault"):journal.assert_dispatch_allowed()


def test_existing_marker_is_synced_and_never_follows_symlink(context,monkeypatch):
    _,path=context;journal=a.Journal(str(path));journal.persist_fault()
    fsync=a.os.fsync;calls=[]
    monkeypatch.setattr(a.os,"fsync",lambda fd:(calls.append(fd),fsync(fd))[1])
    journal.persist_fault();assert len(calls)==2
    journal.fault_path.unlink();target=path/"unrelated";target.write_text("unchanged")
    journal.fault_path.symlink_to(target)
    with pytest.raises(OSError):journal.persist_fault()
    assert target.read_text()=="unchanged"
    with pytest.raises(a.RuntimeUsageError,match="durability_fault"):journal.assert_dispatch_allowed()


def test_marker_storage_failure_is_bounded_and_keeps_current_process_closed(context,monkeypatch,caplog):
    _,path=context;journal=a.Journal(str(path))
    monkeypatch.setattr(journal,"persist_fault",lambda:(_ for _ in ()).throw(OSError("secret-do-not-log")))
    a.mark_durability_fault(journal)
    assert a._durability_fault is True
    assert "usage_receipt_fault_marker_unconfirmed" in caplog.text
    assert "secret-do-not-log" not in caplog.text
    assert not journal.fault_path.exists() # no unsupported restart-persistence claim

def inflight_start():
    import uuid
    return {'orgId':'org-A','attemptId':'run-A:1','leaseEpoch':3,'requestId':str(uuid.uuid4()),'startedAt':a.now()}

def test_inflight_active_lock_unknown_recovery_and_receiver_isolation(context):
    calls,path=context;journal=a.Journal(str(path));start=inflight_start()
    fd=journal.begin(OWNER,start)
    try:
        journal.recover_inflight(OWNER)
        assert journal.pending(OWNER)==[]
    finally:
        a.os.close(fd)
    journal.recover_inflight(OWNER|{'base_url':'http://foreign.example.test'})
    assert journal.pending(OWNER)==[]
    journal.recover_inflight(OWNER)
    rows=journal.pending(OWNER);assert len(rows)==1
    body=json.loads(rows[0][2]);assert body['usage']=={} and body['outcome']=='failed'
    assert body['attemptId']==start['attemptId'] and body['leaseEpoch']==3
    assert OWNER['key'] not in rows[0][2] and OWNER['base_url'] not in rows[0][2]
    journal.recover_inflight(OWNER);assert journal.pending(OWNER)==rows

def test_inflight_actual_terminal_wins_and_intent_contains_only_metadata(context):
    calls,path=context;journal=a.Journal(str(path));start=inflight_start()|{'serializedBody':'private-prompt','key':'private-key','modelId':'private-model'}
    fd=journal.begin(OWNER,start)
    with journal.connect() as db:
        value=db.execute('SELECT start FROM inflight').fetchone()[0]
    assert 'private-' not in value and 'http' not in value
    body={k:start[k] for k in ('orgId','requestId','attemptId','leaseEpoch')}|{'endedAt':a.now(),'outcome':'succeeded','usage':{'total':3,'prompt':2,'completion':1}}
    journal.save(OWNER,body);a.os.close(fd);journal.recover_inflight(OWNER)
    assert json.loads(journal.pending(OWNER)[0][2])==body
    with journal.connect() as db:assert db.execute('SELECT count(*) FROM inflight').fetchone()[0]==0

def test_inflight_persistence_failure_prevents_vendor_dispatch(context,monkeypatch):
    calls,path=context;paid=[]
    monkeypatch.setattr(a.Journal,'begin',lambda *args:(_ for _ in ()).throw(OSError('disk unavailable')))
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda req:paid.append(req)))) as client:
        with pytest.raises(OSError):client.send(request())
    assert paid==[] and calls==[]

def test_inflight_real_process_exit_releases_lock_and_repairs_without_vendor(context):
    import subprocess,sys,os
    calls,path=context;start=inflight_start()
    script='''import json,os,sys\nfrom deep_agent_service.model_request_accounting import Journal\nj=Journal(sys.argv[1]);j.begin(json.loads(sys.argv[2]),json.loads(sys.argv[3]));os._exit(17)'''
    result=subprocess.run([sys.executable,'-c',script,str(path),json.dumps(OWNER),json.dumps(start)],env=os.environ.copy(),timeout=10)
    assert result.returncode==17
    journal=a.Journal(str(path));journal.recover_inflight(OWNER)
    body=json.loads(journal.pending(OWNER)[0][2]);assert body['requestId']==start['requestId'] and body['usage']=={}
    assert calls==[]

def test_inflight_symlink_lock_fails_without_following(context):
    calls,path=context;start=inflight_start();target=path/'target';target.write_text('untouched')
    (path/('inflight-'+start['requestId']+'.lock')).symlink_to(target)
    with pytest.raises(OSError):a.Journal(str(path)).begin(OWNER,start)
    assert target.read_text()=='untouched'

def test_inflight_twenty_active_intents_do_not_starve_abandoned_after_restart(context):
    calls,path=context;journal=a.Journal(str(path));locks=[journal.begin(OWNER,inflight_start()) for _ in range(20)]
    abandoned=inflight_start();fd=journal.begin(OWNER,abandoned);a.os.close(fd)
    try:
        journal.recover_inflight(OWNER);assert journal.pending(OWNER)==[]
        a.Journal(str(path)).recover_inflight(OWNER)
        assert json.loads(journal.pending(OWNER)[0][2])['requestId']==abandoned['requestId']
    finally:
        for fd in locks:a.os.close(fd)

def test_async_inflight_persistence_failure_zero_vendor(context,monkeypatch):
    calls,path=context;paid=[]
    async def callback(owner,run,phase,body):calls.append((run,phase,body))
    async def vendor(req):paid.append(req);return response(b'{}')
    monkeypatch.setattr(a,'apost',callback)
    monkeypatch.setattr(a.Journal,'begin',lambda *args:(_ for _ in ()).throw(OSError('unavailable')))
    async def run():
        async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(vendor))) as client:
            with pytest.raises(OSError):await client.send(request())
    asyncio.run(run());assert paid==[] and calls==[]

def test_inflight_idle_replays_unknown_metadata_without_vendor(context,monkeypatch):
    calls,path=context;journal=a.Journal(str(path));start=inflight_start();fd=journal.begin(OWNER,start);a.os.close(fd)
    async def callback(owner,run,phase,body):calls.append((run,phase,dict(body)))
    monkeypatch.setattr(a,'apost',callback)
    assert asyncio.run(a.replay_pending_batch(OWNER,journal))==1
    assert calls==[('run-A','terminal',{'orgId':'org-A','requestId':start['requestId'],'attemptId':'run-A:1','leaseEpoch':3,'endedAt':calls[0][2]['endedAt'],'outcome':'failed','usage':{}})]
    assert journal.pending(OWNER)==[]

def test_inflight_async_dispatch_cancel_durably_clears_intent(context,monkeypatch):
    calls,path=context
    async def callback(owner,run,phase,body):calls.append((run,phase,dict(body)))
    async def vendor(req):raise asyncio.CancelledError()
    monkeypatch.setattr(a,'apost',callback)
    async def run():
        async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(vendor))) as client:
            with pytest.raises(asyncio.CancelledError):await client.send(request())
    asyncio.run(run())
    assert [c[1] for c in calls]==['start','terminal'] and calls[-1][2]['usage']=={}
    journal=a.Journal(str(path))
    with journal.connect() as db:assert db.execute('SELECT count(*) FROM inflight').fetchone()[0]==0
    journal.recover_inflight(OWNER);assert journal.pending(OWNER)==[]

def test_inflight_spool_symlink_and_permissive_directory_rejected(context):
    calls,path=context;directory=path/'insecure';directory.mkdir(mode=0o755)
    with pytest.raises(a.RuntimeUsageError):a.Journal(str(directory))
    safe=path/'safe';safe.mkdir(mode=0o700);target=path/'secret';target.write_text('untouched');(safe/'model-usage.sqlite3').symlink_to(target)
    with pytest.raises(OSError):a.Journal(str(safe))
    assert target.read_text()=='untouched'

def test_inflight_save_failure_keeps_lock_through_original_callback(context,monkeypatch):
    calls,path=context;journal=a.Journal(str(path));start=inflight_start();fd=journal.begin(OWNER,start)
    def fail(*args):raise OSError('save unavailable')
    def callback(owner,run,phase,body):
        journal.recover_inflight(owner)
        assert journal.pending(owner)==[]  # Unknown repair cannot race this live terminal.
        calls.append((run,phase,body))
    monkeypatch.setattr(a.Journal,'save',fail);monkeypatch.setattr(a,'post',callback)
    stream=a.AccountedSyncStream(httpx.ByteStream(b''),OWNER,journal,start,'application/json',True,fd)
    stream.parser.usage={'total':3,'prompt':2,'completion':1};stream.finish(True)
    assert calls[-1][2]['usage']=={'total':3,'prompt':2,'completion':1}
    journal.recover_inflight(OWNER);assert json.loads(journal.pending(OWNER)[0][2])['usage']=={}

def test_gc_real_process_unlink_between_producer_open_and_flock_zero_vendor(context,monkeypatch):
    import subprocess,sys,os
    calls,path=context;paid=[];original=a.fcntl.flock;once=False
    def paused(fd,operation):
        nonlocal once
        if not once:
            once=True
            code='from deep_agent_service.model_request_accounting import Journal;import sys;assert Journal(sys.argv[1]).collect_locks()==1'
            child=subprocess.run([sys.executable,'-c',code,str(path)],env=os.environ.copy(),timeout=10)
            assert child.returncode==0
        return original(fd,operation)
    monkeypatch.setattr(a.fcntl,'flock',paused)
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda req:paid.append(req)))) as client:
        with pytest.raises(FileNotFoundError):client.send(request())
    assert once and paid==[] and calls==[]
    with a.Journal(str(path)).connect() as db:assert db.execute('SELECT count(*) FROM inflight').fetchone()[0]==0

def test_gc_bounded_rotation_preserves_live_and_pending_then_collects_completed(context):
    calls,path=context;journal=a.Journal(str(path));starts=[inflight_start() for _ in range(20)];locks=[journal.begin(OWNER,start) for start in starts]
    completed=inflight_start();fd=journal.request_lock(completed['requestId']);a.os.close(fd)
    pending=inflight_start();fd=journal.begin(OWNER,pending)
    body={k:pending[k] for k in ('orgId','requestId','attemptId','leaseEpoch')}|{'endedAt':a.now(),'outcome':'failed','usage':{}}
    journal.save(OWNER,body);a.os.close(fd)
    try:
        assert journal.collect_locks()==0
        assert a.Journal(str(path)).collect_locks()==1
        assert not (path/('inflight-'+completed['requestId']+'.lock')).exists()
        assert (path/('inflight-'+pending['requestId']+'.lock')).exists()
        journal.recover_inflight(OWNER);assert len(journal.pending(OWNER))==1
        for start in starts:assert (path/('inflight-'+start['requestId']+'.lock')).exists()
        journal.acknowledge(pending['requestId'],journal.pending(OWNER)[0][2]);journal.collect_locks();journal.collect_locks()
        assert not (path/('inflight-'+pending['requestId']+'.lock')).exists()
    finally:
        for fd in locks:a.os.close(fd)

def test_gc_changed_inode_fails_lock_acquisition_without_intent(context,monkeypatch):
    calls,path=context;journal=a.Journal(str(path));start=inflight_start();original=a.fcntl.flock
    def replace(fd,operation):
        original(fd,operation)
        target=path/('inflight-'+start['requestId']+'.lock');target.unlink();target.touch(mode=0o600)
    monkeypatch.setattr(a.fcntl,'flock',replace)
    with pytest.raises(a.RuntimeUsageError,match='inode_changed'):journal.begin(OWNER,start)
    with journal.connect() as db:assert db.execute('SELECT count(*) FROM inflight').fetchone()[0]==0

@pytest.mark.parametrize('asynchronous',[False,True])
def test_terminal_ack_collects_locks_without_idle_flag(context,monkeypatch,asynchronous):
    calls,path=context;monkeypatch.setenv('DEEP_AGENT_USAGE_IDLE_REPLAY_ENABLED','0')
    data=json.dumps({'usage':{'total_tokens':3,'prompt_tokens':2,'completion_tokens':1}}).encode()
    async def callback(owner,run,phase,body):calls.append((run,phase,body))
    async def run():
        monkeypatch.setattr(a,'apost',callback)
        async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(lambda req:response(data)))) as client:
            result=await client.send(request());assert result.json()['usage']['total_tokens']==3
    if asynchronous:asyncio.run(run())
    else:
        with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda req:response(data)))) as client:
            result=client.send(request());assert result.json()['usage']['total_tokens']==3
    journal=a.Journal(str(path))
    with journal.connect() as db:
        for table in ('lock_candidates','inflight','pending'):assert db.execute('SELECT count(*) FROM '+table).fetchone()[0]==0
    assert list(path.glob('inflight-*.lock'))==[]

def test_terminal_cleanup_failure_preserves_result_and_sanitizes(context,monkeypatch,caplog):
    calls,path=context
    monkeypatch.setattr(a.Journal,'collect_locks',lambda self:(_ for _ in ()).throw(OSError('private-cleanup-secret')))
    with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda req:response(b'{"result":"preserved"}')))) as client:
        assert client.send(request()).json()=={'result':'preserved'}
    assert 'private-cleanup-secret' not in caplog.text and 'usage_receipt_lock_cleanup_unavailable' in caplog.text

@pytest.mark.parametrize('cancel_callback',[False,True])
def test_async_save_failure_keeps_lock_until_callback_even_when_cancelled(context,monkeypatch,cancel_callback):
    calls,path=context;journal=a.Journal(str(path));start=inflight_start();fd=journal.begin(OWNER,start)
    monkeypatch.setattr(a.Journal,'save',lambda *args:(_ for _ in ()).throw(OSError('unavailable')))
    async def callback(owner,run,phase,body):
        await asyncio.to_thread(journal.recover_inflight,owner)
        assert journal.pending(owner)==[]
        calls.append((run,phase,body))
        if cancel_callback:raise asyncio.CancelledError()
    monkeypatch.setattr(a,'apost',callback)
    async def run():
        stream=a.AccountedAsyncStream(a.response_stream_empty(),OWNER,journal,start,'application/json',True,fd)
        stream.parser.usage={'total':3,'prompt':2,'completion':1}
        if cancel_callback:
            with pytest.raises(asyncio.CancelledError):await stream.finish(True)
        else:await stream.finish(True)
        assert stream.intent_lock is None
        await asyncio.to_thread(journal.recover_inflight,OWNER)
    asyncio.run(run())
    assert calls[-1][2]['usage']=={'total':3,'prompt':2,'completion':1}
    assert json.loads(journal.pending(OWNER)[0][2])['usage']=={}


def test_late_pending_receipt_enrichment_and_stale_ack(context):
    _, path=context;journal=a.Journal(str(path))
    original={"requestId":"late-physical","orgId":"org-A","attemptId":"run-A:1","leaseEpoch":3,"endedAt":"original-end","outcome":"failed","usage":{}}
    old=journal.save(OWNER,original)
    journal.save(OWNER,original | {"endedAt":"later-end","outcome":"succeeded","usage":{"prompt":0}})
    latest=journal.save(OWNER,original | {"usage":{"total":2,"completion":2}})
    merged=original | {"usage":{"prompt":0,"total":2,"completion":2}}
    assert json.loads(latest)==merged
    journal.acknowledge(original["requestId"],old)
    assert json.loads(a.Journal(str(path)).pending(OWNER)[0][2])==merged
    with pytest.raises(a.RuntimeUsageError,match="replay_mismatch"):
        journal.save(OWNER,original | {"usage":{"prompt":1}})
    assert journal.pending(OWNER)[0][2]==latest
    journal.acknowledge(original["requestId"],latest)
    assert journal.pending(OWNER)==[]


def test_concurrent_late_receipt_dimensions_merge_and_conflicts_reject(context):
    from concurrent.futures import ThreadPoolExecutor
    _,path=context;journal=a.Journal(str(path));original={"requestId":"late-concurrent","usage":{}}
    journal.save(OWNER,original)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures=[executor.submit(journal.save,OWNER,original | {"usage":usage}) for usage in ({"prompt":3},{"completion":2})]
        for future in futures:future.result()
    assert json.loads(journal.pending(OWNER)[0][2])["usage"]=={"prompt":3,"completion":2}
    journal.save(OWNER,original | {"usage":{"total":5}})
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures=[executor.submit(journal.save,OWNER,{"requestId":"conflicting-late","usage":{"total":n}}) for n in (1,2)]
        results=[]
        for future in futures:
            try:future.result();results.append("accepted")
            except a.RuntimeUsageError:results.append("rejected")
    assert sorted(results)==["accepted","rejected"]


def test_late_receipt_refuses_foreign_receiver_subject_and_changed_identity(context):
    _,path=context;journal=a.Journal(str(path))
    original={"requestId":"late-owner","orgId":"org-A","attemptId":"run-A:1","usage":{}}
    payload=journal.save(OWNER,original)
    for owner,body in ((OWNER | {"base_url":"http://foreign.example.test"},original),(OWNER | {"run_id":"different"},original),(OWNER,original | {"orgId":"foreign"}),(OWNER,original | {"attemptId":"other"})):
        with pytest.raises(a.RuntimeUsageError,match="replay_mismatch"):journal.save(owner,body | {"usage":{"total":1}})
    assert journal.pending(OWNER)[0][2]==payload


def test_idle_old_delivery_ack_preserves_late_enrichment(context,monkeypatch):
    _,path=context;journal=a.Journal(str(path));body={"requestId":"idle-late","usage":{}}
    journal.save(OWNER,body);delivered=[]
    async def deliver(owner,run,phase,payload):
        delivered.append(dict(payload))
        journal.save(OWNER,payload | {"usage":{"total":7}})
    monkeypatch.setattr(a,"apost",deliver)
    assert asyncio.run(a.replay_pending_batch(OWNER,journal))==1
    assert delivered==[body]
    assert json.loads(journal.pending(OWNER)[0][2])["usage"]=={"total":7}
    async def acknowledge(owner,run,phase,payload):delivered.append(dict(payload))
    monkeypatch.setattr(a,"apost",acknowledge)
    assert asyncio.run(a.replay_pending_batch(OWNER,journal))==1
    assert delivered[-1]["usage"]=={"total":7}
    assert journal.pending(OWNER)==[]

@pytest.mark.parametrize("asynchronous", [False, True])
def test_authorized_replacement_is_only_vendor_dispatch_and_journal_identity(context, monkeypatch, asynchronous):
    calls,_=context
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    original={"model":"fixture-model","max_tokens":10,"messages":[{"role":"user","content":"unchanged"}]}
    selected={**original,"model":"cheap-model","max_tokens":3}
    paid,starts=[],[]
    begin=a.Journal.begin
    def record_start(journal,owner,start):
        starts.append(dict(start))
        return begin(journal,owner,start)
    monkeypatch.setattr(a.Journal,"begin",record_start)
    def callback(owner,run,phase,body):
        calls.append((run,phase,dict(body)))
        if phase=="admit":
            assert json.loads(body["serializedBody"])==original
            return {"accepted":True,"dispatch":{"modelId":"cheap-model","serializedBody":json.dumps(selected),"outputTokenLimit":3}}
    async def acallback(*args):return callback(*args)
    monkeypatch.setattr(a,"post",callback);monkeypatch.setattr(a,"apost",acallback)
    def check(req):
        assert calls[-1][1]=="admit"
        assert str(req.url)=="http://vendor.example.test/v1/chat/completions"
        assert req.headers["authorization"]=="Bearer fixture-only"
        paid.append(json.loads(req.content))
    def req():return httpx.Request("POST","http://vendor.example.test/v1/chat/completions",headers={"authorization":"Bearer fixture-only"},json=original)
    if asynchronous:
        async def vendor(r):
            check(r)
            class Bytes(httpx.AsyncByteStream):
                async def __aiter__(self):yield b'{"usage":{"total_tokens":2}}'
            return httpx.Response(200,headers={"content-type":"application/json"},stream=Bytes())
        async def execute():
            async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(vendor))) as client:await client.send(req())
        asyncio.run(execute())
    else:
        def vendor(r):
            check(r);return response(b'{"usage":{"total_tokens":2}}')
        with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(vendor))) as client:client.send(req())
    assert paid==[selected]
    assert [phase for _,phase,_ in calls]==["admit","terminal"]
    # Local pre-ACK intent contains the original transient model; its persisted
    # projection has no model. The vendor body and server admission own selection.
    assert starts[0]["modelId"]=="fixture-model"
    assert starts[0]["requestId"]==calls[-1][2]["requestId"]

@pytest.mark.parametrize("change", [{"messages":[]},{"max_tokens":True},{"max_tokens":11},{"new_field":1},{"temperature":True}])
def test_replacement_cannot_change_content_types_or_increase_cap(context,monkeypatch,change):
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED","1")
    original={"model":"fixture-model","max_tokens":10,"temperature":1,"messages":[{"role":"user","content":"unchanged"}]}
    selected={**original,"model":"cheap-model","max_tokens":3,**change}
    monkeypatch.setattr(a,"post",lambda *args:{"accepted":True,"dispatch":{"modelId":"cheap-model","serializedBody":json.dumps(selected),"outputTokenLimit":selected["max_tokens"]}})
    paid=[]
    with pytest.raises(a.RuntimeUsageError,match="admission_dispatch_binding_invalid"):
        with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda req:paid.append(req)))) as client:
            client.send(httpx.Request("POST","http://vendor.example.test/v1/chat/completions",json=original))
    assert paid==[]

@pytest.mark.parametrize("asynchronous", [False, True])
def test_admission_protocol_header_preserves_legacy_request_body(context,monkeypatch,asynchronous):
    requests=[]
    def callback(req):
        requests.append(req)
        return httpx.Response(200,json={"accepted":True})
    body={"requestId":"fixture-id","modelId":"fixture-model"}
    if asynchronous:
        client=httpx.AsyncClient
        monkeypatch.setattr(a.httpx,"AsyncClient",lambda **kwargs:client(transport=httpx.MockTransport(callback),**kwargs))
        async def execute():
            await ORIGINAL_APOST(OWNER,OWNER["run_id"],"admit",body)
            await ORIGINAL_APOST(OWNER,OWNER["run_id"],"terminal",body)
        asyncio.run(execute())
    else:
        client=httpx.Client
        monkeypatch.setattr(a.httpx,"Client",lambda **kwargs:client(transport=httpx.MockTransport(callback),**kwargs))
        ORIGINAL_POST(OWNER,OWNER["run_id"],"admit",body)
        ORIGINAL_POST(OWNER,OWNER["run_id"],"terminal",body)
    assert requests[0].headers["x-deep-agent-admission-protocol"]=="same-connection-v1"
    assert "x-deep-agent-admission-protocol" not in requests[1].headers
    assert [json.loads(req.content) for req in requests]==[body,body]


@pytest.mark.parametrize("admission", [False, True])
@pytest.mark.parametrize("asynchronous", [False, True])
def test_lost_start_ack_keeps_durable_identity_and_repair_never_dispatches(context, monkeypatch, admission, asynchronous):
    calls, path = context
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED", "1" if admission else "0")
    paid = []
    journal = a.Journal(str(path))

    def lost_ack(owner, run, phase, body):
        # Model server has committed this identity; its response is lost.
        with journal.connect() as db:
            persisted = db.execute("SELECT start FROM inflight WHERE id=?", (body["requestId"],)).fetchone()
        assert persisted is not None
        assert "prompt-never-persist" not in persisted[0]
        calls.append((run, phase, dict(body)))
        raise a.RuntimeUsageError("usage_receipt_delivery_unconfirmed")

    async def alost_ack(*args):
        return lost_ack(*args)

    req = httpx.Request("POST", "http://vendor.example.test/v1/chat/completions", json={"model":"fixture-model", "max_tokens":2, "messages":[{"role":"user", "content":"prompt-never-persist"}]})
    if asynchronous:
        monkeypatch.setattr(a, "apost", alost_ack)
        async def run():
            async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(lambda req: paid.append(req)))) as client:
                with pytest.raises(a.RuntimeUsageError):
                    await client.send(req)
        asyncio.run(run())
    else:
        monkeypatch.setattr(a, "post", lost_ack)
        with httpx.Client(transport=a.AccountingTransport(httpx.MockTransport(lambda req: paid.append(req)))) as client:
            with pytest.raises(a.RuntimeUsageError):
                client.send(req)
    assert paid == []
    original = calls[0][2]["requestId"]
    async def repair(owner, run, phase, body):
        calls.append((run, phase, dict(body)))
    monkeypatch.setattr(a, "apost", repair)
    assert asyncio.run(a.replay_pending_batch(OWNER, a.Journal(str(path)))) == 1
    assert calls[-1][1] == "terminal"
    assert calls[-1][2]["requestId"] == original
    assert calls[-1][2]["usage"] == {}
    assert paid == []
    assert asyncio.run(a.replay_pending_batch(OWNER, journal)) == 0


def test_cancelled_admission_ack_releases_lock_for_callback_only_repair(context, monkeypatch):
    calls, path = context
    monkeypatch.setenv("DEEP_AGENT_MODEL_ADMISSION_ENABLED", "1")
    paid = []
    async def cancelled(owner, run, phase, body):
        calls.append((run, phase, dict(body)))
        raise asyncio.CancelledError()
    monkeypatch.setattr(a, "apost", cancelled)
    async def run():
        req = httpx.Request("POST", "http://vendor.example.test/v1/chat/completions", json={"model":"fixture-model", "max_tokens":2})
        async with httpx.AsyncClient(transport=a.AsyncAccountingTransport(httpx.MockTransport(lambda req: paid.append(req)))) as client:
            with pytest.raises(asyncio.CancelledError):
                await client.send(req)
    asyncio.run(run())
    async def repair(owner, run, phase, body):
        calls.append((run, phase, dict(body)))
    monkeypatch.setattr(a, "apost", repair)
    assert asyncio.run(a.replay_pending_batch(OWNER, a.Journal(str(path)))) == 1
    assert len(calls) == 2 and calls[0][2]["requestId"] == calls[1][2]["requestId"]
    assert paid == []


@pytest.mark.parametrize("damage", ["invalid-json", "foreign-id", "extra-content", "bool-lease"])
def test_corrupt_inflight_intent_never_emits_forged_receipt_or_starves_valid_repair(context, damage):
    calls, path = context
    journal = a.Journal(str(path))
    broken, valid = inflight_start(), inflight_start()
    for start in (broken, valid):
        fd = journal.begin(OWNER, start)
        a.os.close(fd)
    damaged = dict(broken)
    if damage == "foreign-id":
        damaged["requestId"] = valid["requestId"]
    elif damage == "extra-content":
        damaged["serializedBody"] = "prompt-must-not-be-replayed"
    elif damage == "bool-lease":
        damaged["leaseEpoch"] = True
    encoded = "{" if damage == "invalid-json" else json.dumps(damaged)
    with journal.connect() as db:
        db.execute("UPDATE inflight SET start=? WHERE id=?", (encoded, broken["requestId"]))
    journal.recover_inflight(OWNER)
    pending = journal.pending(OWNER)
    assert len(pending) == 1 and pending[0][0] == valid["requestId"]
    assert "prompt-must-not-be-replayed" not in pending[0][2]
    with journal.connect() as db:
        assert db.execute("SELECT id FROM inflight").fetchall() == [(broken["requestId"],)]
    assert calls == []


@pytest.mark.parametrize("field,value", [("leaseEpoch", True), ("leaseEpoch", 0), ("attemptId", ""), ("orgId", None)])
def test_invalid_intent_metadata_fails_before_any_callback_or_vendor(context, field, value):
    calls, path = context
    start = inflight_start() | {field:value}
    journal = a.Journal(str(path))
    with pytest.raises(a.RuntimeUsageError, match="usage_inflight_metadata_invalid"):
        journal.begin(OWNER, start)
    with journal.connect() as db:
        assert db.execute("SELECT count(*) FROM inflight").fetchone()[0] == 0
    assert calls == []


@pytest.mark.parametrize("asynchronous", [False, True])
def test_actual_terminal_callback_ack_loss_retries_only_same_receipt(context, monkeypatch, asynchronous):
    _, path = context
    journal = a.Journal(str(path))
    start = inflight_start()
    fd = journal.begin(OWNER, start)
    wire = []
    lost = True
    def callback(req):
        wire.append(json.loads(req.content))
        if lost:
            # Receiver accepted the terminal; only its HTTP acknowledgement vanished.
            raise httpx.ReadError("fixture acknowledgement lost", request=req)
        return httpx.Response(200, json={"accepted":True})
    sync_client, async_client = httpx.Client, httpx.AsyncClient
    monkeypatch.setattr(a.httpx, "Client", lambda **kwargs:sync_client(transport=httpx.MockTransport(callback), **kwargs))
    monkeypatch.setattr(a.httpx, "AsyncClient", lambda **kwargs:async_client(transport=httpx.MockTransport(callback), **kwargs))
    monkeypatch.setattr(a, "post", ORIGINAL_POST)
    monkeypatch.setattr(a, "apost", ORIGINAL_APOST)
    if asynchronous:
        stream = a.AccountedAsyncStream(a.response_stream_empty(), OWNER, journal, start, "application/json", True, fd)
        stream.parser.feed(b'{"usage":{"total_tokens":3,"prompt_tokens":2,"completion_tokens":1}}')
        asyncio.run(stream.finish(True))
    else:
        stream = a.AccountedSyncStream(httpx.ByteStream(b""), OWNER, journal, start, "application/json", True, fd)
        stream.parser.feed(b'{"usage":{"total_tokens":3,"prompt_tokens":2,"completion_tokens":1}}')
        stream.finish(True)
    assert len(wire) == 3 and all(body == wire[0] for body in wire)
    assert wire[0]["requestId"] == start["requestId"]
    assert len(journal.pending(OWNER)) == 1
    lost = False
    assert asyncio.run(a.replay_pending_batch(OWNER, a.Journal(str(path)))) == 1
    assert len(wire) == 4 and wire[-1] == wire[0]
    assert journal.pending(OWNER) == []
    assert asyncio.run(a.replay_pending_batch(OWNER, journal)) == 0
