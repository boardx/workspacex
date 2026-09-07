"""SQL Toolkit transport glue. Database grants, not a model checker, grant access."""
import asyncio
import json
import hashlib
from importlib.metadata import version
from contextlib import nullcontext
from threading import BoundedSemaphore

from langchain_community.agent_toolkits.sql.toolkit import SQLDatabaseToolkit
from langchain_community.utilities.sql_database import SQLDatabase
import langchain_community.utilities.sql_database as database_module
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from pathlib import Path
_LIMITS=json.loads((Path(__file__).parent/'generated/standard_sql_schema.json').read_text())['limits']
_UPSTREAM=json.loads((Path(__file__).parent/'generated/standard_sql_tools.json').read_text())

class StandardSqlError(RuntimeError):
    """No retry of an unknown query outcome; driver text is never returned."""

class DialectOnlyDatabase(SQLDatabase):
    """No connection or reflection when the official checker only needs dialect."""
    def __init__(self): pass
    @property
    def dialect(self): return 'postgresql'

class _BoundEngine:
    def __init__(self,connection):self.connection=connection;self.dialect=connection.dialect
    def begin(self):return nullcontext(self.connection)

class _BoundedDatabase(SQLDatabase):
    def run_no_throw(self,command,**_):
        # A server-side row envelope bounds bytes as well as row count. This is
        # transport shaping, not an authorization parser. All writes still meet
        # the database's read-only transaction and dedicated role grants.
        if ';' in command or not command.lstrip().upper().startswith(('SELECT ','WITH ')):
            raise StandardSqlError('sql_statement_not_supported')
        rows_limit=_LIMITS['maxRows'];chars_limit=_LIMITS['maxRowChars']
        wrapped=f'SELECT left(row_to_json(wx_row)::text, {chars_limit+1}) AS wx_json FROM ({command}) AS wx_row LIMIT {rows_limit+1}'
        result=super().run(wrapped,fetch='cursor',execution_options={'stream_results':True,'max_row_buffer':rows_limit+1})
        try:
            values=result.fetchmany(rows_limit+1)
            rows=[];total=0
            for value in values[:rows_limit]:
                encoded=value[0].encode('utf-8')
                if len(value[0])>chars_limit:raise StandardSqlError('sql_row_too_large')
                total+=len(encoded)
                if total>_LIMITS['maxOutputBytes']:raise StandardSqlError('sql_result_too_large')
                rows.append(json.loads(value[0]))
            output={'rows':rows,'truncated':len(values)>rows_limit,'rowCount':len(rows)}
            if len(json.dumps(output).encode())>_LIMITS['maxOutputBytes']:raise StandardSqlError('sql_result_too_large')
            return output
        finally:result.close()

_SLOTS=BoundedSemaphore(_LIMITS['maxConcurrentOperations'])

async def call_sql_database(source,name,args,model):
    """Call official synchronous tools only inside SQLAlchemy's async greenlet.

    Never use their default async executor: psycopg cancellation must reach the
    real connection, and settlement precedes leaving the outer transaction.
    """
    if not _SLOTS.acquire(blocking=False):raise StandardSqlError('sql_busy')
    engine=None
    try:
        if version('langchain-community')!=_UPSTREAM['version'] or hashlib.sha256(Path(database_module.__file__).read_bytes()).hexdigest()!=_UPSTREAM['databaseSourceSha256']:
            raise StandardSqlError('sql_upstream_requires_review')
        engine=create_async_engine(source['dsn'],poolclass=NullPool,connect_args={'connect_timeout':5,'sslmode':source['sslMode']})
        async with asyncio.timeout(_LIMITS['databaseTimeoutMs']/1000),engine.connect() as connection:
            connection=await connection.execution_options(isolation_level='READ COMMITTED',postgresql_readonly=True)
            async with connection.begin():
                await connection.execute(text("SELECT set_config('statement_timeout', :timeout, true)"),{'timeout':str(_LIMITS['statementTimeoutMs'])})
                await connection.execute(text("SELECT set_config('search_path', :schema, true)"),{'schema':source['schema']})
                if not (await connection.execute(text('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()'))).scalar_one():raise StandardSqlError('sql_tls_required')
                role=(await connection.execute(text('SELECT current_user AS name,current_database() AS database,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user'))).mappings().one()
                if role['database'] in source['applicationDatabases']:raise StandardSqlError('application_database_forbidden')
                if not role['name'].startswith('wsx_sql_ro_') or any(role[key] for key in ('rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls')):
                    raise StandardSqlError('sql_role_not_readonly')
                policy=(await connection.execute(text("""SELECT
                  EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS memberships,
                  has_function_privilege(current_user,'pg_catalog.pg_notify(text,text)','EXECUTE') AS notify,
                  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS custom_functions"""))).mappings().one()
                if any(policy.values()):raise StandardSqlError('sql_role_function_policy_unsafe')
                def run(sync_connection):
                    database=_BoundedDatabase(sync_connection,schema=source['schema'],include_tables=source['views'],view_support=True,sample_rows_in_table_info=0)
                    database._engine=_BoundEngine(sync_connection)
                    # Already transaction-local above. Upstream otherwise applies
                    # stream_results to SET search_path, which cannot use a cursor.
                    database._schema=None
                    tool=next(tool for tool in SQLDatabaseToolkit(db=database,llm=model).get_tools() if tool.name==name)
                    output=tool._run(**args)
                    if isinstance(output,str) and (output.startswith('Error:') or len(output.encode())>_LIMITS['maxOutputBytes']):
                        raise StandardSqlError('sql_schema_unavailable')
                    return output
                return await connection.run_sync(run)
    except StandardSqlError:raise
    except Exception:raise StandardSqlError('sql_unavailable_or_refused') from None
    finally:
        try:
            if engine is not None:await engine.dispose()
        finally:_SLOTS.release()
