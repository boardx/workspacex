"""Refuse attribution when the installed graph differs from the shared identity manifest."""
import json
from importlib.metadata import version
from pathlib import Path

IDENTITIES = json.loads((Path(__file__).parent / "generated/native_tool_identities.json").read_text())


def verify_native_tool_identities(graph):
    node = graph.nodes["tools"]
    tools = getattr(node, "bound", node).tools_by_name
    for identity in IDENTITIES:
        source = identity["source"]
        module, factory = source["locator"].split(":", 1)
        tool = tools.get(identity["canonicalName"])
        if version("deepagents") != source["revision"] or tool is None:
            raise RuntimeError("Native tool implementation no longer matches its standard identity")
        for function in (tool.func, tool.coroutine):
            if (function is None or function.__module__ != module
                    or not function.__qualname__.startswith(factory + ".<locals>.")):
                raise RuntimeError("Native tool implementation no longer matches its standard identity")
