"""The `deepagents` graph this service serves via `langgraph dev` (#739).

`langgraph.json`'s `graphs["Deep Agent"]` points at `graph` below -- the string "Deep Agent"
is also the `assistant_id` #740's `DeepAgentModelProvider` must submit runs against, the
same way `deep-research-model-provider.ts`'s `ASSISTANT_ID = "Deep Researcher"` matches
`open_deep_research`'s own `langgraph.json`.

2026-08-08 补：已在 VM 上用真实 Python 3.11 + `deepagents==0.7.5` + 真实模型凭据端到端
验证过（coord-main 实测，不是猜测）——建线程 → 提交 run → agent 先说明"我先查看当前可用
的技能列表" → 调用 `list_org_skills` → 调用 `call_skill` → 拿到真实结果 → 给出最终答案，
全程真实模型响应。验证中发现并修复了这里的一个真实 bug：`langgraph dev` 用文件路径
（`./src/deep_agent_service/graph.py:graph`）加载这个模块时是按文件路径 import，不是按
包名 import，相对导入（`from .model import ...`）会报 `attempted relative import with
no known parent package`——改成绝对导入（`from deep_agent_service.model import ...`）
后验证通过。以此为准：这个模块内部的导入必须用绝对路径，不能用相对路径，即使
`deep_agent_service` 本身是通过 `pip install -e .` 装好的包。
"""
from __future__ import annotations

from deepagents import create_deep_agent

from deep_agent_service.harness import (
    build_checkpointer,
    build_interrupt_on,
    build_middleware,
    build_subagents,
)
from deep_agent_service.model import build_chat_model
from deep_agent_service.tools import build_tools

SYSTEM_PROMPT = (
    "你是本组织的通用助手（由 deepagents 驱动，系统预置）。收到任务后先想清楚要不要调用"
    "已挂载的技能、调用哪一个，可以用 list_org_skills 看看有哪些技能可用，再用 call_skill"
    "把具体任务交给对应技能真正执行——不要凭技能的名字或已有印象直接编答案。"
)

_model = build_chat_model()

# DA-02（#1749）：harness 现代化。middleware 与 checkpointer 的选择理由、
# 每一项对应哪个 rubric 维度，见 harness.py 模块注释——那里是单一事实源，这里不复述。
# checkpointer 为 None 时（平台托管环境）create_deep_agent 收到 None 与 0.7.6
# 之前的行为逐字一致（参数默认值就是 None，实测签名确认）。
graph = create_deep_agent(
    model=_model,
    tools=build_tools(_model),
    system_prompt=SYSTEM_PROMPT,
    middleware=build_middleware(_model),
    checkpointer=build_checkpointer(),
    interrupt_on=build_interrupt_on(),
    # DA-05（#1838，rubric D5）：具名研究子代理。灰度开关未开时返回 None，
    # 与 create_deep_agent 的参数默认值逐字一致——行为与接线前完全相同。
    subagents=build_subagents(_model),
)
