"""Streamed token chunks are persisted in batches, in order, and never reordered across
modes; the ledger reuses one connection for the hot path and reads events incrementally
(Mac实测 2026-09-17: one row + one connect per token made an 1 800-token canvas take
9 minutes to persist after the model finished in 72 s, #3716)."""
import pytest

from deep_agent_service.self_hosted_runtime import EventBatcher, PostgresLedger


@pytest.fixture
def anyio_backend(): return "asyncio"


class RecordingLedger:
    def __init__(self): self.batches = []
    async def append_events(self, run_id, items): self.batches.append((run_id, list(items)))


@pytest.mark.anyio
async def test_chunks_are_coalesced_and_other_modes_flush_first():
    ledger = RecordingLedger()
    b = EventBatcher(ledger, "r", max_items=32, max_age_s=60)
    for i in range(5): await b.add("messages", {"t": i})
    assert ledger.batches == []                      # still buffered
    await b.add("updates", {"node": "x"})            # flushes the 5 chunks, then writes the update
    await b.add("messages", {"t": 5})
    await b.flush()
    assert [(rid, [e for e, _ in items]) for rid, items in ledger.batches] == [
        ("r", ["messages"] * 5), ("r", ["updates"]), ("r", ["messages"]),
    ]
    assert [d["t"] for _, items in ledger.batches[:1] for _, d in items] == [0, 1, 2, 3, 4]


@pytest.mark.anyio
async def test_batch_size_and_age_bound_the_latency():
    ledger = RecordingLedger()
    b = EventBatcher(ledger, "r", max_items=3, max_age_s=60)
    for i in range(7): await b.add("messages", {"t": i})
    assert [len(items) for _, items in ledger.batches] == [3, 3]   # 1 still buffered
    aged = EventBatcher(ledger, "r", max_items=1000, max_age_s=0.0)
    await aged.add("messages", {"t": 0})              # age bound hit immediately
    assert len(ledger.batches) == 3 and len(ledger.batches[-1][1]) == 1


class FakeConnection:
    def __init__(self): self.calls, self.closed = [], False
    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        class R:
            def fetchall(_): return [{"sequence": 7, "event": "messages", "data": {}}]
            def fetchone(_): return {"status": "running"}
        return R()


@pytest.mark.anyio
async def test_postgres_ledger_batches_into_one_insert_and_reads_after_sequence(monkeypatch):
    ledger = PostgresLedger("postgresql://x")
    conn = FakeConnection()
    connects = []
    monkeypatch.setattr(ledger, "_connect", lambda: connects.append(1) or conn)
    await ledger.append_events("r", [("messages", {"a": 1}), ("messages", {"a": 2}), ("updates", None)])
    await ledger.events("r", after=5)
    await ledger.get_run("t", "r")
    assert connects == [1]                                  # one connection for all three calls
    sql, params = conn.calls[0]
    assert sql.count("(%s,%s,%s::jsonb)") == 3 and len(params) == 9 and params[1] == "messages"
    assert conn.calls[1][1] == ("r", 5) and "sequence>%s" in conn.calls[1][0]


@pytest.mark.anyio
async def test_hot_connection_is_replaced_once_after_operational_error(monkeypatch):
    import psycopg
    ledger = PostgresLedger("postgresql://x")
    made = []
    class Flaky(FakeConnection):
        def execute(self, sql, params=None):
            if len(made) == 1: raise psycopg.OperationalError("server closed the connection")
            return super().execute(sql, params)
    monkeypatch.setattr(ledger, "_connect", lambda: made.append(Flaky()) or made[-1])
    await ledger.update_run("r", "success")
    assert len(made) == 2 and made[1].calls
