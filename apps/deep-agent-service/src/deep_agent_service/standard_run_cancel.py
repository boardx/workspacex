"""Request durable parent/child cancellation through existing gateway business logic."""
import asyncio,json
from pathlib import Path
from urllib.parse import quote,urlsplit
import httpx
from jsonschema import Draft7Validator,FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool
_SCHEMA=json.loads((Path(__file__).parent/'generated/standard_run_cancel_schema.json').read_text())
class StandardRunCancelError(RuntimeError):pass
async def _invoke(args,runtime):
 try:
  callback=runtime.config['configurable']['run_control_callback'];base=callback['base_url'].rstrip('/');parsed=urlsplit(base)
  if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:raise ValueError()
  body={'orgId':callback['org_id'],'attemptId':callback['attempt_id'],'leaseEpoch':callback['lease_epoch'],'toolCallId':runtime.tool_call_id,'toolName':_SCHEMA['toolName'],'toolArgs':args}
  if callback.get('permission_request_id') is not None:body['permissionRequestId']=callback['permission_request_id']
  Draft7Validator(_SCHEMA['input'],format_checker=FormatChecker()).validate(body);deadline=_SCHEMA['limits']['deadlineMs']/1000+2
  async with asyncio.timeout(deadline):
   async with httpx.AsyncClient(timeout=deadline,follow_redirects=False,trust_env=False) as client:
    async with client.stream('POST',f"{base}/internal/agent-runs/{quote(callback['run_id'],safe='')}/standard-run-cancel/invoke",headers={'x-deep-agent-internal-key':callback['key'],'accept-encoding':'identity'},json=body) as response:
     if response.status_code!=202 or response.headers.get('content-encoding','identity')!='identity':raise ValueError()
     content=bytearray()
     async for chunk in response.aiter_raw():
      if len(content)+len(chunk)>_SCHEMA['limits']['maxResponseBytes']:raise ValueError()
      content.extend(chunk)
     result=json.loads(content);Draft7Validator(_SCHEMA['toolOutput'],format_checker=FormatChecker()).validate(result);return result
 except Exception:raise StandardRunCancelError('Run cancellation unavailable or refused; cancellation is not confirmed') from None
def run_cancel_tool():
 async def run(runtime:ToolRuntime,**kwargs):return await _invoke(kwargs,runtime)
 def sync(runtime:ToolRuntime,**kwargs):return asyncio.run(_invoke(kwargs,runtime))
 return StructuredTool(name=_SCHEMA['toolName'],description='Request cancellation of a run owned by the current run requester. This is a high-risk action requiring authority approval. A request is not terminal until finalStatus is returned or wx_run_status observes cancelled.',args_schema=_SCHEMA['toolInput'],func=sync,coroutine=run)
