"""Explicit artifact staging; durable attachment/version readiness belongs to writeback."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from jsonschema import Draft7Validator, FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool

_SCHEMA = json.loads((Path(__file__).parent / 'generated/native_artifact_schema.json').read_text())
_BINDING_KEY = json.loads((Path(__file__).parent / 'generated/native_session_binding_schema.json').read_text())['configurableKey']
_VALIDATORS = {key: Draft7Validator(_SCHEMA[key], format_checker=FormatChecker()) for key in ('toolInput', 'input', 'output')}

class NativeArtifactPublishError(RuntimeError):
    """No automatic retry after an unknown side-effect response."""

async def _stage(runtime: ToolRuntime, args: dict):
    try:
        _VALIDATORS['toolInput'].validate(args)
        config = runtime.config['configurable']
        callback = config['run_control_callback']
        base = callback['base_url'].rstrip('/')
        parsed = urlsplit(base)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not callback['key']:
            raise ValueError()
        body = {'orgId': callback['org_id'], 'attemptId': callback['attempt_id'], 'leaseEpoch': callback['lease_epoch'],
                'bindingId': config[_BINDING_KEY]['bindingId'], 'toolCallId': runtime.tool_call_id, 'toolArgs': args}
        if callback.get('permission_request_id') is not None:
            body['permissionRequestId'] = callback['permission_request_id']
        _VALIDATORS['input'].validate(body)
        url = f"{base}/internal/agent-runs/{quote(callback['run_id'], safe='')}/native-artifacts/stage"
        async with asyncio.timeout(30):
            async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False) as client:
                async with client.stream('POST', url, headers={'x-deep-agent-internal-key': callback['key'], 'accept-encoding': 'identity'}, json=body) as response:
                    if response.status_code != 200 or response.headers.get('content-encoding', 'identity') != 'identity':
                        raise ValueError()
                    content = bytearray()
                    async for chunk in response.aiter_raw():
                        if len(content) + len(chunk) > 16384:
                            raise ValueError()
                        content.extend(chunk)
                    result = json.loads(content)
                    _VALIDATORS['output'].validate(result)
                    return result
    except Exception:
        raise NativeArtifactPublishError('Artifact staging unavailable or refused; no ready artifact confirmed') from None

def _publish(workspacePath: str, title: str, mediaType: str, idempotencyKey: str, runtime: ToolRuntime):
    return asyncio.run(_stage(runtime, dict(workspacePath=workspacePath, title=title, mediaType=mediaType, idempotencyKey=idempotencyKey)))

async def _apublish(workspacePath: str, title: str, mediaType: str, idempotencyKey: str, runtime: ToolRuntime):
    return await _stage(runtime, dict(workspacePath=workspacePath, title=title, mediaType=mediaType, idempotencyKey=idempotencyKey))

def artifact_publish_tool():
    return StructuredTool(name=_SCHEMA['toolName'], description='Stage a completed workspace file for publication. Returns staged, not ready. The artifact and attachment become ready only after successful run writeback. Reuse the idempotency key only for identical arguments and bytes.',
                          args_schema=_SCHEMA['toolInput'], func=_publish, coroutine=_apublish)
