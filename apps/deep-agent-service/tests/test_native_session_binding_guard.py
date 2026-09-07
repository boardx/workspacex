import asyncio
import copy
from types import SimpleNamespace
from uuid import uuid4
import pytest
from deep_agent_service.native_session_binding_guard import NativeSessionBindingGuard
from deep_agent_service.native_sandbox_dispatch import NativeSandboxDispatch
from deep_agent_service.native_tool_authority import ToolAuthorityError
from test_native_factory import resolved
from test_native_file_delegation import MANIFEST


def test_current_binding_check_uses_resolver_each_time_without_retaining_token():
    value={**resolved(),'inputs':copy.deepcopy(MANIFEST)};calls=[]
    async def resolve_current():calls.append('resolve');return copy.deepcopy(value)
    guard=NativeSessionBindingGuard(value,resolve_current)
    guard.check();asyncio.run(guard.acheck());assert calls==['resolve','resolve']
    assert value['token'] not in repr(vars(guard))


@pytest.mark.parametrize('change',['session','package','inputs','policy','expired','denied','invalid'])
def test_binding_changes_or_revocation_fail_closed_sanitized(change):
    value={**resolved(),'inputs':copy.deepcopy(MANIFEST)};current=copy.deepcopy(value)
    if change=='session':current['sessionId']=str(uuid4())
    if change=='package':current['packageDigest']='f'*64
    if change=='inputs':current['inputs']=[]
    if change=='policy':current['interruptOn']={'execute':False}
    if change=='expired':current['expiresAt']=0
    if change=='invalid':current['token']='secret-invalid'
    async def resolve_current():
        if change=='denied':raise RuntimeError('secret response body')
        return current
    with pytest.raises(ToolAuthorityError) as error:asyncio.run(NativeSessionBindingGuard(value,resolve_current).acheck())
    assert 'secret' not in str(error.value)


def test_queue_admission_precedes_source_recheck_and_postcheck_refuses_revoked_result():
    async def scenario():
        value={**resolved(),'inputs':copy.deepcopy(MANIFEST)};allowed=True;checks=[];started=asyncio.Event();release=asyncio.Event();calls=[]
        async def resolve_current():
            checks.append('check')
            if not allowed:raise RuntimeError('revoked')
            return value
        gate=NativeSandboxDispatch(value['sessionId'],binding_guard=NativeSessionBindingGuard(value,resolve_current))
        req=lambda name:SimpleNamespace(tool_call={'name':name,'id':str(uuid4()),'args':{}})
        async def parse(_):calls.append('parse');started.set();await release.wait();return 'cached /workspace/parsed/document.md'
        async def cached(_):calls.append('cached');return 'source bytes'
        active=asyncio.create_task(gate.awrap_tool_call(req('wx_document_parse'),parse));await started.wait()
        queued=asyncio.create_task(gate.awrap_tool_call(req('execute'),cached));await asyncio.sleep(.02)
        assert checks==['check'];allowed=False;release.set()
        with pytest.raises(ToolAuthorityError):await active
        with pytest.raises(ToolAuthorityError):await queued
        assert calls==['parse'];assert checks==['check']*3
        for name in ['read_file','execute']:
            with pytest.raises(ToolAuthorityError):await gate.awrap_tool_call(req(name),cached)
        assert calls==['parse']
    asyncio.run(scenario())
