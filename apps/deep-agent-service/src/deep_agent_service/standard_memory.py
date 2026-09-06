"""Private user memory: official LangMem + PostgreSQL Store, with policy glue only.

No store is exposed on the graph: model code cannot choose namespaces. Each operation
owns one connection/outer transaction, including the advisory lock and LangMem calls.
"""
import asyncio
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from threading import BoundedSemaphore
from urllib.parse import quote, urlsplit

import httpx
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from jsonschema import Draft7Validator, FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool
from langgraph.store.postgres import PostgresStore
from langgraph.store.postgres.aio import AsyncPostgresStore
from langmem import create_manage_memory_tool, create_search_memory_tool

_SCHEMA=json.loads((Path(__file__).parent/'generated/standard_memory_schema.json').read_text())
_SLOTS=BoundedSemaphore(_SCHEMA['limits']['maxConcurrentOperations'])
_V={key:Draft7Validator(value,format_checker=FormatChecker()) for key,value in _SCHEMA.items() if isinstance(value,dict) and 'type' in value}

class StandardMemoryError(RuntimeError):
    """Do not automatically retry an uncertain mutation response."""

def _identity(runtime):
    config=runtime.config['configurable']; scope=config[_SCHEMA['scopeKey']]
    _V['scope'].validate(scope)
    callback=config['run_control_callback']
    if callback['org_id']!=scope['orgId'] or not runtime.tool_call_id: raise ValueError('scope')
    return scope,callback

async def _proof(runtime,name,args,sources):
    scope,callback=_identity(runtime)
    base=callback['base_url'].rstrip('/'); parsed=urlsplit(base)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not callback['key']: raise ValueError('callback')
    body={'orgId':scope['orgId'],'userId':scope['userId'],'attemptId':callback['attempt_id'],'leaseEpoch':callback['lease_epoch'],
          'toolName':name,'toolCallId':runtime.tool_call_id,'toolArgs':args,'sources':sources}
    if callback.get('permission_request_id'): body['permissionRequestId']=callback['permission_request_id']
    _V['proofInput'].validate(body)
    async with asyncio.timeout(5):
        async with httpx.AsyncClient(timeout=5,follow_redirects=False,trust_env=False) as client:
            async with client.stream('POST',f"{base}/internal/agent-runs/{quote(callback['run_id'],safe='')}/memory/source-proof",
                    headers={'x-deep-agent-internal-key':callback['key'],'accept-encoding':'identity'},json=body) as response:
                if response.status_code!=200 or response.headers.get('content-encoding','identity')!='identity': raise ValueError('proof')
                content=bytearray()
                async for chunk in response.aiter_raw():
                    if len(content)+len(chunk)>131072: raise ValueError('proof size')
                    content.extend(chunk)
                result=json.loads(content); _V['proofOutput'].validate(result)
                if result['scope']!=scope: raise ValueError('scope changed')
                return result

def _connection(dsn=None):
    dsn=dsn or os.environ.get('MEMORY_STORE_DATABASE_URL')
    schema=os.environ.get('MEMORY_STORE_SCHEMA','workspacex_memory')
    if not dsn or not re.fullmatch(r'[a-z][a-z0-9_]{0,62}',schema): raise ValueError('memory configuration')
    conn=psycopg.connect(dsn,autocommit=True,row_factory=dict_row,connect_timeout=5)
    try:
        conn.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
        conn.execute("SET statement_timeout TO '5s'")
        return conn
    except BaseException:
        conn.close(); raise

def setup_memory_store():
    """Explicit deployment bootstrap; never silently fall back or provision a server."""
    schema=os.environ.get('MEMORY_STORE_SCHEMA','workspacex_memory')
    dsn=os.environ.get('MEMORY_STORE_MIGRATION_DATABASE_URL')
    if not dsn: raise ValueError('explicit memory migration DSN required')
    with _connection(dsn) as conn:
        conn.execute(sql.SQL('CREATE SCHEMA IF NOT EXISTS {}').format(sql.Identifier(schema)))
        PostgresStore(conn).setup()

async def _async_connection():
    dsn=os.environ.get('MEMORY_STORE_DATABASE_URL')
    schema=os.environ.get('MEMORY_STORE_SCHEMA','workspacex_memory')
    if not dsn or not re.fullmatch(r'[a-z][a-z0-9_]{0,62}',schema): raise ValueError('memory configuration')
    conn=await psycopg.AsyncConnection.connect(dsn,autocommit=True,row_factory=dict_row,connect_timeout=5)
    try:
        await conn.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
        await conn.execute("SET statement_timeout TO '5s'")
        return conn
    except BaseException:
        await conn.close(); raise

async def _aoperate(scope,operation,args,proof):
    if not _SLOTS.acquire(blocking=False): raise ValueError('memory busy')
    try:
        return await _aoperate_bound(scope,operation,args,proof)
    finally:
        _SLOTS.release()

async def _aoperate_bound(scope,operation,args,proof):
    # Hash components are literal namespace segments, not LangMem template strings.
    ns=('workspacex-memory-v1',hashlib.sha256(scope['orgId'].encode()).hexdigest(),hashlib.sha256(scope['userId'].encode()).hexdigest())
    data_ns=ns+('items',); receipts=ns+('receipts',); tombstones=ns+('tombstones',)
    digest=hashlib.sha256(json.dumps(args,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    async with asyncio.timeout(_SCHEMA['limits']['databaseTimeoutMs']/1000),await _async_connection() as conn,conn.transaction():
        await conn.execute('SELECT pg_advisory_xact_lock(%s)',(int.from_bytes(hashlib.sha256('/'.join(ns).encode()).digest()[:8],signed=True),))
        store=AsyncPostgresStore(conn)
        manage=create_manage_memory_tool(data_ns,store=store,schema=dict)
        if operation=='search':
            # No embedding index: upstream query is empty and bounded literal matching
            # happens here. Never label the resulting list semantic retrieval.
            search=create_search_memory_tool(data_ns,store=store)
            raw=json.loads(await search.ainvoke({'query':'','limit':_SCHEMA['limits']['maxItems']+1}))
            if len(raw)>_SCHEMA['limits']['maxItems']: raise ValueError('memory limit')
            items=[entry['value']['content'] for entry in raw]
            return sorted(items,key=lambda item:item['memoryId'])
        memory_id=args.get('memoryId')
        current=await store.aget(data_ns,memory_id) if memory_id else None
        if operation=='delete':
            dead=await store.aget(tombstones,memory_id)
            if dead:
                if dead.value['revision']!=args['expectedRevision']: raise ValueError('revision conflict')
                return {'deleted':True}
            if not current or current.value['content']['revision']!=args['expectedRevision']: raise ValueError('revision conflict')
            await manage.ainvoke({'action':'delete','id':memory_id})
            await store.aput(tombstones,memory_id,{'revision':args['expectedRevision']})
            return {'deleted':True}
        receipt=await store.aget(receipts,args['idempotencyKey'])
        if receipt:
            if receipt.value['digest']!=digest: raise ValueError('idempotency conflict')
            return receipt.value['output']
        if (memory_id is None)!=(args.get('expectedRevision') is None): raise ValueError('revision required')
        if memory_id and (not current or current.value['content']['revision']!=args['expectedRevision']): raise ValueError('revision conflict')
        # Keep receipts/tombstones bounded, never discard an idempotency receipt to allow replay.
        if len(await store.asearch(receipts,limit=_SCHEMA['limits']['maxItems']))>=_SCHEMA['limits']['maxItems']: raise ValueError('memory limit')
        revision=1 if current is None else current.value['content']['revision']+1
        item={'memoryId':memory_id,'text':args['text'],'revision':revision,'sourceRef':proof['sourceRef'],'updatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z')}
        if memory_id is None:
            # Official create selects its UUID. Read its returned ID, then update the
            # same official record with the outward identity inside this transaction.
            reply=await manage.ainvoke({'action':'create','content':item})
            memory_id=reply.rsplit(' ',1)[-1]; item['memoryId']=memory_id
        await manage.ainvoke({'action':'update','id':memory_id,'content':item})
        output={'memoryId':memory_id,'revision':revision}
        await store.aput(receipts,args['idempotencyKey'],{'digest':digest,'output':output})
        return output

def _operate(scope,operation,args,proof):
    """Sync callers share the same cancellable async Store implementation."""
    return asyncio.run(_aoperate(scope,operation,args,proof))

async def _invoke(runtime,operation,args):
    try:
        _V[operation+'Input'].validate(args)
        scope,_=_identity(runtime); name='wx_memory_'+operation
        proof=await _proof(runtime,name,args,[])
        result=await _aoperate(scope,operation,args,proof)
        if operation=='search':
            proof=await _proof(runtime,name,args,[item['sourceRef'] for item in result])
            items=[item for item in result if item['sourceRef'] in proof['visible'] and args.get('query','').casefold() in item['text'].casefold()]
            offset=int(args.get('cursor','0')); limit=_SCHEMA['limits']['pageSize']
            result={'mode':'literal','items':items[offset:offset+limit],**({'cursor':str(offset+limit)} if len(items)>offset+limit else {})}
        _V[operation+'Output'].validate(result)
        return result
    except ValueError as error:
        code={'revision conflict':'memory_revision_conflict','idempotency conflict':'memory_idempotency_conflict','revision required':'memory_revision_required','memory limit':'memory_limit'}.get(str(error))
        if code in _SCHEMA['failureCodes']: raise StandardMemoryError(code) from None
        raise StandardMemoryError('Memory unavailable or refused; no successful mutation confirmed') from None
    except Exception:
        raise StandardMemoryError('Memory unavailable or refused; no successful mutation confirmed') from None

def standard_memory_tools():
    """Trusted factory registration; identity remains in ToolRuntime, never model args."""
    tools=[]
    for operation in ('search','write','delete'):
        def make(op):
            async def run(runtime:ToolRuntime,**kwargs): return await _invoke(runtime,op,kwargs)
            def sync(runtime:ToolRuntime,**kwargs): return asyncio.run(_invoke(runtime,op,kwargs))
            return StructuredTool.from_function(sync,coroutine=run,name='wx_memory_'+op,args_schema=_SCHEMA[op+'Input'],
                description={'search':'List private remembered notes; optional literal text filter.','write':'Remember an explicitly approved note from the current human message.','delete':'Delete an explicitly approved private remembered note by revision.'}[op])
        tools.append(make(operation))
    return tools
