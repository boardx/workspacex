"""issue #2793 -- `graph.py` 的 `SYSTEM_PROMPT` 是否已经把"目录已经在上下文里、且清楚
指向唯一技能时不需要再调用 list_org_skills"这条规则写清楚。

## 为什么只测提示词文本，不测模型真实会不会少调用一次工具

`list_org_skills` 从来都不是被 middleware/harness 强制调用的（与 `TaskClassifierMiddleware`
强制 `write_todos` 那种"确定性保证"是两回事）——它是模型自主决定要不要调的工具，
`build_interrupt_on()`/`build_middleware()` 都不碰它。见 #2793 的调查结论：唯一能影响
"模型会不会先调用它"这件事的，只有 `SYSTEM_PROMPT` 这段提示词，以及 #2534 起随请求
一起送过去的技能目录 system 消息（`apps/api` 的 `buildDeepAgentSkillCatalogBlock`）。

这意味着这里能验证的只有"提示词文本里有没有这条规则"，验证不了"真实模型看到这条规则
后是否真的会少打一次 `list_org_skills`"——那是 `tests/golden/` 假模型证明不了的一类
问题（该目录 README"三件贯穿全目录的边界"第一条：假模型证明的是引擎行为，不是模型
质量/服从度），需要活体实测（`scripts/live-evidence.sh`）才能回答。本文件只做提示词
文本这一层能做到、且诚实的那一半。

## 为什么用 monkeypatch 设两个假环境变量再 import，而不是像 test_harness.py 那样只
   import harness.py

`SYSTEM_PROMPT` 常量本身定义在 `graph.py`（不是 `harness.py`），而 `graph.py` 在
模块顶层会跑 `_model = build_chat_model()` 和 `create_deep_agent(...)`（`graph.py` 自己
"one process, one `create_deep_agent(...)` call at import time"那条设计）——
`build_chat_model()` 缺 `KERNEL_MODEL_BASE_URL`/`KERNEL_MODEL_API_KEY` 时会
fail-closed 抛 `DeepAgentModelConfigError`（`model.py` 的既有纪律：宁可建图时就炸，
不要留到第一次工具调用才炸）。这两个变量在 CI（`deep-agent-tests.yml`）里从未设置，
构造 `ChatOpenAI` 客户端本身不发网络请求，用假值即可安全导入。
"""
from __future__ import annotations

import importlib
import sys


def _import_graph_with_fake_model_env(monkeypatch):  # noqa: ANN001, ANN202
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "http://localhost:1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    # 防御性地清掉可能残留的缓存 import——这个模块目前只有本文件会 import 它，但
    # 不假设未来不会有第二个测试文件也这样做（`test_tools.py`/`test_harness.py` 都
    # 刻意避免 import 它正是为了不承担这份重量，见两个文件各自头注）。
    sys.modules.pop("deep_agent_service.graph", None)
    return importlib.import_module("deep_agent_service.graph")


def test_system_prompt_allows_skipping_list_org_skills_when_catalog_already_answers_it(monkeypatch):  # noqa: ANN001, ANN201
    """正证：目录已知、且清楚指向唯一技能时，提示词明确允许直接 call_skill，不必先
    list_org_skills——这是 #2793 那次"任务明确却仍先 list"实测要补的那句话。"""
    graph = _import_graph_with_fake_model_env(monkeypatch)
    prompt = graph.SYSTEM_PROMPT

    assert "list_org_skills" in prompt
    assert "call_skill" in prompt
    # 明确的"目录已经够用时不必再 list"表述——不是泛泛提到 list_org_skills 就算数。
    assert "不需要再调用 list_org_skills" in prompt
    assert "buildDeepAgentSkillCatalogBlock" in prompt, (
        "提示词应当点名它在依赖哪个具体的目录来源，而不是含糊地说『之前的消息』——"
        "点名了将来 buildDeepAgentSkillCatalogBlock 改名/挪位置时，这条断言会提醒来改这里。"
    )


def test_system_prompt_still_offers_list_org_skills_for_missing_or_ambiguous_catalog(monkeypatch):  # noqa: ANN001, ANN201
    """反证方向的regression guard：加"可以跳过"这条规则，不能把"看不到目录/拿不准该用
    哪个技能时可以先 list"这条既有出路一起删掉——#2793 的任务描述明确要求"不破坏真正
    有歧义/多技能场景下的技能发现"。"""
    graph = _import_graph_with_fake_model_env(monkeypatch)
    prompt = graph.SYSTEM_PROMPT

    assert "看不到这份目录" in prompt or "看不到这份目录（" in prompt
    assert "看看有哪些技能可用" in prompt


def test_system_prompt_keeps_the_no_fabrication_rule(monkeypatch):  # noqa: ANN001, ANN201
    """regression guard：新增的"可以跳过 list_org_skills"分支，不能连带削弱"最终必须
    真的调用 call_skill 执行，不许凭印象编答案"这条既有安全约束——两者描述的是任务
    流程的两个不同阶段（要不要先确认目录 vs. 要不要真的调用技能执行），互不冲突，
    删掉后者会让 #1747 之前"复述技能会做什么"那类问题重新出现。"""
    graph = _import_graph_with_fake_model_env(monkeypatch)
    prompt = graph.SYSTEM_PROMPT

    assert "不要凭技能的名字或已有印象直接编答案" in prompt


def test_system_prompt_clarifies_underspecified_document_generation_before_execution(monkeypatch):  # noqa: ANN001, ANN201
    """A format choice is not enough information to invent a document's content."""
    graph = _import_graph_with_fake_model_env(monkeypatch)
    prompt = graph.SYSTEM_PROMPT

    assert "文档生成任务" in prompt
    assert "主题" in prompt
    assert "内容来源" in prompt
    assert "fill_run_params" in prompt
    assert "同一次回复只能调用 fill_run_params" in prompt
    assert "示例" in prompt and "你决定" in prompt
    assert "已有对话和附件" in prompt
    assert "不能把格式选择当成内容需求" in prompt


def test_system_prompt_flags_research_report_tasks_as_needing_confirm_task_intent(monkeypatch):  # noqa: ANN001, ANN201
    """issue #3455 -- devapp 实测（#3413 T31）：发「研究一下 2024 年 AI 大模型发展趋势，
    生成一份分析报告」这类调研/分析任务时，模型直接开始 read_file/web_search/fetch_url，
    全程未调用 confirm_task_intent，与手册 B7（task 31）的判据不符。

    根因主体在 `harness.py::_prepare_auto_classified_request`（见该函数与 `graph.py`
    这段 SYSTEM_PROMPT 的模块注释）：这类被判为多步的请求，第一次模型调用此前被
    强制 `tool_choice="write_todos"`，`confirm_task_intent` 根本不在候选里；那条修法
    有专门的 `test_harness.py::test_task_classifier_middleware_widens_choice_to_
    write_todos_or_confirm_task_intent_sync` 反证。这里测的是**次要、互补**的提示词
    加固——即便某次请求没被判类为「多步」，模型仍可能因为句子读起来通顺就误判没有
    歧义，忽略『调研并写报告』这类任务隐含的范围/时间窗口/信息来源/深度/格式假设。
    本测试只能断言提示词文本包含这条具体规则，断不了"真实模型看到后是否真的会调用
    confirm_task_intent"（同文件头注的既有边界，需要活体实测回答，见 issue #3455 的
    三步反证证据：两个根因——判类强制机制排斥 + 提示词缺具体例子——都已用真实
    DashScope 模型验证）。"""
    graph = _import_graph_with_fake_model_env(monkeypatch)
    prompt = graph.SYSTEM_PROMPT

    assert "confirm_task_intent" in prompt
    assert "调研/研究/分析某个主题并产出一份报告" in prompt
    assert "不要因为任务读起来通顺就默认没有歧义" in prompt
    assert "范围、时间窗口、信息来源、深度或产出格式" in prompt
    # regression guard：新规则不能吞掉"用户已经讲清楚就不用问"这条既有豁免，否则会
    # 反向制造 B7 判据自己点名的另一种缺陷（"一句『你好』也非要确认一遍"）。
    assert "只有当" in prompt and "才可以跳过这一步直接执行" in prompt
