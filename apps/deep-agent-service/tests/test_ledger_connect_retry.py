"""PostgresLedger._connect: connect timeout / retries come from env (WorkspaceX Local sets 30 s / 2;
cloud default stays 5 s / 0). A ConnectionTimeout under the retry budget is retried, beyond it re-raised."""
import psycopg
import pytest

from deep_agent_service.self_hosted_runtime import PostgresLedger


def _stub_connect(monkeypatch, failures: int):
    calls = []

    def fake_connect(dsn, **kwargs):
        calls.append(kwargs["connect_timeout"])
        if len(calls) <= failures:
            raise psycopg.errors.ConnectionTimeout("connection timeout expired")
        return object()

    monkeypatch.setattr(psycopg, "connect", fake_connect)
    return calls


def test_default_is_five_seconds_no_retry(monkeypatch):
    monkeypatch.delenv("DEEP_AGENT_PG_CONNECT_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("DEEP_AGENT_PG_CONNECT_RETRIES", raising=False)
    calls = _stub_connect(monkeypatch, failures=1)
    with pytest.raises(psycopg.errors.ConnectionTimeout):
        PostgresLedger("postgresql://x")._connect()
    assert calls == [5]


def test_env_sets_timeout_and_retries(monkeypatch):
    monkeypatch.setenv("DEEP_AGENT_PG_CONNECT_TIMEOUT_SECONDS", "30")
    monkeypatch.setenv("DEEP_AGENT_PG_CONNECT_RETRIES", "2")
    calls = _stub_connect(monkeypatch, failures=2)
    assert PostgresLedger("postgresql://x")._connect() is not None
    assert calls == [30, 30, 30]


def test_retry_budget_is_bounded(monkeypatch):
    monkeypatch.setenv("DEEP_AGENT_PG_CONNECT_RETRIES", "1")
    calls = _stub_connect(monkeypatch, failures=5)
    with pytest.raises(psycopg.errors.ConnectionTimeout):
        PostgresLedger("postgresql://x")._connect()
    assert len(calls) == 2
