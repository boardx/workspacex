"""Real graph/tool runtime: refused local preview does not prevent explicit publication."""
import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode

from deep_agent_service.native_artifact_publish import artifact_publish_tool
from deep_agent_service.standard_browser_tools import standard_browser_tools, StandardBrowserError


@pytest.mark.parametrize('asynchronous', [False, True])
@pytest.mark.parametrize('local_preview', [True, False])
def test_three_independent_publications_survive_refused_local_preview(asynchronous, local_preview):
    requests = []
    published = {}
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['content-length'])))
            requests.append(self.path)
            if not self.path.endswith('/native-artifacts/stage'):
                self.send_response(503); self.end_headers(); return
            args = body['toolArgs']
            published[args['idempotencyKey']] = args
            receipt = {'publishId': str(uuid4()), 'status': 'staged', 'sha256': 'a' * 64, 'sizeBytes': 3}
            self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(receipt).encode())
        def log_message(self, *_):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    specs = [('word.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
             ('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
             ('launch-flow.png', 'image/png')]
    calls = [{'id': f'publish-{index}', 'name': 'wx_artifact_publish', 'args': {
        'workspacePath': '/workspace/' + name, 'title': name, 'mediaType': mime, 'idempotencyKey': f'file-{index}'}}
        for index, (name, mime) in enumerate(specs)]
    calls.insert(2, {'id': 'optional-preview', 'name': 'browser_navigate', 'args': {'url': 'file:///workspace/launch-flow.png' if local_preview else 'https://example.com'}})
    def model(state):
        results = [m for m in state['messages'] if isinstance(m, ToolMessage)]
        if len(results) == 3:
            assert results[-1].status == 'error'
            assert 'not opened' in results[-1].content
            assert 'wx_artifact_publish' in results[-1].content
        return {'messages': [AIMessage(content='done' if len(results) == len(calls) else '',
                                       tool_calls=[] if len(results) == len(calls) else [calls[len(results)]])]}
    builder = StateGraph(MessagesState)
    builder.add_node('model', model)
    builder.add_node('tools', ToolNode([artifact_publish_tool(), *standard_browser_tools()], handle_tool_errors=False))
    builder.add_edge(START, 'model'); builder.add_conditional_edges('model', lambda s: 'tools' if s['messages'][-1].tool_calls else END)
    builder.add_edge('tools', 'model'); graph = builder.compile()
    config = {'configurable': {'native_runtime': {'bindingId': str(uuid4())}, 'run_control_callback': {
        'base_url': f'http://127.0.0.1:{server.server_port}', 'key': 'synthetic-key', 'org_id': 'org',
        'run_id': 'run', 'attempt_id': 'run:0', 'lease_epoch': 1}}}
    try:
        def invoke():
            return asyncio.run(graph.ainvoke({'messages': []}, config)) if asynchronous else graph.invoke({'messages': []}, config)
        if not local_preview:
            with pytest.raises(StandardBrowserError):
                invoke()
            assert len(requests) == 3
            assert len(published) == 2  # unknown network outcome remains fatal, never auto-publishes
            return
        result = invoke()
        assert result['messages'][-1].content == 'done'
        assert len(requests) == 3  # file URL never crosses the transport boundary
        assert [item['title'] for item in published.values()] == [name for name, _ in specs]
        assert len({item['workspacePath'] for item in published.values()}) == 3
    finally:
        server.shutdown(); server.server_close(); thread.join()
