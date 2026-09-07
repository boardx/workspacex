"""Actual loopback HTTP, generated schemas and trusted identity; no external model."""
import asyncio,json,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from types import SimpleNamespace
import importlib
import pytest

@pytest.mark.parametrize('module,name,args,output,code',[
 ('standard_artifact_download','wx_artifact_download',{'artifactId':'a','versionId':'v','purpose':'download'},{'downloadRef':'https://downloads.example/downloads/opaque','expiresAt':'2026-09-07T00:01:00Z','artifactVersion':{'artifactId':'a','versionId':'v'}},200),
 ('standard_run_status','wx_run_status',{'runId':'target'},{'status':'succeeded','steps':[],'waitingRequest':None,'artifactRefs':[],'observedAt':'2026-09-07T00:00:00Z'},200),
 ('standard_run_cancel','wx_run_cancel',{'runId':'target','idempotencyKey':'cancel'},{'cancellationRequested':True,'childCancellation':{'kind':'unavailable'}},202)])
def test_real_http_identity_and_redirect_refusal(module,name,args,output,code):
    subject=importlib.import_module('deep_agent_service.'+module)
    calls=[];redirect=False
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['content-length'])))
            calls.append((self.path,body,self.headers['x-deep-agent-internal-key']))
            self.send_response(307 if redirect else code)
            if redirect:self.send_header('location','/must-not-follow')
            data=json.dumps(output).encode();self.send_header('content-length',str(len(data)));self.end_headers();self.wfile.write(data)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    try:
        callback={'base_url':f'http://127.0.0.1:{server.server_port}','org_id':'org','run_id':'caller','attempt_id':'caller:0','lease_epoch':1,'key':'fixture-only'}
        runtime=SimpleNamespace(config={'configurable':{'run_control_callback':callback}},tool_call_id='actual-tool-call')
        assert asyncio.run(subject._invoke(args,runtime))==output
        assert calls[0][1]=={'orgId':'org','attemptId':'caller:0','leaseEpoch':1,'toolCallId':'actual-tool-call','toolName':name,'toolArgs':args}
        assert calls[0][0].startswith('/internal/agent-runs/caller/')
        assert calls[0][2]=='fixture-only'
        redirect=True
        with pytest.raises(RuntimeError):asyncio.run(subject._invoke(args,runtime))
        assert len(calls)==2
        with pytest.raises(RuntimeError):asyncio.run(subject._invoke({**args,'orgId':'attacker'},runtime))
        assert len(calls)==2
    finally:server.shutdown();server.server_close();worker.join()
