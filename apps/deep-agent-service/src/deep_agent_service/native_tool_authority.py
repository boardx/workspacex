"""Dispatch-time authority check; never grants from model-supplied identity."""
import asyncio
import json
from weakref import WeakValueDictionary
from langchain_core.messages import ToolMessage
from pathlib import Path
from typing import Protocol
from urllib.parse import quote, urlsplit

import httpx
from jsonschema import Draft7Validator, FormatChecker
from langchain.agents.middleware import AgentMiddleware
from langgraph.config import get_config
from langgraph.types import interrupt
from .native_tool_review import NativeToolReviewState, reviewed_by_hitl

AUTHORITY_DEADLINE_SECONDS = 5.0
AUTHORITY_MAX_RESPONSE_BYTES = 16 * 1024

_SCHEMA=json.loads((Path(__file__).parent/'generated/tool_authority_schema.json').read_text())
_INPUT=Draft7Validator(_SCHEMA['input'],format_checker=FormatChecker())
_OUTPUT=Draft7Validator(_SCHEMA['output'],format_checker=FormatChecker())

class ToolAuthorityError(RuntimeError):
    """Unknown or denied authorization: caller must not dispatch or retry."""

class ToolApprovalRequired(ToolAuthorityError):
    """A validated host decision requires the existing user approval flow."""

class ReportOutputPublished(ToolAuthorityError):
    """Host refused an unnecessary mutation after the report output was already staged."""

class ToolAuthority(Protocol):
    def check(self, tool_call: dict) -> None: ...
    async def acheck(self, tool_call: dict) -> None: ...

class HttpNativeToolAuthority:
    def _request(self, call):
        try:
            callback=(get_config().get('configurable') or {}).get('run_control_callback')
            if not isinstance(callback,dict): raise ValueError()
            for name in ('base_url','key','org_id','run_id','attempt_id'):
                if not isinstance(callback.get(name),str) or not callback[name].strip(): raise ValueError()
            base=urlsplit(callback['base_url'])
            if base.scheme not in ('http','https') or not base.hostname or base.username or base.password or base.query or base.fragment:
                raise ValueError()
            if not isinstance(call.get('id'),str) or not call['id']: raise ValueError()
            body={'orgId':callback['org_id'],'attemptId':callback['attempt_id'],'leaseEpoch':callback.get('lease_epoch'),
                  'toolName':call.get('name'),'toolCallId':call['id'],'toolArgs':call.get('args')}
            if callback.get('permission_request_id') is not None: body['permissionRequestId']=callback['permission_request_id']
            _INPUT.validate(body)
            url=f"{callback['base_url'].rstrip('/')}/internal/agent-runs/{quote(callback['run_id'],safe='')}/tool-execution/check"
            return url, {'x-deep-agent-internal-key':callback['key']}, body
        except Exception:
            raise ToolAuthorityError('Invalid or missing trusted tool authority context') from None

    @staticmethod
    def _validate(response):
        try:
            if response.status_code != 200: raise ValueError()
            body=response.json(); _OUTPUT.validate(body)
            if body['allowed'] is not True:
                if body.get('reason')=='report_output_published' and body.get('reportFile',{}).get('published') is True:
                    raise ReportOutputPublished('Report output is already staged; no further mutation was executed')
                if body["reason"] == "approval_required":
                    raise ToolApprovalRequired("Tool execution requires host-bound user approval")
                raise ToolAuthorityError(f"Tool execution denied: {body['reason']}")
            return body
        except ToolAuthorityError: raise
        except Exception: raise ToolAuthorityError('Invalid tool authority response') from None

    async def _perform(self, url, headers, body):
        try:
            async with asyncio.timeout(AUTHORITY_DEADLINE_SECONDS):
                async with httpx.AsyncClient(timeout=AUTHORITY_DEADLINE_SECONDS, follow_redirects=False, trust_env=False) as client:
                    async with client.stream("POST", url, headers={**headers, "accept-encoding": "identity"}, json=body) as response:
                        if response.status_code != 200 or response.headers.get("content-encoding", "identity") != "identity":
                            raise ToolAuthorityError("Invalid tool authority response")
                        chunks = bytearray()
                        async for chunk in response.aiter_raw():
                            if len(chunks) + len(chunk) > AUTHORITY_MAX_RESPONSE_BYTES:
                                raise ToolAuthorityError("Tool authority response exceeded limit")
                            chunks.extend(chunk)
                        return self._validate(httpx.Response(200, content=bytes(chunks)))
        except (httpx.HTTPError, TimeoutError):
            raise ToolAuthorityError('Tool authority unavailable; dispatch refused') from None

    def check(self, tool_call):
        request = self._request(tool_call)
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            # Same bounded transport for sync callers; no watchdog threads or socket patches.
            return asyncio.run(self._perform(*request))
        raise ToolAuthorityError("Use asynchronous authority checks inside an active event loop")

    async def acheck(self, tool_call):
        return await self._perform(*self._request(tool_call))

class NativeToolAuthority(AgentMiddleware):
    state_schema = NativeToolReviewState
    def __init__(self, authority: ToolAuthority):
        if not callable(getattr(authority,'check',None)) or not callable(getattr(authority,'acheck',None)):
            raise TypeError('A trusted tool authority with sync and async checks is required')
        self._authority=authority
        self._report_locks=WeakValueDictionary()

    def wrap_tool_call(self, request, handler):
        reviewed=False
        try:
            try:
                decision=self._authority.check(request.tool_call)
            except ToolApprovalRequired:
                if reviewed_by_hitl(request):
                    raise ToolAuthorityError("HITL approval did not authorize this exact host-bound call") from None
                request=self._review_approval(request)
                reviewed=True
                if isinstance(request, ToolMessage): return request
                decision=self._authority.check(request.tool_call)
        except ReportOutputPublished:
            return self._report_closed(request)
        if not reviewed and not reviewed_by_hitl(request) and isinstance(decision,dict) and decision.get("approvedOnce") is True:
            request=self._review_approval(request)
            if isinstance(request, ToolMessage): return request
            decision=self._authority.check(request.tool_call)
        if isinstance(decision,dict) and decision.get('reportFile'):
            # The native service dispatches asynchronously. Refuse an unsafe synchronous
            # report path rather than execute parallel mutations without its run lock.
            raise ToolAuthorityError('Report output dispatch requires asynchronous execution')
        return handler(request)

    async def awrap_tool_call(self, request, handler):
        reviewed=False
        try:
            try:
                decision=await self._authority.acheck(request.tool_call)
            except ToolApprovalRequired:
                if reviewed_by_hitl(request):
                    raise ToolAuthorityError("HITL approval did not authorize this exact host-bound call") from None
                request=self._review_approval(request)
                reviewed=True
                if isinstance(request, ToolMessage): return request
                decision=await self._authority.acheck(request.tool_call)
            if not reviewed and not reviewed_by_hitl(request) and isinstance(decision,dict) and decision.get("approvedOnce") is True:
                request=self._review_approval(request)
                reviewed=True
                if isinstance(request, ToolMessage): return request
                decision=await self._authority.acheck(request.tool_call)
            policy=decision.get('reportFile') if isinstance(decision,dict) else None
            if not policy:
                return await handler(request)
            key=policy['jobId']
            lock=self._report_locks.get(key)
            if lock is None:
                lock=asyncio.Lock()
                self._report_locks[key]=lock
            async with lock:
                # The first check can precede a same-batch publisher. Recheck while
                # serialized; approvals stay bound to the same call/attempt identity.
                await self._authority.acheck(request.tool_call)
                return await handler(request)
        except ReportOutputPublished:
            return self._report_closed(request)

    @staticmethod
    def _review_approval(request):
        call=request.tool_call
        # Standard HITL resume format; approval is never authority by itself.
        # The caller rechecks the host-bound call/args/attempt before dispatch.
        response=interrupt({
            "action_requests": [{"name": call["name"], "args": call["args"]}],
            "review_configs": [{"action_name": call["name"], "allowed_decisions": ["approve", "edit", "reject"]}],
        })
        decisions=response.get("decisions") if isinstance(response,dict) else None
        if not isinstance(decisions,list) or len(decisions)!=1 or not isinstance(decisions[0],dict):
            raise ToolAuthorityError("Invalid tool approval response")
        decision=decisions[0]
        if decision.get("type")=="reject":
            return ToolMessage(content="User rejected this tool call. No operation was dispatched.",
                               name=call["name"],tool_call_id=call["id"],status="error")
        if decision.get("type")=="approve": return request
        if decision.get("type")=="edit":
            edited=decision.get("edited_action")
            if not isinstance(edited,dict) or edited.get("name")!=call["name"] or not isinstance(edited.get("args"),dict):
                raise ToolAuthorityError("Invalid edited tool approval")
            return request.override(tool_call={**call,"args":edited["args"]})
        raise ToolAuthorityError("Invalid tool approval decision")

    @staticmethod
    def _report_closed(request):
        return ToolMessage(content=json.dumps({'error':'REPORT_OUTPUT_ALREADY_STAGED','detail':'No mutation was executed. Complete the final reply; normal run writeback publishes the staged attachment.'}),
                           name=request.tool_call['name'],tool_call_id=request.tool_call['id'],status='error')
