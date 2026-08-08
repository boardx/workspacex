"""The two dynamic, org-scoped tools (#739 -- architecture decided in #738).

## Why two GENERIC tools instead of one tool per Skill

The TS tool loop being replaced (`apps/api/src/application/agent-run/tool-definitions.ts`)
registers ONE tool per pinned Skill, because that loop is built fresh, in-process, for
every single run. A `deepagents` graph served via `langgraph dev` is the opposite shape:
one process, one `langgraph.json`, one `create_deep_agent(...)` call at import time -- and
an organization's Skill set is runtime data that changes independently of this process's
lifecycle. Baking one tool per Skill into the graph at import time would mean either
restarting this service every time any org's Skills change, or serving a fixed Skill list
that quietly drifts from what `skills`/`skill_versions` actually holds. Neither is
acceptable, so the tool SET is static (`list_org_skills`, `call_skill`) and the Skill DATA
is dynamic, carried per-run through `RunnableConfig["configurable"]["org_skills"]` -- the
caller (`apps/api`'s `DeepAgentModelProvider`, #740) puts the run's already-pinned Skill
list there when it creates the thread/run, exactly the same list `readPinnedSkills` already
resolved for the TS path. This service never queries workspacex's own database for Skill
content, matching the existing `open_deep_research` integration's discipline of staying a
standalone service with no direct DB access (see #738's investigation).

## Why `call_skill` makes a REAL model call, not a canned response

Same requirement the human's task description states explicitly for the TS version it
replaces: "语义要和刚被替换掉的 TS 版本等价（拿 skill 内容当 system prompt 发起真实模型
调用，返回真实结果，不是编造）". This mirrors `execute-run.ts`'s `executeSkillTool`
one-for-one: a SEPARATE, focused model call whose system prompt is only that Skill's
content, task text as the user turn, real response returned. A failure (skill not found,
model call raises) becomes a result TEXT the orchestrating deep agent can see and react
to -- never an exception that aborts the whole run, same discipline `executeSkillTool`'s
own doc comment describes ("Never throws").
"""
from __future__ import annotations

from typing import Callable, TypedDict

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool


class OrgSkill(TypedDict):
    stable_name: str
    name: str
    content: str


def _read_org_skills(config: RunnableConfig) -> list[OrgSkill]:
    configurable = (config or {}).get("configurable") or {}
    skills = configurable.get("org_skills") or []
    # Tolerant of a malformed/missing entry (a caller bug elsewhere should not crash this
    # tool) -- same "never throw, degrade to an explainable result" discipline as the rest
    # of this file.
    return [
        s for s in skills
        if isinstance(s, dict) and isinstance(s.get("stable_name"), str) and isinstance(s.get("content"), str)
    ]


def _find_skill(skills: list[OrgSkill], stable_name: str) -> OrgSkill | None:
    for skill in skills:
        if skill["stable_name"] == stable_name:
            return skill
    return None


def build_tools(model: BaseChatModel) -> list[Callable[..., str]]:
    """Bind the two tools to a concrete chat model (dependency injection, not a module-level
    singleton) -- this is what makes `tools.py` testable without a real `deepagents`/network
    dependency: tests pass a fake `BaseChatModel` and inspect what `call_skill` sends it.
    """

    @tool
    def list_org_skills(config: RunnableConfig) -> str:
        """列出本次运行可用的技能（组织已导入、已 pin 到这次对话的技能），每项包含技能的
        工具名（调用 call_skill 时要用的 skill_stable_name）和人类可读名称。调用其他工具
        之前，先用这个看看有哪些技能可用。"""
        skills = _read_org_skills(config)
        if not skills:
            return "本次运行没有挂载任何技能，直接依靠已有知识回答即可。"
        lines = [f"- {s['stable_name']}：{s['name']}" for s in skills]
        return "\n".join(lines)

    @tool
    def call_skill(skill_stable_name: str, task: str, config: RunnableConfig) -> str:
        """调用一个已挂载的技能，让它针对给定任务真正执行一次并返回结果——不是复述这个
        技能会做什么，而是把任务交给它去做。`skill_stable_name` 必须是 list_org_skills
        返回过的工具名之一；`task` 要写清这个技能需要知道的全部上下文，描述得越具体，
        结果越可用。"""
        skills = _read_org_skills(config)
        skill = _find_skill(skills, skill_stable_name)
        if skill is None:
            return (
                f"未知技能「{skill_stable_name}」：本次运行挂载的技能里没有这一个，"
                "先调用 list_org_skills 看看有哪些，或直接根据已有信息回答。"
            )
        try:
            response = model.invoke(
                [
                    {"role": "system", "content": skill["content"]},
                    {"role": "user", "content": task},
                ]
            )
            text = (response.content if isinstance(response.content, str) else str(response.content)).strip()
            if text == "":
                raise ValueError("skill tool call returned empty content")
            return text
        except Exception:
            # The provider's own error text stays server-side (same discipline
            # `ModelCallError`/`executeSkillTool` use on the TS side) -- the orchestrating
            # deep agent only sees that the call failed, not why.
            return f"技能「{skill['name']}」执行失败。"

    return [list_org_skills, call_skill]
