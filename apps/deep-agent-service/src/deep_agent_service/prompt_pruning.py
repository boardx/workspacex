"""Don't tell the model about tools it does not have.

WorkspaceX Local mounts neither the three HITL tools (`confirm_task_intent`,
`fill_run_params`, `choose_execution_option` — `DEEP_AGENT_HITL_CLARIFICATION=off`) nor the
browser tools (legacy profile). The system prompt still spent ~1 700 characters instructing
the model to call them, and then contradicted itself at the end with "本部署是单人本地版：
这三个工具不可用" (recording proxy capture, 2026-09-22). A 4B model reads both halves.

So the prompt is pruned deterministically instead: every SENTENCE naming an absent tool is
dropped, sentence granularity rather than paragraph because one paragraph mixes
`browser_navigate` (absent) with `fetch_url` (present) and dropping the whole paragraph would
lose real guidance. Nothing is rewritten — surviving text is byte-identical to the original.
"""
from __future__ import annotations

import re

# A sentence ends at 。！？ or a newline; keep the terminator with the sentence.
_SENTENCE = re.compile(r"[^。！？\n]*[。！？\n]|[^。！？\n]+$")


def prune_absent_tool_sentences(prompt: str, absent: frozenset[str]) -> str:
    """Every sentence of `prompt` that does not name a tool in `absent`, in order.

    Paragraph structure (`\\n\\n`) is preserved; a paragraph left empty is dropped so the
    result never contains a run of blank lines where a section used to be.
    """
    if not absent:
        return prompt
    kept_paragraphs: list[str] = []
    for paragraph in prompt.split("\n\n"):
        kept = [s for s in _SENTENCE.findall(paragraph) if not any(name in s for name in absent)]
        text = "".join(kept).strip("\n")
        if text.strip():
            kept_paragraphs.append(text)
    return "\n\n".join(kept_paragraphs)


HITL_TOOLS = frozenset({"confirm_task_intent", "fill_run_params", "choose_execution_option"})
BROWSER_TOOLS = frozenset({
    "browser_navigate", "browser_snapshot", "browser_click", "browser_take_screenshot",
})


def absent_tools(*, hitl_disabled: bool, browser_mounted: bool) -> frozenset[str]:
    """Tool names this deployment does not mount and must therefore not advertise."""
    absent: set[str] = set()
    if hitl_disabled:
        absent |= HITL_TOOLS
    if not browser_mounted:
        absent |= BROWSER_TOOLS
    return frozenset(absent)
