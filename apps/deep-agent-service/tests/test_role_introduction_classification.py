"""Actual D003 introduction must not force planning; action counterexamples retain it.

This checks routing, not real-model obedience or disabling any permission gate.
"""
import pytest
from deep_agent_service.harness import (
    TASK_CATEGORY_NO_PLAN,
    _classify_task_text,
)


@pytest.mark.parametrize("role", ["D002", "D003", "D011", "D005"])
def test_explicit_read_only_role_intro_does_not_require_a_plan(role):
    text = (
        f"验收 {role}：请准确介绍你的角色背景、专业方法、可用 Skills 与 workflow、产物类型和权限边界。"
        "仅依据本角色当前配置，不引用其他对话记忆；没有的能力请明确说明。先不要执行任务或调用外部系统。"
    )
    assert _classify_task_text(text) == TASK_CATEGORY_NO_PLAN


@pytest.mark.parametrize("text", [
    "介绍你的角色背景，然后生成一个 PDF 并发给管理员。",
    "请介绍你的角色背景，随后生成研究简报。",
    "验收产品经理，创建 PRD、保存文件并发送邮件。",
    "先不要执行任务。介绍你的角色背景，然后创建项目并删除旧项目。",
])
def test_actual_actions_do_not_gain_role_intro_exception(text):
    assert _classify_task_text(text) != TASK_CATEGORY_NO_PLAN
