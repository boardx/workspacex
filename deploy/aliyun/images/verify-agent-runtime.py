"""Import real production graphs offline; this does not start/license the server."""
import importlib.metadata
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
print('PASS offline production graph imports and configuration; no server/license/model-run acceptance')
