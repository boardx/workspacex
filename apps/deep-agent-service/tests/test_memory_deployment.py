"""Real isolated PostgreSQL deployment checks, including registered memory tool calls.

Set WX_MEMORY_TEST_DSN to an explicitly owned test cluster's bootstrap identity.
Every fixture owns and removes its own database/roles; no shared database is reset.
"""
import asyncio
import os
from types import SimpleNamespace
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from deep_agent_service import memory_deployment as deployment
from deep_agent_service import standard_memory as memory


@pytest.fixture
def prepared_environment(monkeypatch):
    admin_dsn = os.environ.get("WX_MEMORY_TEST_DSN")
    if not admin_dsn:
        pytest.skip("explicit owned PostgreSQL test cluster required")
    suffix = uuid4().hex
    database, owner, runtime = "memory_db_" + suffix, "memory_owner_" + suffix, "memory_rw_" + suffix
    owner_password, runtime_password = uuid4().hex, uuid4().hex
    with psycopg.connect(admin_dsn, autocommit=True) as admin:
        for role, password in ((owner, owner_password), (runtime, runtime_password)):
            admin.execute(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION").format(sql.Identifier(role), sql.Literal(password)))
        admin.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(database), sql.Identifier(owner)))
    runtime_dsn = make_conninfo(admin_dsn, dbname=database, user=runtime, password=runtime_password)
    owner_dsn = make_conninfo(admin_dsn, dbname=database, user=owner, password=owner_password)
    monkeypatch.setenv("MEMORY_STORE_DATABASE_URL", runtime_dsn)
    monkeypatch.setenv("MEMORY_STORE_MIGRATION_DATABASE_URL", owner_dsn)
    monkeypatch.setenv("MEMORY_STORE_SCHEMA", "workspacex_memory")
    monkeypatch.delenv("DATABASE_URI", raising=False)
    yield {"admin": admin_dsn, "owner": owner_dsn, "runtime": runtime_dsn, "role": runtime, "database": database}
    with psycopg.connect(admin_dsn, autocommit=True) as admin:
        admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database)))
        for role in (runtime, owner):
            admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))


def test_prepare_replay_and_real_dml_probe_leave_no_rows(prepared_environment):
    assert deployment.prepare_memory_store() == {"memoryPrepared": True, "runtimeOwnerSeparated": True}
    assert deployment.prepare_memory_store()["memoryPrepared"]
    assert deployment.verify_memory_store()["memoryStoreVerified"]
    with psycopg.connect(prepared_environment["runtime"]) as conn:
        assert conn.execute("SELECT current_user").fetchone()[0] == prepared_environment["role"]
        assert conn.execute("SELECT count(*) FROM workspacex_memory.store").fetchone()[0] == 0
    for statement in ("CREATE SCHEMA forbidden", "CREATE TABLE workspacex_memory.forbidden(id int)",
                      "SELECT * FROM workspacex_memory.store_migrations", "TRUNCATE workspacex_memory.store"):
        with psycopg.connect(prepared_environment["runtime"]) as conn:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(statement)


def test_registered_tools_really_write_search_delete_with_runtime_role_and_scope_separation(prepared_environment, monkeypatch):
    deployment.prepare_memory_store()
    source = {"threadId": "thread", "messageId": "message"}
    async def proof(runtime, *_):
        scope = runtime.config["configurable"]["wsx_memory_scope"]
        return {"scope": scope, "sourceRef": source, "visible": [source]}
    # The API's source-proof HTTP/auth contract has its own real-HTTP lane. Only that
    # boundary is supplied here; tool implementation and PostgreSQL are the real ones.
    monkeypatch.setattr(memory, "_proof", proof)
    tools = {tool.name: tool for tool in memory.standard_memory_tools()}
    def runtime(org, user):
        return SimpleNamespace(config={"configurable": {"wsx_memory_scope": {"orgId": org, "userId": user},
            "run_control_callback": {"org_id": org}}}, tool_call_id="deployment-test")
    async def scenario():
        actor = runtime("org", "actor")
        args = {"text": "explicitly remembered 中文", "sourceMessageId": "message", "idempotencyKey": "test"}
        receipt = await tools["wx_memory_write"].coroutine(runtime=actor, **args)
        assert receipt == await tools["wx_memory_write"].coroutine(runtime=actor, **args)
        # Every operation opens a fresh runtime connection; no process-local cache is used.
        assert (await tools["wx_memory_search"].coroutine(runtime=actor))["items"][0]["text"] == args["text"]
        for other in (runtime("other", "actor"), runtime("org", "other")):
            assert (await tools["wx_memory_search"].coroutine(runtime=other))["items"] == []
        assert await tools["wx_memory_delete"].coroutine(runtime=actor, memoryId=receipt["memoryId"], expectedRevision=1) == {"deleted": True}
        assert (await tools["wx_memory_search"].coroutine(runtime=actor))["items"] == []
    asyncio.run(scenario())


def test_rejects_owner_as_runtime_and_different_database(prepared_environment, monkeypatch):
    monkeypatch.setenv("MEMORY_STORE_DATABASE_URL", prepared_environment["owner"])
    with pytest.raises(deployment.MemoryDeploymentError, match="RUNTIME_ROLE_UNSAFE"):
        deployment.prepare_memory_store()
    monkeypatch.setenv("MEMORY_STORE_DATABASE_URL", prepared_environment["runtime"])
    monkeypatch.setenv("MEMORY_STORE_MIGRATION_DATABASE_URL", prepared_environment["admin"])
    with pytest.raises(deployment.MemoryDeploymentError, match="MIGRATION_IDENTITY_MISMATCH"):
        deployment.prepare_memory_store()


def test_readiness_refuses_missing_schema_and_escalated_permissions(prepared_environment):
    with pytest.raises(psycopg.errors.InvalidSchemaName):
        deployment.verify_memory_store()
    deployment.prepare_memory_store()
    with psycopg.connect(prepared_environment["owner"], autocommit=True) as owner:
        owner.execute(sql.SQL("GRANT CREATE ON SCHEMA workspacex_memory TO {}").format(sql.Identifier(prepared_environment["role"])))
    with pytest.raises(deployment.MemoryDeploymentError, match="PRIVILEGES_INVALID"):
        deployment.verify_memory_store()


def test_rejects_inherited_owner_membership(prepared_environment):
    with psycopg.connect(prepared_environment["admin"], autocommit=True) as admin:
        owner = psycopg.conninfo.conninfo_to_dict(prepared_environment["owner"])["user"]
        admin.execute(sql.SQL("GRANT {} TO {}").format(sql.Identifier(owner), sql.Identifier(prepared_environment["role"])))
    with pytest.raises(deployment.MemoryDeploymentError, match="RUNTIME_ROLE_UNSAFE"):
        deployment.prepare_memory_store()


def test_cli_emits_safe_failure_for_secret_configuration(monkeypatch, capsys):
    monkeypatch.setenv("PROVISION_TIMEOUT_MS", "1000")
    monkeypatch.setenv("MEMORY_STORE_DATABASE_URL", "secret-marker-not-a-dsn")
    monkeypatch.setattr(deployment.sys, "argv", ["memory_deployment", "readiness"])
    assert deployment.main() == 1
    result = capsys.readouterr()
    assert not result.out
    assert "secret-marker" not in result.err
    assert '"reason": "memory_deployment_failed"' in result.err


def test_prepare_deadline_cancels_real_advisory_wait_without_later_ddl(prepared_environment):
    import subprocess
    import sys
    from psycopg.conninfo import make_conninfo
    name = "memory_prepare_deadline_" + uuid4().hex
    env = {**os.environ, "PROVISION_TIMEOUT_MS": "100", "PYTHONDONTWRITEBYTECODE": "1",
           "MEMORY_STORE_MIGRATION_DATABASE_URL": make_conninfo(prepared_environment["owner"], application_name=name)}
    with psycopg.connect(prepared_environment["owner"], autocommit=True) as blocker:
        blocker.execute("SELECT pg_advisory_lock(hashtextextended(%s,0))", ("workspacex-memory-prepare:workspacex_memory",))
        child = subprocess.run([sys.executable, "-m", "deep_agent_service.memory_deployment", "prepare"],
                               env=env, capture_output=True, text=True, timeout=10)
        assert child.returncode == 1
        assert "memory_deployment_failed" in child.stderr
        assert not child.stdout
        assert blocker.execute("SELECT count(*) FROM pg_stat_activity WHERE application_name=%s", (name,)).fetchone()[0] == 0
        blocker.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", ("workspacex-memory-prepare:workspacex_memory",))
        assert blocker.execute("SELECT count(*) FROM pg_namespace WHERE nspname='workspacex_memory'").fetchone()[0] == 0
