"""Thin tools over the trusted gateway's single persistent pg-boss scheduler."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote,urlsplit
import httpx
from jsonschema import Draft7Validator,FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool
from .standard_memory import _identity
_SCHEMA=json.loads((Path(__file__).parent/'generated/standard_schedule_schema.json').read_text())
_DESCRIPTIONS={
 'wx_schedule_create':'Schedule an instruction in this conversation using its current agent. Explicit once instant or five-field cron with IANA timezone. Future runs recheck access. Cron skips missed offline occurrences.',
 'wx_schedule_list':'List your schedules in the current organization, with their actual next occurrence and status.',
 'wx_schedule_cancel':'Cancel future occurrences of your schedule. Does not stop any run already accepted. Repeated cancellation is idempotent.',
}
class StandardScheduleError(RuntimeError):
    """Unknown creation outcome must not be retried with a new idempotency key."""

def standard_schedule_tools():
    def build(name):
        async def invoke(runtime:ToolRuntime,**kwargs):
            try:
                Draft7Validator(_SCHEMA['tools'][name],format_checker=FormatChecker()).validate(kwargs)
                scope,callback=_identity(runtime)
                base=callback['base_url'].rstrip('/');url=urlsplit(base)
                if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment or not callback['key']:raise ValueError()
                body={'orgId':scope['orgId'],'userId':scope['userId'],'attemptId':callback['attempt_id'],'leaseEpoch':callback['lease_epoch'],'toolCallId':runtime.tool_call_id,'toolName':name,'toolArgs':kwargs}
                if callback.get('permission_request_id'):body['permissionRequestId']=callback['permission_request_id']
                Draft7Validator(_SCHEMA['input'],format_checker=FormatChecker()).validate(body)
                async with asyncio.timeout(8),httpx.AsyncClient(timeout=8,follow_redirects=False,trust_env=False) as client:
                    async with client.stream('POST',f"{base}/internal/agent-runs/{quote(callback['run_id'],safe='')}/schedule/tools/invoke",json=body,headers={'x-deep-agent-internal-key':callback['key'],'accept-encoding':'identity'}) as response:
                        if response.status_code!=200 or response.headers.get('content-encoding','identity')!='identity':raise ValueError()
                        content=bytearray()
                        async for chunk in response.aiter_raw():
                            if len(content)+len(chunk)>_SCHEMA['limits']['maxResponseBytes']:raise ValueError()
                            content.extend(chunk)
                        result=json.loads(content)
                Draft7Validator(_SCHEMA['outputs'][name],format_checker=FormatChecker()).validate(result)
                return result
            except Exception:raise StandardScheduleError('schedule_unavailable_or_refused') from None
        def sync(runtime:ToolRuntime,**kwargs):return asyncio.run(invoke(runtime,**kwargs))
        return StructuredTool(name=name,description=_DESCRIPTIONS[name],args_schema=_SCHEMA['tools'][name],func=sync,coroutine=invoke)
    return [build(name) for name in _SCHEMA['tools']]
