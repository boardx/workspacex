"""Authorized SQL Toolkit composition. No model input can choose a database."""
import asyncio
import copy
import json
import os
from pathlib import Path
from urllib.parse import quote,urlsplit
import httpx
from jsonschema import Draft7Validator,FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool
from langchain_community.agent_toolkits.sql.toolkit import SQLDatabaseToolkit
from .standard_memory import _identity
from .standard_sql_database import DialectOnlyDatabase,StandardSqlError,call_sql_database

_DIR=Path(__file__).parent/'generated'
_SCHEMA=json.loads((_DIR/'standard_sql_schema.json').read_text())
_NATIVE=json.loads((_DIR/'standard_sql_tools.json').read_text())
_V={key:Draft7Validator(_SCHEMA[key],format_checker=FormatChecker()) for key in ('input','output','sources')}

async def _source(name,args,runtime):
    scope,callback=_identity(runtime)
    base=callback['base_url'].rstrip('/');url=urlsplit(base)
    if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment or not callback['key']:raise ValueError()
    body={'orgId':scope['orgId'],'userId':scope['userId'],'attemptId':callback['attempt_id'],'leaseEpoch':callback['lease_epoch'],
          'toolCallId':runtime.tool_call_id,'toolName':name,'toolArgs':args}
    if callback.get('permission_request_id'):body['permissionRequestId']=callback['permission_request_id']
    _V['input'].validate(body)
    async with asyncio.timeout(5),httpx.AsyncClient(timeout=5,follow_redirects=False,trust_env=False) as client:
        async with client.stream('POST',f"{base}/internal/agent-runs/{quote(callback['run_id'],safe='')}/sql/source/check",json=body,
                headers={'x-deep-agent-internal-key':callback['key'],'accept-encoding':'identity'}) as response:
            if response.status_code!=200 or response.headers.get('content-encoding','identity')!='identity':raise ValueError()
            content=bytearray()
            async for chunk in response.aiter_raw():
                if len(content)+len(chunk)>4096:raise ValueError()
                content.extend(chunk)
            result=json.loads(content);_V['output'].validate(result)
    sources=json.loads(os.environ.get('STANDARD_SQL_SOURCES','{}'));_V['sources'].validate(sources)
    source=sources[result['dataSourceId']]
    dsn=urlsplit(source['dsn'])
    if dsn.scheme!='postgresql+psycopg' or not dsn.hostname or not dsn.username or not dsn.username.startswith('wsx_sql_ro_') or dsn.query or dsn.fragment:
        raise ValueError()
    if dsn.path.lstrip('/') in source['applicationDatabases']:raise ValueError()
    return source

def standard_sql_tools(model):
    native={tool.name:tool for tool in SQLDatabaseToolkit(db=DialectOnlyDatabase(),llm=model).get_tools()}
    def build(name):
        schema=copy.deepcopy(_NATIVE['tools'][name]);schema['additionalProperties']=False
        for field in schema['properties'].values():field['maxLength']=_SCHEMA['limits']['maxArgumentChars']
        async def invoke(runtime:ToolRuntime,**kwargs):
            try:
                Draft7Validator(schema).validate(kwargs)
                source=await _source(name,kwargs,runtime)
                if name=='sql_db_query_checker':
                    # Real upstream async model checker. No engine/reflection/query.
                    async with asyncio.timeout(_SCHEMA['limits']['databaseTimeoutMs']/1000):output=await native[name]._arun(**kwargs)
                    if len(output.encode())>_SCHEMA['limits']['maxOutputBytes']:raise ValueError()
                    return output
                return await call_sql_database(source,name,kwargs,model)
            except StandardSqlError:raise
            except Exception:raise StandardSqlError('sql_unavailable_or_refused') from None
        def sync(runtime:ToolRuntime,**kwargs):return asyncio.run(invoke(runtime,**kwargs))
        return StructuredTool(name=name,description=native[name].description,args_schema=schema,func=sync,coroutine=invoke)
    return [build(name) for name in native]
