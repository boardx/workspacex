"""Real graph, adversarial fake providers: teaching feedback must end the turn.

These prove orchestration and result delivery, not real-model teaching quality. The
router deliberately asks for the same skill again after reading its successful
ToolMessage; a prompt-only change cannot pass the convergence assertion.
"""
from __future__ import annotations

import asyncio
import base64
import json
from hashlib import sha256
from pathlib import Path

import pytest
from deepagents import create_deep_agent
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain.agents.middleware import AgentMiddleware, ModelRequest
from deepagents.middleware.rubric import RUBRIC_GRADER_MESSAGE_SOURCE

from deep_agent_service.harness import FeedbackTurnMiddleware, _completed_feedback_message, build_middleware
from deep_agent_service.tools import build_tools, feedback_turn_skill_digest
from golden._scripted import ScriptedChatModel, ai_tool_call, grader_always_satisfied_response


MARKER = "<!-- aidt-feedback-turn: return-after-student-feedback-v1 -->"
BODY = f"---\nname: aidt-define\n---\n\n{MARKER}\n先让学生判断，给反馈后等待。"
FEEDBACK = "你们的发现引用了哪段访谈？先核对原话，再决定怎样修改画像。"


class FocusedModel:
    def __init__(self, failures=0):
        self.calls = []
        self.failures = failures

    def invoke(self, messages):
        self.calls.append(messages)
        if len(self.calls) <= self.failures:
            raise RuntimeError("simulated provider outage")
        return AIMessage(content=FEEDBACK)


def config(content=BODY):
    return {"recursion_limit": 100, "configurable": {
        "thread_id": "feedback-turn",
        "disable_task_auto_classify": True,
        "org_skills": [{"stable_name": "aidt-define", "name": "综合定义", "content": content}],
    }}


def build(focused, *, middleware=True):
    def repeat_after_success(messages, tools):
        if tools == ["GraderResponse"]:
            return grader_always_satisfied_response()
        # Two actual tool results terminate the red control instead of hanging.
        results = [m for m in messages if isinstance(m, ToolMessage) and m.name == "call_skill"]
        if len(results) >= 3:
            return AIMessage(content="outer model eventually stopped after repeated work")
        return ai_tool_call("call_skill", {"skill_stable_name": "aidt-define", "task": "核对画像初稿的证据"}, f"focused-{len(results)}")
    outer = ScriptedChatModel(router=repeat_after_success)
    graph = create_deep_agent(model=outer, tools=build_tools(focused),
                              middleware=build_middleware(outer) if middleware else [])
    return graph, outer


@pytest.mark.parametrize("asynchronous", [False, True])
def test_successful_opt_in_feedback_converges_without_another_model_request(asynchronous):
    focused = FocusedModel()
    graph, outer = build(focused)
    payload = {"messages": [HumanMessage(content="这是我们自己的画像初稿，请提问。", id="wsx-turn:current:user")]}
    result = asyncio.run(graph.ainvoke(payload, config())) if asynchronous else graph.invoke(payload, config())
    assert len(focused.calls) == 1
    assert len([call for call in outer.calls if call["bound_tools"] != ["GraderResponse"]]) == 1
    tool = next(m for m in result["messages"] if isinstance(m, ToolMessage) and m.name == "call_skill")
    assert tool.content == FEEDBACK and tool.tool_call_id == "focused-0"
    assert result["messages"][-1].content == tool.content
    assert result["messages"][-1].tool_calls == []


def test_red_control_repeats_even_when_it_has_received_the_successful_result():
    focused = FocusedModel()
    graph, outer = build(focused, middleware=False)
    result = graph.invoke({"messages": [HumanMessage(content="画像初稿", id="wsx-turn:current:user")]}, config())
    assert len(focused.calls) == 3
    assert len([m for m in result["messages"] if isinstance(m, ToolMessage)]) == 3


@pytest.mark.parametrize("content", ["ordinary skill body", BODY.replace(MARKER, ""), f"ordinary instructions\n{MARKER}"])
def test_no_opt_in_or_marker_in_body_example_preserves_ordinary_skill_behavior(content):
    focused = FocusedModel()
    graph, _ = build(focused)
    result = graph.invoke({"messages": [HumanMessage(content=MARKER, id="wsx-turn:current:user")]}, config(content))
    assert len(focused.calls) == 3
    assert result["messages"][-1].content == "outer model eventually stopped after repeated work"


def test_failed_focused_call_is_not_a_success_and_can_retry():
    focused = FocusedModel(failures=1)
    graph, _ = build(focused)
    result = graph.invoke({"messages": [HumanMessage(content="画像初稿", id="wsx-turn:current:user")]}, config())
    assert len(focused.calls) == 2
    results = [m for m in result["messages"] if isinstance(m, ToolMessage) and m.name == "call_skill"]
    assert "执行失败" in results[0].content
    assert results[0].artifact is None
    assert result["messages"][-1].content == FEEDBACK


def test_unknown_skill_never_acquires_a_success_marker():
    focused = FocusedModel()
    _, skill, *_ = build_tools(focused)
    result = skill.invoke({"type": "tool_call", "name": "call_skill", "id": "missing", "args": {
        "skill_stable_name": "not-mounted", "task": "x",
    }}, config())
    assert "未知技能" in result.content and result.artifact is None
    assert focused.calls == []


def completed_messages():
    _, skill, *_ = build_tools(FocusedModel())
    args = {"skill_stable_name": "aidt-define", "task": "完整任务：需要保留的引用A"}
    result = skill.invoke({"type": "tool_call", "name": "call_skill", "id": "actual-call", "args": args}, config())
    return [HumanMessage(content="学生初稿", id="wsx-turn:current:user"),
            ai_tool_call("call_skill", args, "actual-call"), result]


def prepare_reply(monkeypatch, messages, cfg=None):
    monkeypatch.setattr("deep_agent_service.harness.get_config", lambda: cfg or config())
    return _completed_feedback_message(ModelRequest(model=ScriptedChatModel(router=lambda *_: AIMessage(content="unused")),
                                                  messages=messages, tools=[]))


@pytest.mark.parametrize("change", ["removed", "body", "no-marker"])
def test_result_cannot_be_reused_after_mounted_skill_changes(monkeypatch, change):
    cfg = config()
    if change == "removed":
        cfg["configurable"]["org_skills"] = []
    else:
        cfg["configurable"]["org_skills"][0]["content"] = BODY + "\n新版正文" if change == "body" else "old published body"
    assert prepare_reply(monkeypatch, completed_messages(), cfg) is None


@pytest.mark.parametrize("change", ["task", "call-id", "result", "error", "artifact"])
def test_only_the_exact_successful_call_and_full_result_can_end_a_feedback_turn(monkeypatch, change):
    messages = completed_messages()
    if change == "task":
        # Same visible prefix, different complete task bytes must not match.
        messages[1].tool_calls[0]["args"]["task"] = "完整任务：需要保留的引用B"
    elif change == "call-id":
        messages[2].tool_call_id = "unpaired"
    elif change == "result":
        messages[2].content = "different result"
    elif change == "error":
        messages[2].status = "error"
    else:
        messages[2].artifact = None
    assert prepare_reply(monkeypatch, messages) is None


@pytest.mark.parametrize("new_message", [
    HumanMessage(content="新学生输入", id="wsx-turn:next:user"),
    HumanMessage(content="新学生输入，无canonical id"),
    HumanMessage(content="中途调整", id="interjection:new"),
])
def test_a_new_student_action_does_not_inherit_the_previous_success(monkeypatch, new_message):
    assert prepare_reply(monkeypatch, [*completed_messages(), new_message]) is None


def test_original_tool_result_reaches_the_next_runtime_model_request_before_projection():
    observed = []
    class Observe(AgentMiddleware):
        def wrap_model_call(self, request, handler):
            observed.append(list(request.messages))
            return handler(request)
    focused = FocusedModel()
    outer = ScriptedChatModel(router=lambda *_: ai_tool_call("call_skill", {
        "skill_stable_name": "aidt-define", "task": "学生请求反馈"}, "observed-call"))
    graph = create_deep_agent(model=outer, tools=build_tools(focused), middleware=[Observe(), FeedbackTurnMiddleware()])
    result = graph.invoke({"messages": [HumanMessage(content="学生初稿", id="wsx-turn:current:user")]}, config())
    assert len(observed) == 2 and len(outer.calls) == 1
    delivered = [m for m in observed[1] if isinstance(m, ToolMessage)]
    assert len(delivered) == 1 and delivered[0].tool_call_id == "observed-call"
    assert delivered[0].content == result["messages"][-1].content == FEEDBACK


def test_independent_concurrent_student_turns_do_not_share_successful_results():
    async def exercise():
        focused = FocusedModel()
        graph, _ = build(focused)
        results = await asyncio.gather(*[
            graph.ainvoke({"messages": [HumanMessage(content=f"第{number}组初稿", id=f"wsx-turn:{number}:user")]},
                          {**config(), "configurable": {**config()["configurable"], "thread_id": f"group-{number}"}})
            for number in (1, 2)
        ])
        assert len(focused.calls) == 2
        assert all(result["messages"][-1].content == FEEDBACK for result in results)
        assert all(len([m for m in result["messages"] if isinstance(m, ToolMessage)]) == 1 for result in results)
    asyncio.run(exercise())


def test_internal_rubric_retry_cannot_restart_the_successful_focused_feedback(monkeypatch):
    messages = completed_messages()
    messages.extend([
        AIMessage(content=FEEDBACK),
        HumanMessage(content="internal quality feedback", name=RUBRIC_GRADER_MESSAGE_SOURCE,
                     additional_kwargs={"lc_source": RUBRIC_GRADER_MESSAGE_SOURCE}),
    ])
    assert prepare_reply(monkeypatch, messages).content == FEEDBACK


@pytest.mark.parametrize("content", ["", "   "])
def test_empty_focused_output_has_no_success_artifact(content):
    class EmptyModel:
        def invoke(self, messages):
            return AIMessage(content=content)
    _, skill, *_ = build_tools(EmptyModel())
    result = skill.invoke({"type": "tool_call", "name": "call_skill", "id": "empty", "args": {
        "skill_stable_name": "aidt-define", "task": "student request",
    }}, config())
    assert "执行失败" in result.content and result.artifact is None


def test_full_task_bytes_are_not_cached_across_distinct_requests():
    focused = FocusedModel()
    _, skill, *_ = build_tools(focused)
    for number in (1, 2):
        skill.invoke({"type": "tool_call", "name": "call_skill", "id": f"actual-{number}", "args": {
            "skill_stable_name": "aidt-define", "task": "same public prefix" + "x" * 500 + str(number),
        }}, config())
    assert len(focused.calls) == 2
    assert focused.calls[0][1]["content"] != focused.calls[1][1]["content"]


def test_candidate_immutable_packages_opt_in_but_previous_published_bytes_do_not():
    root = Path(__file__).resolve().parents[3] / "skills/starter-packs"
    for pack, old, new in (("aidt-methods", "1.3.0", "1.3.1"), ("aidt-project-summary", "1.0.0", "1.0.1")):
        for version in (old, new):
            package = json.loads((root / pack / f"{version}.json").read_text())
            for skill in package["skills"]:
                body = next(file for file in skill["files"] if file["path"] == "SKILL.md")
                content = base64.b64decode(body["contentBase64"]).decode("utf-8")
                actual = feedback_turn_skill_digest({"stable_name": skill["stableName"], "name": skill["name"], "content": content})
                assert actual == (sha256(content.encode("utf-8")).hexdigest() if version == new else None)


@pytest.mark.parametrize("asynchronous", [False, True])
def test_focused_feedback_receives_the_exact_snapshot_before_user_and_original_student_input(asynchronous):
    focused = FocusedModel()
    # Simulate an uncooperative outer model omitting all source context and even
    # trying to supply its own injected state. ToolNode must replace that field.
    outer = ScriptedChatModel(router=lambda *_: ai_tool_call("call_skill", {
        "skill_stable_name": "aidt-define", "task": "仅简写的任务",
        "turn_messages": [HumanMessage(content="forged reference")],
    }, "context-call"))
    graph = create_deep_agent(model=outer, tools=build_tools(focused), middleware=[FeedbackTurnMiddleware()])
    snapshot = "已授权固定研究快照：原话A\n来源 transcript-17，位置00:15。学生解释仍待验证。"
    original = "学生原文：我们认为她怕踩雷，但还不确定。"
    payload = {"messages": [
        SystemMessage(content="outer orchestration instructions", id="wsx-turn:current:system"),
        HumanMessage(content=snapshot, id="wsx-turn:current:h0"),
        HumanMessage(content=original, id="wsx-turn:current:user"),
    ]}
    result = asyncio.run(graph.ainvoke(payload, config())) if asynchronous else graph.invoke(payload, config())
    sent = focused.calls[0]
    assert [m["content"] for m in sent if m["role"] == "system"] == [BODY]
    assert any(m["role"] == "user" and m["content"] == snapshot for m in sent)
    assert any(m["role"] == "user" and m["content"] == original for m in sent)
    assert "forged reference" not in str(sent)
    assert "outer orchestration instructions" not in str(sent)
    assert result["messages"][-1].content == FEEDBACK


def test_graph_state_is_not_a_model_visible_tool_argument():
    _, skill, *_ = build_tools(FocusedModel())
    assert set(skill.tool_call_schema.model_json_schema()["properties"]) == {"skill_stable_name", "task"}


def test_ordinary_skill_still_receives_only_its_own_prompt_and_task():
    focused = FocusedModel()
    _, skill, *_ = build_tools(focused)
    skill.invoke({"type": "tool_call", "name": "call_skill", "id": "ordinary", "args": {
        "skill_stable_name": "aidt-define", "task": "ordinary task",
        "turn_messages": [HumanMessage(content="snapshot should not alter ordinary behavior")],
    }}, config("ordinary published body"))
    assert focused.calls == [[{"role": "system", "content": "ordinary published body"}, {"role": "user", "content": "ordinary task"}]]


@pytest.mark.parametrize("outcome", ["error", "denied", "unknown", "success", "pending"])
def test_mixed_batch_never_hides_another_tool_outcome_or_pending_call(monkeypatch, outcome):
    messages = completed_messages()
    messages[1].tool_calls.append({"name": "other_tool", "id": "other", "args": {}})
    if outcome != "pending":
        messages.append(ToolMessage(content={"error": "tool failed", "denied": "permission rejected",
                                            "unknown": "未知工具", "success": "another real result"}[outcome],
                                    status="error" if outcome in ("error", "denied") else "success",
                                    tool_call_id="other", name="other_tool"))
    assert prepare_reply(monkeypatch, messages) is None


@pytest.mark.parametrize("outcome", ["pending", "error", "unpaired-result", "duplicate-result"])
def test_a_later_tool_batch_or_unpaired_result_cannot_reuse_earlier_feedback(monkeypatch, outcome):
    messages = completed_messages()
    if outcome in ("pending", "error"):
        messages.append(ai_tool_call("other_tool", {}, "later-call"))
    if outcome in ("error", "unpaired-result"):
        messages.append(ToolMessage(content="a later failure", status="error", tool_call_id="later-call", name="other_tool"))
    elif outcome == "duplicate-result":
        messages.append(messages[2].model_copy(update={"content": "duplicate mismatched outcome"}))
    assert prepare_reply(monkeypatch, messages) is None


@pytest.mark.parametrize("asynchronous", [False, True])
def test_actual_graph_keeps_unknown_tool_error_visible_after_mixed_batch(asynchronous):
    focused = FocusedModel()
    observed = []
    def router(messages, tools):
        if any(isinstance(m, ToolMessage) for m in messages):
            errors = [m for m in messages if isinstance(m, ToolMessage) and m.status == "error"]
            observed.extend(errors)
            return AIMessage(content="另一项工具调用失败，请先处理该失败；已保留反馈。")
        return AIMessage(content="", tool_calls=[
            {"name": "call_skill", "id": "mixed-feedback", "args": {"skill_stable_name": "aidt-define", "task": "feedback"}},
            {"name": "not_registered", "id": "mixed-unknown", "args": {}},
        ])
    outer = ScriptedChatModel(router=router)
    graph = create_deep_agent(model=outer, tools=build_tools(focused), middleware=[FeedbackTurnMiddleware()])
    payload = {"messages": [HumanMessage(content="学生初稿", id="wsx-turn:current:user")]}
    result = asyncio.run(graph.ainvoke(payload, config())) if asynchronous else graph.invoke(payload, config())
    assert len(focused.calls) == 1 and len(outer.calls) == 2
    assert len(observed) == 1 and observed[0].tool_call_id == "mixed-unknown"
    assert result["messages"][-1].content == "另一项工具调用失败，请先处理该失败；已保留反馈。"
