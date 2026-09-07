"""Parse a fixed original with the gateway's locked, offline AnyDoc CLI."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit
import httpx
from jsonschema import Draft7Validator, FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool

_SCHEMA=json.loads((Path(__file__).parent/'generated/standard_document_schema.json').read_text())
_BINDING=json.loads((Path(__file__).parent/'generated/native_session_binding_schema.json').read_text())['configurableKey']
_V={name:Draft7Validator(_SCHEMA[name],format_checker=FormatChecker()) for name in ('toolInput','input','output')}
class StandardDocumentError(RuntimeError):
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
        url=f"{base}/internal/agent-runs/{quote(callback['run_id'],safe='')}/document/parse"
        # Includes bounded source reads and the actual 30-second isolated conversion.
        deadline=_SCHEMA['limits']['timeoutMs']/1000+30
        async with asyncio.timeout(deadline):
            async with httpx.AsyncClient(timeout=deadline,follow_redirects=False,trust_env=False) as client:
                async with client.stream('POST',url,headers={'x-deep-agent-internal-key':callback['key'],'accept-encoding':'identity'},json=body) as response:
                    if response.status_code!=200 or response.headers.get('content-encoding','identity')!='identity':raise ValueError()
                    data=bytearray()
                    async for chunk in response.aiter_raw():
                        if len(data)+len(chunk)>_SCHEMA['limits']['responseBytes']:raise ValueError()
                        data.extend(chunk)
                    result=json.loads(data);_V['output'].validate(result);return result
    except Exception:raise StandardDocumentError('Document parsing unavailable or refused; no result confirmed. Do not automatically retry.') from None

def document_parse_tool():
    async def run(runtime:ToolRuntime,**kwargs):return await _parse(runtime,kwargs)
    def sync(runtime:ToolRuntime,**kwargs):return asyncio.run(_parse(runtime,kwargs))
    return StructuredTool(name=_SCHEMA['toolName'],args_schema=_SCHEMA['toolInput'],func=sync,coroutine=run,
        description='Convert a current run original /inputs file to verified Markdown in /workspace using offline AnyDoc. Only markdown output and ocr=false are supported. No OCR, page coordinates or guaranteed cross-page table reconstruction. Read the returned textPath to inspect content; this is a workspace file, not a published attachment.')
