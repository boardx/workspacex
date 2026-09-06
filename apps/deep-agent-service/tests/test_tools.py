"""Unit tests for `deep_agent_service.tools` (#739).

These run against real `langchain-core` (the `@tool`/`RunnableConfig` injection behaviour
is exercised for real, not mocked) with a fake chat model standing in for the network call
-- no `deepagents` import here, so this file is NOT affected by the Python-version gap
documented in `graph.py`'s header (this sandbox: Python 3.9; `deepagents` requires >=3.11).
Confirmed to actually run in this environment: `pytest apps/deep-agent-service/tests` (see
PR description for the exact command and output).
"""
from __future__ import annotations

from typing import Any

from deep_agent_service.tools import build_tools


class FakeResponse:
    def __init__(self, content: str) -> None:
        self.content = content


class FakeChatModel:
    """Duck-typed stand-in for `BaseChatModel` -- `call_skill` only ever calls `.invoke(...)`
    and reads `.content` off the result, so a full LangChain model subclass would test
    nothing extra here."""

    def __init__(self, content: str) -> None:
        self.content = content
        self.received_messages: list[list[dict[str, Any]]] = []

    def invoke(self, messages: list[dict[str, Any]]) -> FakeResponse:
        self.received_messages.append(messages)
        return FakeResponse(self.content)


class RaisingChatModel:
    def invoke(self, messages: list[dict[str, Any]]) -> FakeResponse:
        raise RuntimeError("simulated transport failure")


SKILL_CONFIG = {
    "configurable": {
        "org_skills": [
            {"stable_name": "diagram-maker", "name": "画图技能", "content": "You draw diagrams."},
        ]
    }
}


def test_list_org_skills_lists_pinned_skills() -> None:
    list_org_skills, _, *_ = build_tools(FakeChatModel("unused"))
    result = list_org_skills.invoke({}, config=SKILL_CONFIG)
    assert result == "- diagram-maker：画图技能"


def test_list_org_skills_empty_when_none_pinned() -> None:
    list_org_skills, _, *_ = build_tools(FakeChatModel("unused"))
    result = list_org_skills.invoke({}, config={"configurable": {}})
    assert "没有挂载任何技能" in result


def test_call_skill_makes_a_real_model_call_with_skill_content_as_system_prompt() -> None:
    model = FakeChatModel("the real answer")
    _, call_skill, *_ = build_tools(model)

    result = call_skill.invoke(
        {"skill_stable_name": "diagram-maker", "task": "画一个流程图"}, config=SKILL_CONFIG,
    )

    assert result == "the real answer"
    assert model.received_messages == [
        [
            {"role": "system", "content": "You draw diagrams."},
            {"role": "user", "content": "画一个流程图"},
        ]
    ]


def test_call_skill_unknown_skill_never_calls_the_model() -> None:
    model = FakeChatModel("should not be used")
    _, call_skill, *_ = build_tools(model)

    result = call_skill.invoke(
        {"skill_stable_name": "nope", "task": "x"}, config=SKILL_CONFIG,
    )

    assert "未知技能「nope」" in result
    assert model.received_messages == []


def test_call_skill_empty_content_is_a_failure_not_an_empty_reply() -> None:
    _, call_skill, *_ = build_tools(FakeChatModel(""))

    result = call_skill.invoke(
        {"skill_stable_name": "diagram-maker", "task": "t"}, config=SKILL_CONFIG,
    )

    assert result == "技能「画图技能」执行失败。"


def test_call_skill_model_exception_returns_text_never_raises() -> None:
    _, call_skill, *_ = build_tools(RaisingChatModel())

    result = call_skill.invoke(
        {"skill_stable_name": "diagram-maker", "task": "t"}, config=SKILL_CONFIG,
    )

    assert result == "技能「画图技能」执行失败。"


# -- #1747: the run-script protocol arrives as per-run config, never authored here --------

PROTOCOL = "You can execute Node.js code in a sandbox to produce real files."

SKILL_CONFIG_WITH_PROTOCOL = {
    "configurable": {
        "org_skills": SKILL_CONFIG["configurable"]["org_skills"],
        "script_protocol": PROTOCOL,
    }
}


def test_call_skill_appends_the_protocol_after_the_skill_body() -> None:
    model = FakeChatModel("```run_script\nconsole.log(1);\n```")
    _, call_skill, *_ = build_tools(model)

    call_skill.invoke(
        {"skill_stable_name": "diagram-maker", "task": "t"}, config=SKILL_CONFIG_WITH_PROTOCOL,
    )

    system = model.received_messages[0][0]["content"]
    # Order matters: the skill's own instructions stay first, the capability statement is
    # appended. A protocol pasted BEFORE the skill body would outrank it.
    assert system.startswith("You draw diagrams.")
    assert system.endswith(PROTOCOL)


def test_call_skill_without_the_protocol_sends_the_skill_body_verbatim() -> None:
    """#1747's non-regression half: no `script_protocol` in config means no sandbox behind
    this run, and the system prompt must be byte-identical to what it was before #1747."""
    model = FakeChatModel("answer")
    _, call_skill, *_ = build_tools(model)

    call_skill.invoke(
        {"skill_stable_name": "diagram-maker", "task": "t"}, config=SKILL_CONFIG,
    )

    assert model.received_messages[0][0]["content"] == "You draw diagrams."


def test_a_blank_protocol_is_treated_as_absent_not_as_a_trailing_separator() -> None:
    """Fail closed on a malformed value: an empty/whitespace `script_protocol` would
    otherwise append a bare separator to every skill's system prompt, silently changing the
    prompt of every run whose caller sent the field wrong."""
    model = FakeChatModel("answer")
    _, call_skill, *_ = build_tools(model)

    call_skill.invoke(
        {"skill_stable_name": "diagram-maker", "task": "t"},
        config={
            "configurable": {
                "org_skills": SKILL_CONFIG["configurable"]["org_skills"],
                "script_protocol": "   ",
            }
        },
    )

    assert model.received_messages[0][0]["content"] == "You draw diagrams."


# -- #2252: the three named virtual HITL tools -------------------------------------------
#
# `HumanInTheLoopMiddleware` re-invokes the SAME underlying function on resume, either with
# the original proposed args verbatim (`approve`) or with the decision's narrower, DIFFERENT
# `editedArgs` shape (`edit`) -- see `tools.py`'s module header for the full citation trail.
# These tests exercise both call shapes directly against the tool function (no
# `deepagents`/interrupt machinery here -- that real-engine wiring is covered by
# `test_harness.py`'s existing HITL suite and, for these three tools specifically, would
# need a `deepagents` install; see PR description for what was and wasn't run for real).


def _tool(name: str):  # noqa: ANN201
    tools = {t.name: t for t in build_tools(FakeChatModel("unused"))}
    return tools[name]


def test_confirm_task_intent_approve_shape_confirms_the_original_understanding() -> None:
    confirm_task_intent = _tool("confirm_task_intent")

    result = confirm_task_intent.invoke(
        {
            "requestId": "req-1",
            "understanding": "生成 7 月增长复盘",
            "assumptions": ["对比口径用同比", "数据截至 7 月底"],
        }
    )

    assert "生成 7 月增长复盘" in result
    assert "对比口径用同比" in result and "数据截至 7 月底" in result


def test_confirm_task_intent_edit_shape_only_carries_assumptions() -> None:
    confirm_task_intent = _tool("confirm_task_intent")

    # edit resume: `ConfirmIntentDecision.editedArgs` only has `assumptions`, no
    # `understanding`/`requestId` (packages/contracts/src/agent-interrupts.ts).
    result = confirm_task_intent.invoke({"assumptions": ["改用环比", "只看付费渠道"]})

    assert "修改了假设" in result
    assert "改用环比" in result and "只看付费渠道" in result


def test_confirm_task_intent_no_assumptions_is_a_failure_not_a_silent_pass() -> None:
    confirm_task_intent = _tool("confirm_task_intent")

    result = confirm_task_intent.invoke({"requestId": "req-1"})

    assert "没有收到有效的假设清单" in result


def test_fill_run_params_approve_shape_adopts_ai_guesses() -> None:
    fill_run_params = _tool("fill_run_params")

    result = fill_run_params.invoke(
        {
            "requestId": "req-2",
            "fields": [
                {
                    "name": "region",
                    "label": "地区",
                    "aiGuess": "华东",
                    "rationale": "最近一次对话提到过华东",
                    "required": True,
                    "currentValue": None,
                },
                {
                    "name": "channel",
                    "label": "渠道",
                    "aiGuess": None,
                    "rationale": None,
                    "required": False,
                    "currentValue": "线上",
                },
            ],
        }
    )

    assert "region=" in result and "华东" in result
    assert "channel=" in result and "线上" in result


def test_fill_run_params_edit_shape_only_carries_name_value_pairs() -> None:
    fill_run_params = _tool("fill_run_params")

    # edit resume: `FillParamsDecision.editedArgs.fields` is `{name, value}`, NOT the full
    # `ParamField` shape (no `label`/`aiGuess`/`rationale`/`required`/`currentValue`).
    result = fill_run_params.invoke(
        {"fields": [{"name": "region", "value": "华南"}]}
    )

    assert "region=" in result and "华南" in result


def test_fill_run_params_no_fields_is_a_failure_not_a_silent_pass() -> None:
    fill_run_params = _tool("fill_run_params")

    result = fill_run_params.invoke({"requestId": "req-2"})

    assert "没有收到需要补全的参数字段" in result


def test_choose_execution_option_edit_shape_resolves_the_selected_option_title() -> None:
    choose_execution_option = _tool("choose_execution_option")

    # The only shape that ever reaches this function body in production: this tool has no
    # `approve` branch (`CHOOSE_OPTION_ALLOWED_DECISIONS = ["edit", "reject"]`), and
    # `reject` never re-invokes the tool at all.
    result = choose_execution_option.invoke(
        {
            "options": [
                {"optionId": "opt-1", "title": "方案A：快速上线", "effort": "低", "timeToValue": "1周", "expectedReturn": "小幅提升"},
                {"optionId": "opt-2", "title": "方案B：深度重构", "effort": "高", "timeToValue": "1月", "expectedReturn": "大幅提升"},
            ],
            "selectedOptionId": "opt-2",
        }
    )

    assert "方案B：深度重构" in result


def test_choose_execution_option_without_options_falls_back_to_the_raw_id() -> None:
    choose_execution_option = _tool("choose_execution_option")

    # `ChooseOptionDecision.editedArgs` is `{selectedOptionId}` only -- no `options` at all.
    result = choose_execution_option.invoke({"selectedOptionId": "opt-2"})

    assert "opt-2" in result


def test_choose_execution_option_no_selection_is_a_failure_not_a_silent_pass() -> None:
    choose_execution_option = _tool("choose_execution_option")

    result = choose_execution_option.invoke({"requestId": "req-3"})

    assert "没有收到用户选择的方案" in result


# ── spawn_async_task（issue #2664）──────────────────────────────────────────

SUBTASK_CONFIG = {
    "configurable": {
        "subtask_callback_base_url": "http://api.internal:3000",
        "subtask_callback_key": "test-shared-secret",
        "org_id": "org-1",
        "parent_run_id": "run-parent-1",
    }
}


def test_spawn_async_task_present_by_default() -> None:
    """Phase 14 F02（R6）：此前由 `DEEP_AGENT_ASYNC_SUBTASKS_ENABLED=1` 这个灰度
    开关控制是否出现在 `build_tools()` 的返回值里（#2664），验证稳定后按 R6 要求
    默认开启且开关本身移除——现在无条件出现（graph.py 无条件转发 build_tools()
    的整个返回值，见 tools.py 该函数自己的注释）。"""
    tools = build_tools(FakeChatModel("unused"))
    assert "spawn_async_task" in [t.name for t in tools]


def _spawn_tool(monkeypatch) -> object:  # noqa: ANN001, ARG001 -- 保留签名，调用方仍传入夹具
    tools = {t.name: t for t in build_tools(FakeChatModel("unused"))}
    return tools["spawn_async_task"]


class _FakeHttpResponse:
    def __init__(self, subtask_run_id: str) -> None:
        self._subtask_run_id = subtask_run_id

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"subtaskRunId": self._subtask_run_id, "status": "pending"}


def _invoke_spawn(spawn, args, config=SUBTASK_CONFIG, call_id="call-test"):
    return spawn.invoke({"name": "spawn_async_task", "args": args,
                         "id": call_id, "type": "tool_call"}, config=config).content


def test_spawn_async_task_three_calls_each_return_immediately_without_waiting(monkeypatch) -> None:  # noqa: ANN001
    """验收标准第一条：一次请求里调用三次，三次都立即拿到「已派发」，不是子任务真正
    跑完的结果——`httpx.post` 被 fake 成同步返回一个「已入队」响应，证明这个工具的
    调用点本身不包含任何"等待子任务执行"的逻辑（真实执行发生在 TS 侧队列，见
    `subtask-run-queue.ts`，不在这个函数体内）。"""
    calls: list[dict] = []

    def fake_post(url, json, headers, timeout):  # noqa: ANN001
        calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        return _FakeHttpResponse(subtask_run_id=f"subtask-{len(calls)}")

    monkeypatch.setattr("deep_agent_service.tools.httpx.post", fake_post)
    spawn_async_task = _spawn_tool(monkeypatch)

    results = [
        _invoke_spawn(spawn_async_task, {"description": f"子任务 {i}"}, call_id=f"call-{i}")
        for i in range(3)
    ]

    assert len(calls) == 3
    for i, result in enumerate(results):
        assert "已派发" in result
        assert f"subtask-{i + 1}" in result
        assert calls[i]["url"] == "http://api.internal:3000/internal/subtask-runs"
        assert calls[i]["json"]["parentRunId"] == "run-parent-1"
        assert calls[i]["json"]["orgId"] == "org-1"
        assert calls[i]["json"]["description"] == f"子任务 {i}"
        assert calls[i]["json"]["idempotencyKey"] == f"call-{i}"
        assert calls[i]["headers"]["x-deep-agent-internal-key"] == "test-shared-secret"


def test_spawn_async_task_without_callback_config_degrades_honestly(monkeypatch) -> None:  # noqa: ANN001
    """本次运行没有配好回调通路（configurable 缺 subtask_callback_base_url/org_id/
    parent_run_id 之一）——诚实告知派发失败，不假装已经派发、不发起任何网络调用。"""
    calls: list[dict] = []
    monkeypatch.setattr(
        "deep_agent_service.tools.httpx.post",
        lambda *a, **k: calls.append({"a": a, "k": k}),  # noqa: ARG005
    )
    spawn_async_task = _spawn_tool(monkeypatch)

    result = _invoke_spawn(spawn_async_task, {"description": "任意子任务"}, config={"configurable": {}})

    assert "无法派发" in result
    assert calls == []


def test_spawn_async_task_http_failure_returns_error_text_never_raises(monkeypatch) -> None:  # noqa: ANN001
    """验收标准第三条的 Python 侧一半：回调本身失败（网络错误/TS 侧拒绝）时，工具返回
    一段可读的失败说明，不抛异常炸掉主 agent 循环——同 call_skill 的既有纪律。"""
    def raising_post(*args, **kwargs):  # noqa: ANN001, ARG001
        raise RuntimeError("simulated connection refused")

    monkeypatch.setattr("deep_agent_service.tools.httpx.post", raising_post)
    spawn_async_task = _spawn_tool(monkeypatch)

    result = _invoke_spawn(spawn_async_task, {"description": "会失败的子任务"})

    assert "派发子任务失败" in result
    assert "RuntimeError" in result


def test_spawn_async_task_context_is_forwarded_when_present(monkeypatch) -> None:  # noqa: ANN001
    calls: list[dict] = []

    def fake_post(url, json, headers, timeout):  # noqa: ANN001
        calls.append(json)
        return _FakeHttpResponse(subtask_run_id="subtask-x")

    monkeypatch.setattr("deep_agent_service.tools.httpx.post", fake_post)
    spawn_async_task = _spawn_tool(monkeypatch)

    _invoke_spawn(spawn_async_task,
        {"description": "子任务", "context": "父任务已确认用户想要中文回复"}, config=SUBTASK_CONFIG,
    )

    assert calls[0]["context"] == "父任务已确认用户想要中文回复"


def test_spawn_replay_uses_injected_identity_not_model_argument(monkeypatch):
    calls = []
    monkeypatch.setattr("deep_agent_service.tools.httpx.post", lambda *a, **k:
                        (calls.append(k["json"]) or _FakeHttpResponse("stable-subtask")))
    spawn = _spawn_tool(monkeypatch)
    assert "tool_call_id" not in spawn.tool_call_schema.model_json_schema()["properties"]
    for _ in range(2):
        _invoke_spawn(spawn, {"description": "same", "tool_call_id": "model-forged"}, call_id="trusted-call")
    assert [call["idempotencyKey"] for call in calls] == ["trusted-call", "trusted-call"]


def test_spawn_missing_result_id_does_not_claim_dispatch(monkeypatch):
    monkeypatch.setattr("deep_agent_service.tools.httpx.post", lambda *a, **k: _FakeHttpResponse(None))
    result = _invoke_spawn(_spawn_tool(monkeypatch), {"description": "same"})
    assert "已派发" not in result
    assert "派发子任务失败" in result


def test_hitl_tools_accept_json_string_arrays_issue_2842():
    """模型把数组参数多编码成 JSON 字符串时（2026-09-06 qwen3.8-max 真实形状），三个 HITL
    工具照常工作——此前 `list[str]` 签名校验失败 ⇒ 模型反复重调 ⇒ 用户点「继续」走不出去。"""
    from deep_agent_service.tools import _coerce_list, build_tools

    assert _coerce_list('["a", "b"]') == ["a", "b"]
    assert _coerce_list("1. a\n2. b") == ["1. a", "2. b"]
    assert _coerce_list(["x"]) == ["x"]
    assert _coerce_list("") is None and _coerce_list(None) is None

    tools = {t.name: t for t in build_tools(FakeChatModel("unused"))}
    out = tools["confirm_task_intent"].invoke({
        "requestId": "r", "understanding": "写报告", "assumptions": '["主题为年度总结", "格式 docx"]',
    })
    assert "主题为年度总结" in out and "格式 docx" in out and "没有收到" not in out
    out = tools["fill_run_params"].invoke({"requestId": "r", "fields": '[{"name": "cc", "value": "a@b"}]'})
    assert "cc=" in out
    out = tools["choose_execution_option"].invoke({
        "requestId": "r", "options": '[{"optionId": "o1", "title": "快"}]', "selectedOptionId": "o1",
    })
    assert "「快」" in out


def test_confirm_intent_zero_and_one_real_assumptions():
    tool = _tool("confirm_task_intent")
    for assumptions in ([], ["使用用户给定资料"]):
        result = tool.invoke({"understanding": "整理报告", "assumptions": assumptions})
        assert "用户已确认对任务的理解：整理报告" in result
        result = tool.invoke({"assumptions": assumptions})
        assert "用户修改了假设" in result
