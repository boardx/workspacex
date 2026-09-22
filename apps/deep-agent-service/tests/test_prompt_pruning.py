"""#3749 R3: a prompt must not instruct the model to call tools this deployment lacks."""
from deep_agent_service.prompt_pruning import absent_tools, prune_absent_tool_sentences


def test_drops_only_the_sentences_naming_absent_tools():
    prompt = ("先想清楚要不要调用 call_skill。\n\n"
              "歧义时先调用 confirm_task_intent 复述理解。参数不全时调用 fill_run_params。\n\n"
              "要打开页面用 browser_navigate。fetch_url 适用于读取公开网页正文。")
    out = prune_absent_tool_sentences(prompt, absent_tools(hitl_disabled=True, browser_mounted=False))
    assert "call_skill" in out and "fetch_url" in out
    assert "confirm_task_intent" not in out and "fill_run_params" not in out and "browser_navigate" not in out
    # the paragraph that lost every sentence is gone, not left as blank lines
    assert "\n\n\n" not in out and out.count("\n\n") == 1


def test_identity_when_nothing_is_absent():
    prompt = "a。b。\n\nc。"
    assert prune_absent_tool_sentences(prompt, frozenset()) == prompt
    assert absent_tools(hitl_disabled=False, browser_mounted=True) == frozenset()


def test_surviving_text_is_byte_identical():
    prompt = "保留这一句，一个字都不改。调用 confirm_task_intent 的这句要走。"
    out = prune_absent_tool_sentences(prompt, absent_tools(hitl_disabled=True, browser_mounted=True))
    assert out == "保留这一句，一个字都不改。"
