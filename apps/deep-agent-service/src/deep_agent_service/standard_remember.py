"""issue #4344: the agent's only memory tool opens the F17 "remember" card for this turn.

It never writes memory. The gateway opens an *open* confirmation card under this
turn's answer; the person clicks 记住 (or declines) and only then does anything
reach the knowledge graph. The model supplies just the sentence: thread, message
and requester come from the server-side run, never from tool arguments.

Failures are specific codes from the shared contract (`failureCodes`), mapped
one-to-one from the gateway's HTTP status -- never one generic sentence.
"""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from jsonschema import Draft7Validator, FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool

_SCHEMA = json.loads((Path(__file__).parent / 'generated/standard_remember_schema.json').read_text())
_V = {name: Draft7Validator(_SCHEMA[name], format_checker=FormatChecker()) for name in ('input', 'toolInput', 'toolOutput')}
_STATUS_CODES = {400: 'remember_invalid_request', 401: 'remember_not_authorized', 403: 'remember_not_authorized'}
_DESCRIPTION = (
    "Ask the user to confirm remembering one fact about them (a goal, preference, or anything they asked you to remember). "
    "Give `statement` as one complete, self-contained sentence (e.g. '用户的目标是今年跑完半马'). "
    "This does NOT save anything: it shows a confirmation card under your answer and the fact is stored in long-term memory "
    "only after the user clicks 记住 on it. Never tell the user it is already saved; relay the returned `instruction`. "
    "The thread and message are taken from the current turn; do not pass ids."
)


class StandardRememberError(RuntimeError):
    """No card was opened and nothing was saved. `code` is one of the contract's failureCodes."""

    def __init__(self, code):
        if code not in _SCHEMA['failureCodes']:
            code = 'remember_unavailable'
        self.code = code
        super().__init__(f"{code}: no confirmation card was opened and nothing was saved")


async def _invoke(runtime, args):
    try:
        _V['toolInput'].validate(args)
        callback = runtime.config['configurable']['run_control_callback']
        base = callback['base_url'].rstrip('/')
        parsed = urlsplit(base)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not callback['key']:
            raise ValueError('callback')
        body = {'orgId': callback['org_id'], 'attemptId': callback['attempt_id'], 'leaseEpoch': callback['lease_epoch'],
                'toolCallId': runtime.tool_call_id, 'toolName': _SCHEMA['toolName'], 'toolArgs': args}
        if callback.get('permission_request_id') is not None:
            body['permissionRequestId'] = callback['permission_request_id']
        _V['input'].validate(body)
    except Exception:
        raise StandardRememberError('remember_invalid_request') from None
    try:
        deadline = _SCHEMA['limits']['deadlineMs'] / 1000
        async with asyncio.timeout(deadline):
            async with httpx.AsyncClient(timeout=deadline, follow_redirects=False, trust_env=False) as client:
                async with client.stream('POST', f"{base}/internal/agent-runs/{quote(callback['run_id'], safe='')}/remember/invoke",
                                         headers={'x-deep-agent-internal-key': callback['key'], 'accept-encoding': 'identity'}, json=body) as response:
                    if response.status_code != 200:
                        raise StandardRememberError(_STATUS_CODES.get(response.status_code, 'remember_unavailable'))
                    if response.headers.get('content-encoding', 'identity') != 'identity':
                        raise ValueError('encoding')
                    content = bytearray()
                    async for chunk in response.aiter_raw():
                        if len(content) + len(chunk) > _SCHEMA['limits']['maxResponseBytes']:
                            raise ValueError('size')
                        content.extend(chunk)
                    result = json.loads(content)
                    _V['toolOutput'].validate(result)
                    return result
    except StandardRememberError:
        raise
    except Exception:
        raise StandardRememberError('remember_unavailable') from None


def remember_tool():
    async def run(runtime: ToolRuntime, **kwargs):
        return await _invoke(runtime, kwargs)

    def sync(runtime: ToolRuntime, **kwargs):
        return asyncio.run(_invoke(runtime, kwargs))

    return StructuredTool(name=_SCHEMA['toolName'], description=_DESCRIPTION, args_schema=_SCHEMA['toolInput'], func=sync, coroutine=run)
