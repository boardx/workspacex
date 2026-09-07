# W17: official SQL Toolkit behind a dedicated read-only data source

The four public tools retain the official SQLDatabaseToolkit names and argument schemas: `sql_db_list_tables`, `sql_db_schema`, `sql_db_query_checker`, and `sql_db_query`. The checker is model assistance, not a security decision. Query results use a bounded JSON envelope (`rows`, `rowCount`, `truncated`) instead of upstream's unbounded display string.

## Dependency provenance

Pinned `langchain-community==0.4.2` is archived. The official sunset notice is https://github.com/langchain-ai/langchain-community/issues/674; no maintained official replacement for this toolkit was identified. This is a deliberate narrow reuse approved for W17, not a claim that the package remains maintained. `uv.lock` pins the wheel and transitive dependencies. The generated native manifest records the exact SQLDatabase source SHA256 and runtime refuses a different source/version until reviewed. No global monkeypatch is installed.

SQLAlchemy 2.0.52 with its asyncio extra bridges official synchronous `_run` through `AsyncConnection.run_sync`. The driver is psycopg's actual async connection. There is no default tool executor thread that can continue submitting queries after cancellation. The per-instance `_engine` shares the outer read-only transaction; `_schema` is unset only after setting the trusted transaction-local search path, avoiding upstream's invalid streamed SET statement.

## Deployment contract

`STANDARD_SQL_BINDINGS` is private API deployment configuration mapping current org/requester user to exactly one dataSourceId. `STANDARD_SQL_SOURCES` is private Python deployment configuration mapping that opaque ID to a DSN, TLS mode, schema, allowed views and application database names. Neither configuration is accepted from model arguments. Every invocation rechecks the real ToolCall ID and arguments through the existing run authority and current requester visibility before resolving a source. All four tools retain explicit L2 approval.

Provision a separate PostgreSQL database and a login role named `wsx_sql_ro_*`, without superuser, create database, create role, replication, bypass RLS, or role memberships. Grant schema USAGE and SELECT only on deliberately published views. Remove PUBLIC execution privileges from `pg_notify(text,text)` in that dedicated database; do not grant execution on custom functions. Runtime checks these conditions and rejects application database names. Do not use the application's `app_rw` role or application database. TLS is mandatory: supported modes are require, verify-ca, and verify-full; verify-full is recommended with deployment CA configuration. No unencrypted runtime mode is provided.

The approved view list controls toolkit discovery and schema reflection. PostgreSQL grants and read-only transactions are the actual data/write boundary. The SELECT/WITH and single-statement check is supplemental transport grammar; it is not a SQL authorization parser. A dedicated database should also apply normal CPU/memory workload limits: output bounds do not prevent the database from evaluating an expensive expression before returning it.

## Limits and outcomes

Shared contracts generate argument/response/config schemas and limits. Each SQL statement has a 2 second timeout; the database operation has an 8 second wall-clock budget and at most eight concurrent operations. The response has at most 100 rows, 4096 characters per row and 65536 payload bytes. Oversized rows/results fail explicitly; row-count truncation is reported. Errors omit driver messages and credentials and are excluded from automatic tool retries. The query checker does not open a database connection.

Cancellation reaches the async driver and awaits transaction/connection cleanup. This is cancellation of the current tool invocation, not a new parent-run cancellation engine. Actual test outcomes and remaining gaps must be read from the accompanying execution evidence; this design note is not itself proof of execution.
