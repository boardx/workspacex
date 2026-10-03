import asyncio
import json
import sqlite3
import httpx
import pytest
from deep_agent_service import model_request_accounting as a

OWNER={"base_url":"http://api.example.test","key":"fixture-secret-must-not-persist","org_id":"org-A","run_id":"run-A","attempt_id":"run-A:1","lease_epoch":3}
@pytest.fixture
def context(monkeypatch,tmp_path):
    monkeypatch.setattr(a,"_durability_fault",False)
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
