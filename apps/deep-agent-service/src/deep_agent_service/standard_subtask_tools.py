"""Dispatch a durable child task using current source authorization."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit
import httpx
from jsonschema import Draft7Validator, FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool

_SCHEMA=json.loads((Path(__file__).parent/'generated/standard_subtask_schema.json').read_text())
_BINDING=json.loads((Path(__file__).parent/'generated/native_session_binding_schema.json').read_text())['configurableKey']
_V={name:Draft7Validator(_SCHEMA[name],format_checker=FormatChecker()) for name in ('toolInput','input','output')}
class StandardSubtaskError(RuntimeError):
    """Unknown execution result must not be retried automatically."""

async def _parse(runtime,args):
    try:
        _V['toolInput'].validate(args)
        config=runtime.config['configurable'];callback=config['run_control_callback']
        base=callback['base_url'].rstrip('/');parsed=urlsplit(base)
        if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not callback['key']:raise ValueError()
        body={'orgId':callback['org_id'],'attemptId':callback['attempt_id'],'leaseEpoch':callback['lease_epoch'],'bindingId':config[_BINDING]['bindingId'],'toolCallId':runtime.tool_call_id,'toolName':_SCHEMA['toolName'],'toolArgs':args}
        if callback.get('permission_request_id') is not None:body['permissionRequestId']=callback['permission_request_id']
        _V['input'].validate(body)
        url=f"{base}/internal/agent-runs/{quote(callback['run_id'],safe='')}/subtasks/spawn"
        # Bounds transport; an unknown result must not be replayed automatically.
        deadline=_SCHEMA['limits']['deadlineMs']/1000
        async with asyncio.timeout(deadline):
            async with httpx.AsyncClient(timeout=deadline,follow_redirects=False,trust_env=False) as client:
                async with client.stream('POST',url,headers={'x-deep-agent-internal-key':callback['key'],'accept-encoding':'identity'},json=body) as response:
                    if response.status_code!=200 or response.headers.get('content-encoding','identity')!='identity':raise ValueError()
                    data=bytearray()
                    async for chunk in response.aiter_raw():
                        if len(data)+len(chunk)>_SCHEMA['limits']['maxResponseBytes']:raise ValueError()
                        data.extend(chunk)
                    result=json.loads(data);_V['output'].validate(result);return result
    except Exception:raise StandardSubtaskError('Subtask dispatch unavailable or refused; no result confirmed. Do not automatically retry.') from None

def spawn_async_task_tool():
    async def run(runtime:ToolRuntime,**kwargs):return await _parse(runtime,kwargs)
    def sync(runtime:ToolRuntime,**kwargs):return asyncio.run(_parse(runtime,kwargs))
    return StructuredTool(name=_SCHEMA['toolName'],args_schema=_SCHEMA['toolInput'],func=sync,coroutine=run,
        description='Queue a durable text-only child task. contextRefs must be exact JSON strings with sourceId and versionId from knowledge results, optionally projectId; no copied source bodies. All references are checked now and again before execution. Reuse idempotencyKey for the same logical request. Returns the actual child status, not a completed artifact.')
