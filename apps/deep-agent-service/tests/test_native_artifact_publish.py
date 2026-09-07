import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage
from langgraph.prebuilt import ToolNode
from langgraph.graph import StateGraph, MessagesState, START, END
from deep_agent_service.native_artifact_publish import artifact_publish_tool

ARGS={'workspacePath':'/workspace/a.txt','title':'a.txt','mediaType':'text/plain','idempotencyKey':'one'}

@pytest.mark.parametrize('asynchronous',[False,True])
@pytest.mark.parametrize('status',[200,503])
def test_official_tool_runtime_real_http_identity_and_staged_only(asynchronous,status):
    seen=[]
    receipt={'publishId':str(uuid4()),'status':'staged','sha256':'a'*64,'sizeBytes':3}
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append(json.loads(self.rfile.read(int(self.headers['content-length']))))
            self.send_response(status);self.end_headers();self.wfile.write(json.dumps(receipt).encode())
        def log_message(self,*_):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    config={'configurable':{'native_runtime':{'bindingId':str(uuid4())},'run_control_callback':{'base_url':f'http://127.0.0.1:{server.server_port}','key':'secret','org_id':'org','run_id':'run','attempt_id':'attempt','lease_epoch':1}}}
    builder=StateGraph(MessagesState)
    builder.add_node('tools',ToolNode([artifact_publish_tool()],handle_tool_errors=False))
    builder.add_edge(START,'tools');builder.add_edge('tools',END);node=builder.compile()
    value={'messages':[AIMessage(content='',tool_calls=[{'id':'actual-call','name':'wx_artifact_publish','args':ARGS}])]}
    try:
        def invoke():return asyncio.run(node.ainvoke(value,config)) if asynchronous else node.invoke(value,config)
        if status==200:
            result=invoke();assert json.loads(result['messages'][-1].content)==receipt
        else:
            with pytest.raises(Exception,match='no ready'):invoke()
        assert len(seen)==1
        assert seen[0]['toolCallId']=='actual-call' and seen[0]['orgId']=='org' and seen[0]['toolArgs']==ARGS
        assert 'key' not in seen[0]
    finally:server.shutdown();server.server_close();thread.join()

def test_schema_hides_context_and_rejects_extra_args():
    schema=artifact_publish_tool().args_schema
    assert set(schema['properties'])==set(ARGS)
    assert schema['additionalProperties'] is False
