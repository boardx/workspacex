"""Refuse attribution when the installed graph differs from the shared identity manifest."""
import json
from functools import lru_cache
from importlib import import_module
from importlib.metadata import packages_distributions, version
from pathlib import Path

IDENTITIES = json.loads((Path(__file__).parent / "generated/native_tool_identities.json").read_text())
REFUSAL = "Native tool implementation no longer matches its standard identity"


@lru_cache(maxsize=None)
def _distribution(module):
    """Which package ships `module` -- the descriptor pins that package's version, not deepagents'.

    #3014: WX-T009 `write_todos` is upstream `langchain` code, so its declared
    revision has to be read from the distribution its locator actually lives in.
    A module served by no distribution, or by several, is not an identity we can
    pin, so it is refused rather than attributed.
    """
    served = packages_distributions().get(module.split(".", 1)[0], ())
    if len(served) != 1:
        raise RuntimeError(REFUSAL)
    return served[0]


def _attribute(module, qualname):
    value = module
    for part in qualname.split("."):
        value = getattr(value, part, None)
        if value is None:
            return None
    return value


def verify_native_tool_identities(graph):
    node = graph.nodes["tools"]
    tools = getattr(node, "bound", node).tools_by_name
    for identity in IDENTITIES:
        source = identity["source"]
        module_name, symbol = source["locator"].split(":", 1)
        tool = tools.get(identity["canonicalName"])
        if tool is None or version(_distribution(module_name)) != source["revision"]:
            raise RuntimeError(REFUSAL)
        module = import_module(module_name)
        # Upstream ships these two shapes: a factory whose closures are the tool
        # (every FilesystemMiddleware tool, and `task`), or plain module level
        # functions the tool is built from (`write_todos`). Both stay falsifiable --
        # a same-name in-house function is defined in our own module, and even one
        # forced into this module is not the object upstream publishes under that
        # name. `declared` then keeps the locator honest: some implementation has to
        # be the symbol it names, so a stale or invented locator is refused too.
        declared = False
        for function in (tool.func, tool.coroutine):
            if function is None or function.__module__ != module_name:
                raise RuntimeError(REFUSAL)
            qualname = function.__qualname__
            if qualname.startswith(symbol + ".<locals>."):
                declared = True
            elif "<locals>" in qualname or _attribute(module, qualname) is not function:
                raise RuntimeError(REFUSAL)
            elif qualname == symbol:
                declared = True
        if not declared:
            raise RuntimeError(REFUSAL)
