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
    list_org_skills, _ = build_tools(FakeChatModel("unused"))
    result = list_org_skills.invoke({}, config=SKILL_CONFIG)
    assert result == "- diagram-maker：画图技能"


def test_list_org_skills_empty_when_none_pinned() -> None:
    list_org_skills, _ = build_tools(FakeChatModel("unused"))
    result = list_org_skills.invoke({}, config={"configurable": {}})
    assert "没有挂载任何技能" in result


def test_call_skill_makes_a_real_model_call_with_skill_content_as_system_prompt() -> None:
    model = FakeChatModel("the real answer")
    _, call_skill = build_tools(model)

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
    _, call_skill = build_tools(model)

    result = call_skill.invoke(
        {"skill_stable_name": "nope", "task": "x"}, config=SKILL_CONFIG,
    )

    assert "未知技能「nope」" in result
    assert model.received_messages == []


def test_call_skill_empty_content_is_a_failure_not_an_empty_reply() -> None:
    _, call_skill = build_tools(FakeChatModel(""))

    result = call_skill.invoke(
        {"skill_stable_name": "diagram-maker", "task": "t"}, config=SKILL_CONFIG,
    )

    assert result == "技能「画图技能」执行失败。"


def test_call_skill_model_exception_returns_text_never_raises() -> None:
    _, call_skill = build_tools(RaisingChatModel())

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
    _, call_skill = build_tools(model)

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
    _, call_skill = build_tools(model)

    call_skill.invoke(
        {"skill_stable_name": "diagram-maker", "task": "t"}, config=SKILL_CONFIG,
    )

    assert model.received_messages[0][0]["content"] == "You draw diagrams."


def test_a_blank_protocol_is_treated_as_absent_not_as_a_trailing_separator() -> None:
    """Fail closed on a malformed value: an empty/whitespace `script_protocol` would
    otherwise append a bare separator to every skill's system prompt, silently changing the
    prompt of every run whose caller sent the field wrong."""
    model = FakeChatModel("answer")
    _, call_skill = build_tools(model)

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
