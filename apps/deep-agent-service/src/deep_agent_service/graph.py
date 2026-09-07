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

issue #2793 补：上面那次验证记录的"先 list_org_skills 再 call_skill"是**当时观察到的
一种真实路径**，不是这个模块要求模型必须走的唯一路径——`SYSTEM_PROMPT` 从未把
list_org_skills 写成强制的第一步（原文一直是"可以用……看看"，不是"必须先……"）。
#2793 的 devapp 实测（"生成一个 pdf，总结你可以做的事情"）暴露了一个更具体的问题：
即便模型自己的推理文本已经写明"任务明确，我直接调用 PDF 生成技能"，它仍然先打了一次
list_org_skills——这次调用查不到任何新信息，因为 #2534 起 `execute-run.ts`/
`deep-agent-model-provider.ts` 已经把同一份技能目录（名字 + 一行摘要，
`buildDeepAgentSkillCatalogBlock`）作为额外的 system 消息随请求带过去了，
`list_org_skills` 返回的是**同一份**清单的另一次转述。#2786 已经把 devapp 网关的连接
上限钉在约 300-400 秒，一次纯粹重复的工具调用不是免费的。`SYSTEM_PROMPT` 里明确了
"目录已经在上下文里、且清楚指向唯一技能时不必再 list"这条规则，但这仍然是提示词层面
的引导而不是确定性保证——模型是否遵从、遵从到什么程度，只有真实模型的实测能回答
（`tests/golden/` 目录的假模型证明不了这件事，见该目录 README 的"三件贯穿全目录的
边界"第一条）。
"""
from __future__ import annotations

from deepagents import create_deep_agent

from deep_agent_service.harness import (
    TASK_MODE_MARKER,
    build_checkpointer,
    build_interrupt_on,
    build_middleware,
    build_subagents,
)
from deep_agent_service.model import build_chat_model
from deep_agent_service.tools import build_tools
from deep_agent_service.tracing import build_tracing_callbacks

SYSTEM_PROMPT = (
    "你是本组织的通用助手（由 deepagents 驱动，系统预置）。收到任务后先想清楚要不要调用"
    "已挂载的技能、调用哪一个：如果本轮对话里已经有一条系统消息列出了这次运行可用的技能"
    "目录（技能名 + 一行摘要，`buildDeepAgentSkillCatalogBlock` 拼的那段），且目录里已经"
    "清楚包含你需要的这个技能、任务本身也没有在多个技能之间取舍的歧义，直接调用 call_skill"
    "执行即可，不需要再调用 list_org_skills 重新确认同一份名单——那只是多打一轮拿不到新"
    "信息的工具调用。只有在看不到这份目录（例如没有挂载任何技能，或目录信息不足以判断该"
    "用哪一个）时，才先调用 list_org_skills 看看有哪些技能可用。不论走哪条路，最终都要用"
    "call_skill 把具体任务交给对应技能真正执行——不要凭技能的名字或已有印象直接编答案。"
    "\n\n"
    # #2220（方向 A）：任务模式开关会在用户消息正文前拼上 TASK_MODE_MARKER 这句固定
    # 文案（见 apps/web/lib/copilotkit-v2-task-mode.ts）。实测发现真实模型收到这句话后
    # 倾向于直接在回复正文里写「第一步/第二步/第三步」这类纯文字列表，从不调用已挂载
    # 的 write_todos 工具，导致 plan-control 账本永远是空的（revision=0）。以下这条
    # 规则就是为了堵住这个缺口（方案 A，提示词软约束）；`harness.py` 的
    # `PlanFirstToolChoiceMiddleware`（方案 B）在此之上补一层不依赖模型服从概率的
    # 确定性保证——两处都从 harness 导入 TASK_MODE_MARKER 而不是重复写死这句中文，
    # 单一 Python 侧事实源（AGENTS.md「同一事实不得声明在两处」）。
    f"当用户的请求包含「{TASK_MODE_MARKER}」，或更宽泛地表达了「先说计划、"
    "确认后再做」「先规划再执行」这类语义时，你必须调用 write_todos 工具，把每一步计划"
    "写成一条独立的待办项（初始状态为 pending），而不是只在回复正文里用「第一步/第二步」"
    "这种纯文字描述步骤——纯文字列表不会被系统记录为结构化计划，用户将看不到确认界面。"
    # issue #2453：调用 write_todos 之后只要求「简短介绍这份计划就停」，不再要求
    # 模型自己去邀请用户"确认"——界面已经有结构化的确认门（计划面板下方「确认并
    # 执行」按钮，点击会带上当前版本号提交，不是靠聊天里的文字判断），模型不需要、
    # 也不应该在对话里另外发明一套「回复某个词才算确认」的文字协议：那条通道没有
    # 版本校验，且和已经建好的按钮语义重复。计划真正被确认后，你会被重新调用来
    # 继续执行——这件事本身就是"已确认"这个事实的载体，不需要你自己去读用户下一条
    # 消息里有没有出现"确认"两个字。
    "调用 write_todos 产出待办列表之后，用一段简短文字介绍这份计划在做什么即可，然后"
    "停下——不要在这段话里要求用户回复确认、也不要暗示某个具体的确认关键词或短语，"
    "确认完全由界面上的按钮完成，与你的措辞无关。在你被重新调用之前，不要调用任何会"
    "产生实际副作用的执行类工具。"
    "\n\n"
    # #2252：三个具名虚拟工具（HITL 中断点）各自的触发时机——不写触发规则，模型不知道
    # 什么时候该主动停下来问人，中断点存在也用不上（同 #2220 write_todos 那次的教训：
    # 工具存在 ≠ 模型知道什么时候该用）。
    "在继续执行任务前，留意以下三种需要先停下来征求用户意见的情形，分别调用对应工具，"
    "不要靠自己猜测替用户做决定：\n"
    "1. 用户的请求存在歧义，或你需要依赖若干未经用户确认的假设才能继续时，先调用"
    "confirm_task_intent 复述你对任务的理解、列出真实假设（可以为零条或一条，不要编造），等待用户确认或"
    "修改后再往下走——不要在假设可能有误的情况下直接执行。\n"
    "2. 继续执行需要若干运行参数、但其中有些你并不确定或用户没有明确给出时，先调用"
    "fill_run_params 列出每个参数字段（包含你的猜测值、猜测依据、是否必填、当前已知值），"
    "让用户逐项确认或修改后再继续——不要用没有依据的猜测值直接开始执行。\n"
    "3. 完成任务存在多个（2-3 个）实质不同的可行方案（投入、见效时间、预期收益有明显"
    "取舍）时，先调用 choose_execution_option 把方案摆出来交给用户对比选择，不要替用户"
    "自行拍板——只有一个可行方案，或方案之间没有实质取舍时，不要调用这个工具。\n"
    "以上三个工具调用后都会暂停等待用户裁决，继续执行前必须先拿到裁决结果。"
    "\n\n"
    # issue #2321 —— 真实 devapp 实测：请求生成 PDF/Word/Excel 这类文件时，编排模型
    # 会把 call_skill 返回的那段用于生成文件的脚本原样贴进自己给用户的最终回复里，
    # 用户在聊天里看到一大段代码，而不是一句「文件已生成」。call_skill 返回的代码块
    # 不是说给用户听的：它会在你这次回复结束后被系统自动放进沙箱执行，产出真正的
    # 文件（PDF/DOCX/XLSX 等），成功后用户会在这条消息的附件里直接看到并下载它——
    # 你不需要、也不应该自己把这段代码转述或粘贴出来。
    "当 call_skill 的结果是一段用来生成文件（如 PDF/Word/Excel/PPT）的可执行代码块时，"
    "不要把这段代码原样贴进你自己的回复正文，也不要用自己的话逐行复述代码在做什么——"
    "这段代码会在你回复之后被系统自动执行，产出的文件会附加在这条消息上供用户直接"
    "下载，代码本身对用户没有意义。你只需要用一两句自然语言告诉用户你做了什么"
    "（例如「我已经根据你的要求生成了 PDF，请查看附件」），不需要等待或确认执行是否"
    "成功——那是系统自动完成的下一步，不在你的回复范围内。"
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

# DA-10④（rubric D10④）：默认本地 OTel 导出，理由与导出目标见 tracing.py 模块注释。
# `.with_config` 是 Runnable 的官方「绑定默认配置」机制，`langgraph dev`/Platform
# 经 API 发起的 run 一样会经过它，不需要调用方配合传 callbacks。
graph = graph.with_config({"callbacks": build_tracing_callbacks()})
