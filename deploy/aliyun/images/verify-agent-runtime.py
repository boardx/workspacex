"""Import real production graphs offline; this does not start/license the server."""
import importlib.metadata
import os
import socket
from pathlib import Path

from deep_agent_service.graph_selector import select_graph
from deep_agent_service.guided_research_graph import graph as guided_graph

root = Path('/deps/deep-agent-service')
assert not list(root.glob('.env*')), 'developer environment must not enter image'
assert not (root / '.venv').exists(), 'host virtualenv must not enter image'
lock = root / 'requirements.release.txt'
assert lock.is_file(), 'production runtime lock must be packaged'
assert '--hash=sha256:' in lock.read_text()
assert f'langgraph-api=={importlib.metadata.version("langgraph-api")}' in lock.read_text()
graph = select_graph({'configurable': {}})
assert graph.get_graph().nodes
assert guided_graph.get_graph().nodes
assert os.getuid() == 1000, 'Agent must match shared UDS owner'
path = '/run/sessions/agent-permission-probe.sock'
with socket.socket(socket.AF_UNIX) as server:
    server.bind(path)
    server.listen(1)
    with socket.socket(socket.AF_UNIX) as client:
        client.connect(path)
        connection, _ = server.accept()
        connection.close()
os.unlink(path)
print('PASS nonroot offline graph imports, runtime hash lock and shared UDS access; no server/license/model-run acceptance')
