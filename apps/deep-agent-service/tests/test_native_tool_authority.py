import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

import httpx
import pytest
from deep_agent_service import native_tool_authority as module

CALL={'id':'real-call','name':'read_file','args':{'file_path':'/workspace/a','orgId':'model-cannot-override'}}

def config(base_url):
    return {'configurable':{'run_control_callback':{'base_url':base_url,'key':'test-key','org_id':'trusted-org',
            'run_id':'trusted-run','attempt_id':'trusted-attempt','lease_epoch':7}}}

@pytest.mark.parametrize('asynchronous',[False,True])
@pytest.mark.parametrize('status,body',[(200,{'allowed':True}),(200,{'allowed':False,'reason':'cancel_requested'}),
                                      (200,{'allowed':'yes'}),(200,{'allowed':True,'extra':'no'}),(401,{}),(302,{}),(200,[])])
def test_real_http_dispatch_requires_strict_allow(monkeypatch,asynchronous,status,body):
    requests=[];dispatched=[]
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append((self.path,json.loads(self.rfile.read(int(self.headers['content-length'])))))
            self.send_response(status);self.send_header('Content-Type','application/json')
            self.send_header('Location','/redirect-must-not-follow');self.end_headers();self.wfile.write(json.dumps(body).encode())
        def log_message(self,*args): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setattr(module,'get_config',lambda:config(f'http://127.0.0.1:{server.server_port}'))
    middleware=module.NativeToolAuthority(module.HttpNativeToolAuthority())
    request=SimpleNamespace(tool_call=CALL)
    def handler(req): dispatched.append(req.tool_call);return 'done'
    async def ahandler(req): return handler(req)
    def invoke():
        return asyncio.run(middleware.awrap_tool_call(request,ahandler)) if asynchronous else middleware.wrap_tool_call(request,handler)
    try:
        if status==200 and body=={'allowed':True}:
            assert invoke()=='done';assert invoke()=='done';assert len(requests)==2
        else:
            with pytest.raises(module.ToolAuthorityError): invoke()
            assert dispatched==[] and len(requests)==1
        sent=requests[0][1]
        assert sent=={'orgId':'trusted-org','attemptId':'trusted-attempt','leaseEpoch':7,'toolName':'read_file',
                      'toolCallId':'real-call','toolArgs':CALL['args']}
        assert requests[0][0]=='/internal/agent-runs/trusted-run/tool-execution/check'
    finally: server.shutdown();server.server_close();thread.join()


@pytest.mark.parametrize("asynchronous",[False,True])
def test_missing_callback_and_timeout_never_dispatch(monkeypatch,asynchronous):
    middleware=module.NativeToolAuthority(module.HttpNativeToolAuthority())
    monkeypatch.setattr(module,'get_config',lambda:{})
    async def reject_handler(_): pytest.fail('dispatch')
    def invoke():
        return asyncio.run(middleware.awrap_tool_call(SimpleNamespace(tool_call=CALL),reject_handler)) if asynchronous else middleware.wrap_tool_call(SimpleNamespace(tool_call=CALL),lambda _:pytest.fail('dispatch'))
    with pytest.raises(module.ToolAuthorityError): invoke()
    monkeypatch.setattr(module,'get_config',lambda:config('http://trusted.example'))
    original=httpx.AsyncClient
    def fail(request): raise httpx.ReadTimeout('secret transport detail')
    def client(**kwargs):
        assert kwargs=={'timeout':5.0,'follow_redirects':False,'trust_env':False}
        return original(transport=httpx.MockTransport(fail),**kwargs)
    monkeypatch.setattr(module.httpx,'AsyncClient',client)
    with pytest.raises(module.ToolAuthorityError,match='unavailable'):
        invoke()


def test_native_graph_requires_explicit_authority():
    from deep_agent_service.native_graph import create_native_graph
    from test_native_graph import model,sandbox
    with pytest.raises(TypeError,match='tool_authority'):
        create_native_graph(model(),sandbox=sandbox(),pinned_skills=[],interrupt_on={})


def test_graph_denial_is_checked_once_without_dispatch_or_retry():
    from langchain_core.tools import tool
    from langchain_core.messages import AIMessage
    from deep_agent_service.native_graph import create_native_graph
    from test_native_graph import model,sandbox
    dispatched=[];checks=[]
    @tool
    def side_effect() -> str:
        """Test a guarded side effect."""
        dispatched.append(True);return 'done'
    class Deny:
        def check(self,call): checks.append(call);raise module.ToolAuthorityError('denied')
        async def acheck(self,call): self.check(call)
    graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'dispatch-1','name':'side_effect','args':{}}])),
                              sandbox=sandbox(),pinned_skills=[],interrupt_on={},tool_authority=Deny(),tools=[side_effect])
    with pytest.raises(module.ToolAuthorityError):
        graph.invoke({'messages':[{'role':'user','content':'run tool'}]},config={'configurable':{'disable_task_auto_classify':True}})
    assert len(checks)==1 and dispatched==[]


@pytest.mark.parametrize('field,value',[('attempt_id',''),('lease_epoch',True),('lease_epoch',0),('permission_request_id','bad')])
def test_invalid_trusted_identity_fails_before_transport(monkeypatch,field,value):
    context=config('http://trusted.example');context['configurable']['run_control_callback'][field]=value
    monkeypatch.setattr(module,'get_config',lambda:context)
    with pytest.raises(module.ToolAuthorityError): module.HttpNativeToolAuthority()._request(CALL)

@pytest.mark.parametrize('asynchronous',[False,True])
@pytest.mark.parametrize('mode',['slow','oversize'])
def test_real_slow_drip_total_deadline_and_response_cap(monkeypatch,asynchronous,mode):
    import time
    dispatched=[]
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers['content-length']))
            self.send_response(200);self.end_headers()
            try:
                if mode=='oversize': self.wfile.write(b' '*(module.AUTHORITY_MAX_RESPONSE_BYTES+1));self.wfile.flush()
                else:
                    for _ in range(40): self.wfile.write(b' ');self.wfile.flush();time.sleep(0.05)
            except (BrokenPipeError,ConnectionResetError): pass
        def log_message(self,*args): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setattr(module,'get_config',lambda:config(f'http://127.0.0.1:{server.server_port}'))
    monkeypatch.setattr(module,'AUTHORITY_DEADLINE_SECONDS',0.2)
    middleware=module.NativeToolAuthority(module.HttpNativeToolAuthority())
    async def handler(_): dispatched.append(True)
    start=time.monotonic()
    try:
        with pytest.raises(module.ToolAuthorityError):
            if asynchronous: asyncio.run(middleware.awrap_tool_call(SimpleNamespace(tool_call=CALL),handler))
            else: middleware.wrap_tool_call(SimpleNamespace(tool_call=CALL),lambda _:dispatched.append(True))
        assert time.monotonic()-start<0.8
        assert dispatched==[]
    finally: server.shutdown();server.server_close();thread.join()
