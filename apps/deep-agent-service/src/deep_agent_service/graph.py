"""The `deepagents` graph this service serves via `langgraph dev` (#739).

`langgraph.json`'s `graphs["Deep Agent"]` points at `graph` below -- the string "Deep Agent"
is also the `assistant_id` #740's `DeepAgentModelProvider` must submit runs against, the
same way `deep-research-model-provider.ts`'s `ASSISTANT_ID = "Deep Researcher"` matches
`open_deep_research`'s own `langgraph.json`.

⚠ NOT independently verified end-to-end in #739: this sandbox's Python is 3.9, `deepagents`
requires `>=3.11` (confirmed via `pip install deepagents -v`, not a network/index issue --
see PR description), so `from deepagents import create_deep_agent` below has never actually
been imported or run here. `model.py` and `tools.py` (imported by this module) ARE covered
by real unit tests using only `langchain-core`, which DOES install and run on this sandbox's
Python -- see `tests/`. Whoever deploys this (VM, Python >=3.11) should treat first-run
verification as still outstanding, not assumed from this PR's tests passing.
"""
from __future__ import annotations

from deepagents import create_deep_agent

from .model import build_chat_model
from .tools import build_tools

SYSTEM_PROMPT = (
    "你是本组织的通用助手（由 deepagents 驱动，系统预置）。收到任务后先想清楚要不要调用"
    "已挂载的技能、调用哪一个，可以用 list_org_skills 看看有哪些技能可用，再用 call_skill"
    "把具体任务交给对应技能真正执行——不要凭技能的名字或已有印象直接编答案。"
)

_model = build_chat_model()

graph = create_deep_agent(
    model=_model,
    tools=build_tools(_model),
    system_prompt=SYSTEM_PROMPT,
)
