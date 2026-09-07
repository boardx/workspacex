import asyncio
import os
from uuid import uuid4
from urllib.parse import urlsplit,urlunsplit,quote

import psycopg
from psycopg import sql
import pytest
from langchain_core.language_models.fake import FakeListLLM
from deep_agent_service.standard_sql_database import call_sql_database,StandardSqlError,_SLOTS

@pytest.fixture
def source():
    dsn=os.environ.get('WX_SQL_TEST_DSN')
    if not dsn:pytest.skip('isolated PostgreSQL required')
    application_dsn=dsn;application=urlsplit(dsn);database='sql_source_'+uuid4().hex
    with psycopg.connect(dsn,autocommit=True) as conn:conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(database)))
    dsn=urlunsplit((application.scheme,application.netloc,'/'+database,'',''))
    name='sql_test_'+uuid4().hex;role='wsx_sql_ro_'+uuid4().hex
    with psycopg.connect(dsn,autocommit=True) as conn:
        conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(name)))
        conn.execute(sql.SQL('CREATE TABLE {}.private_data(id int, label text)').format(sql.Identifier(name)))
        conn.execute(sql.SQL("INSERT INTO {}.private_data VALUES(1,'中文'),(2,'second')").format(sql.Identifier(name)))
        conn.execute(sql.SQL('CREATE VIEW {}.allowed AS SELECT id,label FROM {}.private_data').format(sql.Identifier(name),sql.Identifier(name)))
        conn.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal('sql-test')))
        conn.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(name),sql.Identifier(role)))
        conn.execute(sql.SQL('GRANT SELECT ON {}.allowed TO {}').format(sql.Identifier(name),sql.Identifier(role)))
        conn.execute('REVOKE EXECUTE ON FUNCTION pg_catalog.pg_notify(text,text) FROM PUBLIC')
    parsed=urlsplit(dsn)
    uri=urlunsplit(('postgresql+psycopg',f'{quote(role)}:sql-test@{parsed.hostname}:{parsed.port}',parsed.path,'',''))
    yield {'dsn':uri,'sslMode':'require','schema':name,'views':['allowed'],'applicationDatabases':[application.path.lstrip('/')]}
    with psycopg.connect(dsn,autocommit=True) as conn:
        conn.execute('GRANT EXECUTE ON FUNCTION pg_catalog.pg_notify(text,text) TO PUBLIC')
        conn.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(name)))
        conn.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
    with psycopg.connect(application_dsn,autocommit=True) as conn:conn.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(database)))

def call(source,name,args):return asyncio.run(call_sql_database(source,name,args,FakeListLLM(responses=['SELECT 1'])))

def test_real_official_tools_with_readonly_view_and_bounded_rows(source):
    listed=call(source,'sql_db_list_tables',{})
    assert listed=='allowed'
    assert 'label' in call(source,'sql_db_schema',{'table_names':'allowed'})
    assert call(source,'sql_db_query',{'query':'SELECT * FROM allowed ORDER BY id'})=={'rows':[{'id':1,'label':'中文'},{'id':2,'label':'second'}],'truncated':False,'rowCount':2}
    assert call(source,'sql_db_query',{'query':'SELECT n FROM generate_series(1,200) n'})['truncated'] is True
    for query in ['UPDATE allowed SET id=4','SELECT 1; SELECT 2','SELECT * FROM private_data',"SELECT pg_notify('other','secret')","WITH changed AS (DELETE FROM private_data RETURNING *) SELECT * FROM changed"]:
        with pytest.raises(StandardSqlError):call(source,'sql_db_query',{'query':query})
    with pytest.raises(StandardSqlError):call(source,'sql_db_schema',{'table_names':'private_data'})
    # Bypass supplemental application grammar: the dedicated role itself cannot
    # modify either the view, base table, or schema even without read-only mode.
    with psycopg.connect(source['dsn'].replace('postgresql+psycopg:','postgresql:'),sslmode='require',autocommit=True) as raw:
        for statement in [f'UPDATE {source["schema"]}.allowed SET id=4',f'DELETE FROM {source["schema"]}.private_data',f'CREATE TABLE {source["schema"]}.forbidden(id int)']:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):raw.execute(statement)
    with pytest.raises(StandardSqlError,match='too_large'):call(source,'sql_db_query',{'query':"SELECT repeat('a',5000)"})
    with pytest.raises(StandardSqlError,match='too_large'):call(source,'sql_db_query',{'query':"SELECT repeat('中',120) FROM generate_series(1,100)"})

def test_real_async_driver_cancel_settles_without_executor_worker(source):
    async def scenario():
        task=asyncio.create_task(call_sql_database(source,'sql_db_query',{'query':'SELECT pg_sleep(20)'},FakeListLLM(responses=['SELECT 1'])))
        admin=await psycopg.AsyncConnection.connect(os.environ['WX_SQL_TEST_DSN'],autocommit=True)
        try:
            async with asyncio.timeout(5):
                while True:
                    cursor=await admin.execute("SELECT count(*) FROM pg_stat_activity WHERE usename=%s AND wait_event='PgSleep'",(urlsplit(source['dsn']).username,))
                    if (await cursor.fetchone())[0]:break
                    if task.done():await task
                    await asyncio.sleep(.02)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):await asyncio.wait_for(task,3)
            cursor=await admin.execute('SELECT count(*) FROM pg_stat_activity WHERE usename=%s',(urlsplit(source['dsn']).username,))
            assert (await cursor.fetchone())[0]==0
        finally:await admin.close()
        assert _SLOTS._value==8
        assert (await call_sql_database(source,'sql_db_query',{'query':'SELECT count(*) FROM allowed'},FakeListLLM(responses=['SELECT 1'])))['rows']==[{'count':2}]
    asyncio.run(scenario())


def test_real_statement_timeout_closes_connection(source):
    import time
    started=time.monotonic()
    with pytest.raises(StandardSqlError):call(source,'sql_db_query',{'query':'SELECT pg_sleep(20)'})
    assert time.monotonic()-started<7
    with psycopg.connect(os.environ['WX_SQL_TEST_DSN'],autocommit=True) as admin:
        assert admin.execute('SELECT count(*) FROM pg_stat_activity WHERE usename=%s',(urlsplit(source['dsn']).username,)).fetchone()[0]==0
    assert _SLOTS._value==8
