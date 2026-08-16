from __future__ import annotations

import os

import pytest
from langgraph.checkpoint.postgres import PostgresSaver

from deep_agent_service.guided_research_graph import (
    create_guided_research_graph,
    load_guided_research_projection,
    start_guided_research_thread,
)
from deep_agent_service.guided_research_state import initial_guided_research_state


def test_same_thread_resumes_after_process_restart() -> None:
    postgres_url = os.environ.get("GUIDED_RESEARCH_TEST_POSTGRES_URL")
    if not postgres_url:
        pytest.fail("GUIDED_RESEARCH_TEST_POSTGRES_URL is required for the Postgres recovery test")

    with PostgresSaver.from_conn_string(postgres_url) as saver:
        saver.setup()
        config = {
            "configurable": {
                "thread_id": "grs-postgres-recovery",
                "checkpoint_ns": "guided-research:v1",
            }
        }
        first_process = create_guided_research_graph(saver)
        start_guided_research_thread(
            first_process,
            config,
            initial_guided_research_state(
                "grs-postgres-recovery",
                brief_state={
                    "name": "恢复测试",
                    "tags": [],
                    "topic": "进程重启恢复",
                    "objective": "证明 PostgreSQL checkpoint 是状态事实源",
                    "timeRange": "2026",
                    "geography": "全球",
                    "focus": "恢复",
                },
            ),
        )

        second_process = create_guided_research_graph(saver)
        restored = load_guided_research_projection(second_process, config)

    assert restored["sessionId"] == "grs-postgres-recovery"
    assert restored["currentNode"] == "brief"
    assert restored["graphVersion"] == 0

