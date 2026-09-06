import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4

import pytest
from deep_agent_service import standard_memory as memory

SCOPE={'orgId':'org','userId':'user'}
PROOF={'sourceRef':{'threadId':'thread','messageId':'message'}}

def test_tools_hide_namespace_and_fail_without_trusted_scope():
    for tool in memory.standard_memory_tools():
        assert not {'namespace','userId','orgId','runtime'} & set(tool.args_schema['properties'])
        assert tool.args_schema['additionalProperties'] is False
    with pytest.raises(memory.StandardMemoryError):
        asyncio.run(memory._invoke(SimpleNamespace(config={},tool_call_id='actual'),'search',{}))

@pytest.fixture
def database(monkeypatch):
    dsn=os.environ.get('WX_MEMORY_TEST_DSN')
    if not dsn:pytest.skip('real PostgreSQL wrapper DSN required')
    monkeypatch.setenv('MEMORY_STORE_DATABASE_URL',dsn)
    monkeypatch.setenv('MEMORY_STORE_MIGRATION_DATABASE_URL',dsn)
    monkeypatch.setenv('MEMORY_STORE_SCHEMA','memory_test_'+uuid4().hex)
    memory.setup_memory_store()
    role='memory_role_'+uuid4().hex
    with memory._connection(dsn) as conn:
        conn.execute(memory.sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(memory.sql.Identifier(role),memory.sql.Literal('memory-test')))
        conn.execute(memory.sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(memory.sql.Identifier(os.environ['MEMORY_STORE_SCHEMA']),memory.sql.Identifier(role)))
        conn.execute(memory.sql.SQL('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA {} TO {}').format(memory.sql.Identifier(os.environ['MEMORY_STORE_SCHEMA']),memory.sql.Identifier(role)))
    from psycopg.conninfo import make_conninfo
    monkeypatch.setenv('MEMORY_STORE_DATABASE_URL',make_conninfo(dsn,user=role,password='memory-test'))
    yield
    with memory._connection(dsn) as conn:
        conn.execute(memory.sql.SQL('DROP SCHEMA {} CASCADE').format(memory.sql.Identifier(os.environ['MEMORY_STORE_SCHEMA'])))
        conn.execute(memory.sql.SQL('DROP ROLE {}').format(memory.sql.Identifier(role)))

def test_real_store_cas_receipts_tombstones_restart_and_tenant_separation(database):
    args={'text':'remember 中文','sourceMessageId':'message','idempotencyKey':'first'}
    first=memory._operate(SCOPE,'write',args,PROOF)
    assert memory._operate(SCOPE,'write',args,PROOF)==first  # lost response replay
    with pytest.raises(ValueError,match='conflict'):memory._operate(SCOPE,'write',{**args,'text':'changed'},PROOF)
    assert memory._operate({'orgId':'other','userId':'user'},'search',{},PROOF)==[]
    assert memory._operate({'orgId':'org','userId':'other'},'search',{},PROOF)==[]
    assert memory._operate(SCOPE,'search',{},PROOF)[0]['text']==args['text']  # new connection
    def update(key):
        try:return memory._operate(SCOPE,'write',{**args,'memoryId':first['memoryId'],'expectedRevision':1,'idempotencyKey':key},PROOF)
        except ValueError:return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(update,['second','third']))
    assert sum(result=='conflict' for result in results)==1
    delete={'memoryId':first['memoryId'],'expectedRevision':2}
    with ThreadPoolExecutor(max_workers=2) as pool: assert list(pool.map(lambda _:memory._operate(SCOPE,'delete',delete,PROOF),range(2)))==[{'deleted':True}]*2
    assert memory._operate(SCOPE,'search',{},PROOF)==[]
    with pytest.raises(ValueError,match='conflict'):memory._operate(SCOPE,'delete',{**delete,'expectedRevision':1},PROOF)

def test_official_store_does_not_commit_outer_transaction(database,monkeypatch):
    original=memory.AsyncPostgresStore.aput
    async def fail_receipt(self,namespace,key,value,**kwargs):
        if namespace[-1]=='receipts':raise RuntimeError('crash before commit')
        return await original(self,namespace,key,value,**kwargs)
    monkeypatch.setattr(memory.AsyncPostgresStore,'aput',fail_receipt)
    with pytest.raises(RuntimeError):memory._operate(SCOPE,'write',{'text':'must rollback','sourceMessageId':'message','idempotencyKey':'rollback'},PROOF)
    assert memory._operate(SCOPE,'search',{},PROOF)==[]

def test_revoke_filter_happens_before_tool_result(database,monkeypatch):
    memory._operate(SCOPE,'write',{'text':'secret','sourceMessageId':'message','idempotencyKey':'first'},PROOF)
    visible=True
    async def proof(*_):return {'scope':SCOPE,'visible':[PROOF['sourceRef']] if visible else []}
    monkeypatch.setattr(memory,'_proof',proof)
    runtime=SimpleNamespace(config={'configurable':{'wsx_memory_scope':SCOPE,'run_control_callback':{'org_id':'org'}}},tool_call_id='actual')
    assert len(asyncio.run(memory._invoke(runtime,'search',{}))['items'])==1
    visible=False
    assert asyncio.run(memory._invoke(runtime,'search',{}))=={'mode':'literal','items':[]}

@pytest.mark.parametrize('mode',['cancel','deadline'])
def test_actual_query_cancel_rolls_back_before_completion(database,monkeypatch,mode):
    original=memory.AsyncPostgresStore.aput
    async def scenario():
        entered=asyncio.Event()
        async def slow_receipt(self,namespace,key,value,**kwargs):
            if namespace[-1]=='receipts':
                entered.set()
                await self.conn.execute('SELECT pg_sleep(30)')
            return await original(self,namespace,key,value,**kwargs)
        monkeypatch.setattr(memory.AsyncPostgresStore,'aput',slow_receipt)
        if mode=='deadline':monkeypatch.setitem(memory._SCHEMA['limits'],'databaseTimeoutMs',250)
        task=asyncio.create_task(memory._aoperate(SCOPE,'write',{'text':'must not commit','sourceMessageId':'message','idempotencyKey':'slow'},PROOF))
        await asyncio.wait_for(entered.wait(),2)
        if mode=='cancel':task.cancel()
        with pytest.raises(asyncio.CancelledError if mode=='cancel' else TimeoutError):await asyncio.wait_for(task,3)
        assert task.done()
        # The real SQL was cancelled and outer transaction settled before the caller
        # can observe cancellation; no orphan to_thread worker can later commit.
        assert await memory._aoperate(SCOPE,'search',{},PROOF)==[]
        assert memory._SLOTS._value==memory._SCHEMA['limits']['maxConcurrentOperations']
    asyncio.run(scenario())

def test_actual_advisory_lock_wait_cancel_never_later_writes(database,monkeypatch):
    async def scenario():
        ns=('workspacex-memory-v1',memory.hashlib.sha256(SCOPE['orgId'].encode()).hexdigest(),memory.hashlib.sha256(SCOPE['userId'].encode()).hexdigest())
        key=int.from_bytes(memory.hashlib.sha256('/'.join(ns).encode()).digest()[:8],signed=True)
        original=memory._async_connection;connections=[]
        async def tracked():
            conn=await original();connections.append(conn);return conn
        async with await original() as blocker,blocker.transaction():
            await blocker.execute('SELECT pg_advisory_xact_lock(%s)',(key,))
            monkeypatch.setattr(memory,'_async_connection',tracked)
            task=asyncio.create_task(memory._aoperate(SCOPE,'write',{'text':'locked','sourceMessageId':'message','idempotencyKey':'locked'},PROOF))
            async with asyncio.timeout(2):
                while True:
                    if connections:
                        cursor=await blocker.execute('SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s',(connections[0].info.backend_pid,))
                        row=await cursor.fetchone()
                        if row and row['wait_event_type']=='Lock':break
                    await asyncio.sleep(.01)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):await asyncio.wait_for(task,2)
            assert connections[0].closed
        assert await memory._aoperate(SCOPE,'search',{},PROOF)==[]
    asyncio.run(scenario())
