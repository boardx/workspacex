"""#3749 R5: a fetched page must not evict the conversation it was fetched for."""
import pytest
from deep_agent_service.standard_web_tools import _clip_for_context, web_text_budget_chars


def test_budget_from_env(monkeypatch):
    monkeypatch.delenv("DEEP_AGENT_WEB_TEXT_CHARS", raising=False)
    assert web_text_budget_chars() == 0
    monkeypatch.setenv("DEEP_AGENT_WEB_TEXT_CHARS", "6000")
    assert web_text_budget_chars() == 6000
    monkeypatch.setenv("DEEP_AGENT_WEB_TEXT_CHARS", "not-a-number")
    assert web_text_budget_chars() == 0


def test_fetch_url_text_is_clipped_and_the_cut_is_visible(monkeypatch):
    monkeypatch.setenv("DEEP_AGENT_WEB_TEXT_CHARS", "10")
    out = _clip_for_context({"text": "x" * 25, "truncated": False, "contentHash": "h"})
    assert out["text"] == "x" * 10
    assert out["truncated"] is True
    assert out["clippedForContext"] == {"keptChars": 10, "originalChars": 25}
    assert out["contentHash"] == "h", "the hash still covers the full text the API fetched"


def test_short_pages_and_disabled_budget_pass_through(monkeypatch):
    monkeypatch.setenv("DEEP_AGENT_WEB_TEXT_CHARS", "10")
    short = {"text": "abc", "truncated": False}
    assert _clip_for_context(short) is short
    monkeypatch.setenv("DEEP_AGENT_WEB_TEXT_CHARS", "0")
    big = {"text": "x" * 100, "truncated": False}
    assert _clip_for_context(big) is big


def test_web_search_snippets_share_one_budget(monkeypatch):
    monkeypatch.setenv("DEEP_AGENT_WEB_TEXT_CHARS", "10")
    out = _clip_for_context({"results": [{"snippet": "a" * 8}, {"snippet": "b" * 8}, {"snippet": "c" * 8}]})
    assert sum(len(h["snippet"]) for h in out["results"]) <= 10
    assert out["truncated"] is True
