"""Explicit Native memory preparation and least-privilege readiness.

Run in the release Agent image. Runtime receives only MEMORY_STORE_DATABASE_URL;
prepare additionally receives MEMORY_STORE_MIGRATION_DATABASE_URL. Schema migrations
are owned by the separate migration role. No model/user data is used by readiness.
"""
import json
import os
import re
import signal
import sys
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row
from langgraph.store.postgres import PostgresStore


class MemoryDeploymentError(RuntimeError):
    pass


def _config():
    dsn = os.environ.get("MEMORY_STORE_DATABASE_URL", "")
    schema = os.environ.get("MEMORY_STORE_SCHEMA", "workspacex_memory")
    if not dsn or not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema) or schema == "public" or schema.startswith("pg_"):
        raise MemoryDeploymentError("MEMORY_CONFIGURATION_INVALID")
    return dsn, schema


def _connect(dsn):
    conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row, connect_timeout=5)
    try:
        conn.execute("SET statement_timeout TO '5s'")
        conn.execute("SET lock_timeout TO '5s'")
        return conn
    except BaseException:
        conn.close()
        raise


def _identity(conn):
    return conn.execute("""SELECT current_database() AS database, current_user AS username,
        inet_server_addr()::text AS address, inet_server_port() AS port,
        r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolcanlogin,
        EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS membership,
        EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid) AS owns_database,
        EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid) AS owns_relation,
        EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid) AS owns_schema
        FROM pg_roles r WHERE rolname=current_user""").fetchone()


def _runtime_role(conn):
    identity = _identity(conn)
    if (not identity or identity["username"] in {"postgres", "app_rw", "app_diag_ro", "agent_server"}
            or not identity["rolcanlogin"] or any(identity[key] for key in
                ("rolsuper", "rolbypassrls", "rolcreatedb", "rolcreaterole", "rolreplication", "membership", "owns_database", "owns_relation", "owns_schema"))):
        raise MemoryDeploymentError("MEMORY_RUNTIME_ROLE_UNSAFE")
    if identity["database"] in {"postgres", "workspacex", "workspacex_agent"}:
        raise MemoryDeploymentError("MEMORY_DATABASE_NOT_SEPARATE")
    # The running Agent's own persistence URI, when present, is another explicit boundary.
    agent_dsn = os.environ.get("DATABASE_URI")
    if agent_dsn:
        agent = conninfo_to_dict(agent_dsn)
        if identity["username"] == agent.get("user") or identity["database"] == agent.get("dbname"):
            raise MemoryDeploymentError("MEMORY_DATABASE_NOT_SEPARATE")
    return identity


def prepare_memory_store():
    runtime_dsn, schema = _config()
    migration_dsn = os.environ.get("MEMORY_STORE_MIGRATION_DATABASE_URL", "")
    if not migration_dsn:
        raise MemoryDeploymentError("MEMORY_MIGRATION_IDENTITY_REQUIRED")
    with _connect(runtime_dsn) as runtime, _connect(migration_dsn) as owner:
        running, migrating = _runtime_role(runtime), _identity(owner)
        if (not migrating or running["username"] == migrating["username"] or
                any(running[key] != migrating[key] for key in ("database", "address", "port"))):
            raise MemoryDeploymentError("MEMORY_MIGRATION_IDENTITY_MISMATCH")
        # PostgresStore.setup includes CREATE INDEX CONCURRENTLY, so hold a session lock
        # around its own autocommit migrations rather than wrapping DDL in a transaction.
        key = "workspacex-memory-prepare:" + schema
        owner.execute("SELECT pg_advisory_lock(hashtextextended(%s,0))", (key,))
        try:
            owner.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {} AUTHORIZATION CURRENT_USER").format(sql.Identifier(schema)))
            owned = owner.execute("SELECT pg_get_userbyid(nspowner)=current_user AS owned FROM pg_namespace WHERE nspname=%s", (schema,)).fetchone()
            if not owned or not owned["owned"]:
                raise MemoryDeploymentError("MEMORY_SCHEMA_OWNER_MISMATCH")
            owner.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
            PostgresStore(owner).setup()
            role = sql.Identifier(running["username"])
            owner.execute(sql.SQL("REVOKE ALL ON SCHEMA {} FROM PUBLIC").format(sql.Identifier(schema)))
            owner.execute(sql.SQL("REVOKE ALL ON SCHEMA {} FROM {}").format(sql.Identifier(schema), role))
            owner.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), role))
            # Literal (non-vector) memory uses only store. Migration history remains owner-only.
            for table in ("store", "store_migrations"):
                target = sql.Identifier(schema, table)
                owner.execute(sql.SQL("REVOKE ALL ON TABLE {} FROM PUBLIC").format(target))
                owner.execute(sql.SQL("REVOKE ALL ON TABLE {} FROM {}").format(target, role))
            owner.execute(sql.SQL("GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE {} TO {}").format(sql.Identifier(schema, "store"), role))
        finally:
            owner.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))", (key,))
    verify_memory_store()
    return {"memoryPrepared": True, "runtimeOwnerSeparated": True}


def verify_memory_store():
    dsn, schema = _config()
    with _connect(dsn) as conn:
        _runtime_role(conn)
        table = sql.Identifier(schema, "store").as_string(conn)
        history = sql.Identifier(schema, "store_migrations").as_string(conn)
        rights = conn.execute("""SELECT has_database_privilege(current_database(),'CREATE') AS creates_database_schema,
            has_schema_privilege(%s,'CREATE') AS creates_schema_objects,
            has_table_privilege(%s,'SELECT,INSERT,UPDATE,DELETE') AS dml,
            has_table_privilege(%s,'SELECT,INSERT,UPDATE,DELETE') AS migration_access,
            has_table_privilege(%s,'TRUNCATE,REFERENCES,TRIGGER') AS elevated_table_rights""", (schema, table, history, table)).fetchone()
        # has_table_privilege's comma list means ANY privilege; prove each DML right below.
        if (not rights or rights["creates_database_schema"] or rights["creates_schema_objects"] or
                rights["migration_access"] or rights["elevated_table_rights"] or not rights["dml"]):
            raise MemoryDeploymentError("MEMORY_RUNTIME_PRIVILEGES_INVALID")
        conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        with conn.transaction():
            store = PostgresStore(conn)
            namespace = ("workspacex-deployment-readiness", uuid4().hex)
            store.put(namespace, "probe", {"value": "created"})
            store.put(namespace, "probe", {"value": "updated"})
            found = store.get(namespace, "probe")
            if found is None or found.value != {"value": "updated"} or len(store.search(namespace)) != 1:
                raise MemoryDeploymentError("MEMORY_READBACK_FAILED")
            store.delete(namespace, "probe")
            if store.get(namespace, "probe") is not None:
                raise MemoryDeploymentError("MEMORY_DELETE_FAILED")
    return {"memoryStoreVerified": True, "runtimeOwnerSeparated": True, "cloudVerified": False}


class MemoryDeploymentCancelled(KeyboardInterrupt):
    """Use psycopg's interrupt path to cancel and settle the active server query."""


def main():
    def expired(_signal, _frame):
        raise MemoryDeploymentCancelled("MEMORY_DEPLOYMENT_CANCELLED")
    try:
        budget = int(os.environ.get("PROVISION_TIMEOUT_MS", "0"))
        if not 0 < budget <= 300000 or len(sys.argv) != 2 or sys.argv[1] not in ("prepare", "readiness"):
            raise MemoryDeploymentError("MEMORY_DEPLOYMENT_CONFIGURATION_INVALID")
        signal.signal(signal.SIGTERM, expired)
        signal.signal(signal.SIGINT, expired)
        signal.signal(signal.SIGALRM, expired)
        signal.setitimer(signal.ITIMER_REAL, budget / 1000)
        result = prepare_memory_store() if sys.argv[1] == "prepare" else verify_memory_store()
        print(json.dumps(result))
    except (Exception, MemoryDeploymentCancelled):
        # libpq errors can contain passwords/DSNs. Emit no underlying exception or cause.
        print(json.dumps({"ok": False, "reason": "memory_deployment_failed"}), file=sys.stderr)
        return 1
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
