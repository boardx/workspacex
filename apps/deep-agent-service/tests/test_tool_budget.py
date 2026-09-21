"""#3749 R1: tools the model cannot use must not ride in every prompt."""
import pytest
from deep_agent_service.tool_budget import ToolBudgetMiddleware, excluded_tool_names, prune_tools


class Req:
    def __init__(self, tools, tool_choice=None):
        self.tools, self.tool_choice = tools, tool_choice
    def override(self, **kw):
        r = Req(self.tools, self.tool_choice)
        for k, v in kw.items(): setattr(r, k, v)
        return r


def test_env_parsing():
    assert excluded_tool_names({"DEEP_AGENT_EXCLUDED_TOOLS": "grep, glob ,,delete"}) == frozenset({"grep", "glob", "delete"})
    assert excluded_tool_names({}) == frozenset()
    assert excluded_tool_names({"DEEP_AGENT_EXCLUDED_TOOLS": "  "}) == frozenset()


def test_prune_keeps_order_and_unnamed_tools():
    class T:
        def __init__(self, name): self.name = name
    tools = [T("ls"), {"name": "grep"}, {"function": {"name": "task"}}, object(), T("call_skill")]
    kept = prune_tools(tools, frozenset({"grep", "task"}))
    assert [getattr(t, "name", None) or "?" for t in kept] == ["ls", "?", "call_skill"]
    # an unknown shape is kept: a tool we cannot identify is not one we may silently drop
    assert len(kept) == 3


def test_prune_is_identity_without_exclusions():
    tools = [{"name": "a"}, {"name": "b"}]
    assert prune_tools(tools, frozenset()) is tools


@pytest.mark.anyio
async def test_middleware_filters_the_request_and_clears_a_dangling_tool_choice():
    seen = []
    async def handler(req):
        seen.append(req); return "ok"
    mw = ToolBudgetMiddleware(excluded=frozenset({"grep", "write_todos"}))
    req = Req([{"name": "grep"}, {"name": "ls"}, {"name": "write_todos"}], tool_choice="write_todos")
    assert await mw.awrap_model_call(req, handler) == "ok"
    assert [t["name"] for t in seen[-1].tools] == ["ls"]
    assert seen[-1].tool_choice is None


@pytest.mark.anyio
async def test_middleware_passes_the_request_through_untouched_when_nothing_matches():
    seen = []
    async def handler(req):
        seen.append(req); return "ok"
    req = Req([{"name": "ls"}], tool_choice="ls")
    await ToolBudgetMiddleware(excluded=frozenset({"grep"})).awrap_model_call(req, handler)
    assert seen[-1] is req


@pytest.fixture
def anyio_backend(): return "asyncio"


@pytest.mark.anyio
async def test_per_run_exclusions_come_from_configurable(monkeypatch):
    """The API decides per turn (canvas request ⇒ no skill tools); env and config union."""
    import deep_agent_service.tool_budget as tb
    monkeypatch.setattr(tb, "per_run_excluded_tools", lambda: frozenset({"call_skill", "list_org_skills"}))
    seen = []
    async def handler(req):
        seen.append(req); return "ok"
    req = Req([{"name": "call_skill"}, {"name": "list_org_skills"}, {"name": "write_todos"}, {"name": "grep"}])
    await tb.ToolBudgetMiddleware(excluded=frozenset({"grep"})).awrap_model_call(req, handler)
    assert [t["name"] for t in seen[-1].tools] == ["write_todos"]


def test_per_run_exclusions_are_empty_outside_a_graph_run():
    """`get_config()` raises outside a LangGraph node; that is 'no per-run exclusions', not a crash."""
    from deep_agent_service.tool_budget import per_run_excluded_tools
    assert per_run_excluded_tools() == frozenset()
