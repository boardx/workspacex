"""Run-bound canonical browser tools backed by WorkspaceX's Playwright MCP adapter."""
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from jsonschema import Draft7Validator, FormatChecker
from langchain.tools import ToolRuntime
from langchain_core.tools import StructuredTool

_SCHEMA = json.loads((Path(__file__).parent / 'generated/standard_browser_schema.json').read_text())
_BINDING = json.loads((Path(__file__).parent / 'generated/native_session_binding_schema.json').read_text())['configurableKey']
_INPUT = Draft7Validator(_SCHEMA['input'], format_checker=FormatChecker())
_TOOLS = {name: (Draft7Validator(value['input'], format_checker=FormatChecker()), Draft7Validator(value['output'], format_checker=FormatChecker())) for name, value in _SCHEMA['tools'].items()}


class StandardBrowserError(RuntimeError):
    """Denied and unknown outcomes are intentionally indistinguishable to the model."""


async def _invoke(name, args, runtime):
    status = None
    try:
        tool_input, output = _TOOLS[name]
        tool_input.validate(args)
        config = runtime.config['configurable']
        callback = config['run_control_callback']
        base = callback['base_url'].rstrip('/')
        parsed = urlsplit(base)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not callback['key']:
            raise ValueError('callback_endpoint_shape')
        body = {
            'orgId': callback['org_id'],
            'attemptId': callback['attempt_id'],
            'leaseEpoch': callback['lease_epoch'],
            'bindingId': config[_BINDING]['bindingId'],
            'toolCallId': runtime.tool_call_id,
            'toolName': name,
            'toolArgs': args,
        }
        if callback.get('permission_request_id') is not None:
            body['permissionRequestId'] = callback['permission_request_id']
        _INPUT.validate(body)
        deadline = _SCHEMA['limits']['deadlineMs'] / 1000 + 5
        url = f"{base}/internal/agent-runs/{quote(callback['run_id'], safe='')}/standard-browser/invoke"
        async with asyncio.timeout(deadline):
            async with httpx.AsyncClient(timeout=deadline, follow_redirects=False, trust_env=False) as client:
                async with client.stream('POST', url, headers={'x-deep-agent-internal-key': callback['key'], 'accept-encoding': 'identity'}, json=body) as response:
                    status = response.status_code
                    if status != 200 or response.headers.get('content-encoding', 'identity') != 'identity':
                        raise ValueError('upstream_status_or_encoding')
                    content = bytearray()
                    async for chunk in response.aiter_raw():
                        if len(content) + len(chunk) > _SCHEMA['limits']['maxResponseBytes']:
                            raise ValueError('response_too_large')
                        content.extend(chunk)
                    result = json.loads(content)
                    output.validate(result)
                    return result
    except Exception as cause:
        # #2930 —— 模型看到的那句话**逐字不变**：对模型不可区分是设计（见类 docstring），
        # 它阻止模型自动重试。没有设计理由的是**运维视角也瞎**：`from None` 丢掉了每一个
        # 原因，于是陈旧引用被拒(403)、上游 5xx、超时、响应超限、输出 schema 违规在日志里
        # 长得一模一样。S013 已有两轮排查死在这上面（issue #2930）。
        #
        # 这里只往 stderr 打**有界且无密**的一行：异常类型 + 内部标签 + HTTP 状态码。
        # 刻意不打 str(cause) 与响应体——`test_failure_is_sanitized_and_not_retried`
        # 钉着凭据不得出现在错误里，那条纪律同样适用于这行日志。
        detail = type(cause).__name__
        tag = cause.args[0] if isinstance(cause, ValueError) and cause.args and isinstance(cause.args[0], str) else None
        if tag:
            detail += f' [{tag}]'
        if status is not None:
            detail += f' http_status={status}'
        print(f'[standard-browser] {name} refused or failed: {detail}', file=sys.stderr, flush=True)
        raise StandardBrowserError('Browser action refused, failed, or has an unknown outcome; do not retry automatically') from None


def standard_browser_tools():
    descriptions = {
        'browser_navigate': 'Open a public HTTP(S) page in this run-isolated browser. Private network destinations and credentials in URLs are refused.',
        'browser_snapshot': 'Read the current page accessibility structure and receive opaque element references bound to this page generation.',
        'browser_click': 'Click one opaque element reference after dispatch-time authorization. Stale or cross-run references are refused.',
        'browser_fill_form': 'Fill authorized form fields by opaque references. Stale, foreign, or mismatched references are refused.',
        'browser_take_screenshot': 'Capture a real PNG into this run workspace. Publish it separately with wx_artifact_publish when user delivery is required.',
    }

    def build(name):
        async def invoke(runtime: ToolRuntime, **kwargs):
            return await _invoke(name, kwargs, runtime)

        def sync(runtime: ToolRuntime, **kwargs):
            return asyncio.run(_invoke(name, kwargs, runtime))

        return StructuredTool(name=name, description=descriptions[name], args_schema=_SCHEMA['tools'][name]['input'], func=sync, coroutine=invoke)

    return [build(name) for name in descriptions]
