"""Gateway-selected native graph; resolves secrets transiently, never creates sessions."""
from contextlib import asynccontextmanager
import time
import re
import copy
import asyncio
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from jsonschema import Draft7Validator, FormatChecker

from .native_graph import create_native_graph
from .native_artifact_publish import artifact_publish_tool
from .standard_web_tools import standard_web_tools
from .standard_memory import standard_memory_tools
from .native_skill_activity import canonical_package_manifest
from .native_tool_authority import HttpNativeToolAuthority
from .sandbox_backend import HttpSessionSandbox
from .skill_packages import package_mount_files

_SCHEMA=json.loads((Path(__file__).parent/'generated/native_session_binding_schema.json').read_text())
_VALIDATORS={name:Draft7Validator(_SCHEMA[name],format_checker=FormatChecker()) for name in ('ref','input','output')}

class NativeFactoryError(RuntimeError):
    pass

def native_config_key():
    return _SCHEMA['configurableKey']

def _shared_runtime():
    from deep_agent_service.graph import _model, graph
    from deep_agent_service.tracing import build_tracing_callbacks
    return _model, graph.checkpointer, build_tracing_callbacks()

def _sandbox_client(socket):
    return httpx.Client(transport=httpx.HTTPTransport(uds=socket),base_url='http://sandbox',timeout=5.0,follow_redirects=False)

async def _resolve(ref, identity):
    base=os.environ.get('NATIVE_SESSION_SERVICE_BASE_URL','').rstrip('/')
    key=os.environ.get('NATIVE_SESSION_SERVICE_KEY','')
    parsed=urlsplit(base)
    if not key or parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise NativeFactoryError('Native session service is not configured')
    try:
        async with asyncio.timeout(5.0):
            async with httpx.AsyncClient(timeout=5.0,follow_redirects=False,trust_env=False) as client:
                async with client.stream('POST',f"{base}/internal/native-sessions/{ref['bindingId']}/resolve",
                    headers={'x-deep-agent-internal-key':key,'accept-encoding':'identity'},json=identity) as response:
                    if response.status_code!=200 or response.headers.get('content-encoding','identity')!='identity':
                        raise NativeFactoryError('Native session resolution refused')
                    content=bytearray()
                    async for chunk in response.aiter_raw():
                        if len(content)+len(chunk)>16384: raise NativeFactoryError('Native session response exceeded limit')
                        content.extend(chunk)
                    resolved=json.loads(content);_VALIDATORS['output'].validate(resolved)
                    if resolved['expiresAt'] <= time.time() * 1000:
                        raise NativeFactoryError('Native session binding expired')
                    return resolved
    except NativeFactoryError: raise
    except Exception: raise NativeFactoryError('Native session resolution unavailable or invalid') from None

def _canonical_package_set(packages):
    if _SCHEMA.get('packageSetAlgorithm') != 'v1:json-sorted-ascii-stableName-skillId-versionId-packageDigest-tuples':
        raise NativeFactoryError('Unsupported native package set algorithm')
    names = [item['stableName'] for item in packages]
    if len(set(names)) != len(names) or any(not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name) for name in names):
        raise NativeFactoryError('Invalid native package stable name')
    tuples = [[item['stableName'], item['skillId'], item['versionId'], item['packageDigest']]
              for item in sorted(packages, key=lambda item: item['stableName'])]
    return json.dumps(tuples, ensure_ascii=False, separators=(',', ':'))


def _package_set_digest(pins):
    packages = []
    for skill in pins:
        package = skill['package']
        digest = hashlib.sha256(canonical_package_manifest(package['files']).encode('utf-8')).hexdigest()
        packages.append({'stableName': skill['stable_name'], 'skillId': package['skillId'],
                         'versionId': package['versionId'], 'packageDigest': digest})
    return hashlib.sha256(_canonical_package_set(packages).encode('utf-8')).hexdigest()

@asynccontextmanager
async def native_graph_context(config):
    """Official LangGraph factory context: close transport, leave lifecycle to gateway."""
    try:
        configurable=config['configurable'];ref=configurable[native_config_key()]
        _VALIDATORS['ref'].validate(ref)
        callback=configurable['run_control_callback']
        identity={'orgId':callback['org_id'],'runId':callback['run_id'],'attemptId':callback['attempt_id'],'leaseEpoch':callback['lease_epoch']}
        _VALIDATORS['input'].validate(identity)
        pins=copy.deepcopy(configurable['org_skills'])
        if not isinstance(pins,list): raise ValueError()
        package_mount_files(pins)
        socket=os.environ.get('NATIVE_SESSION_SOCKET','')
        if not socket.startswith('/') or '\x00' in socket: raise ValueError()
    except Exception: raise NativeFactoryError('Missing or invalid trusted native binding configuration') from None
    resolved=await _resolve(ref,identity)
    # Shared multi-package canonicalization is supplied by the binding contract generator.
    expected=_package_set_digest(pins)
    if resolved['packageDigest']!=expected: raise NativeFactoryError('Native session package binding mismatch')
    with _sandbox_client(socket) as client:
        adapter=HttpSessionSandbox(resolved['sessionId'],resolved['token'],client)
        model,checkpointer,callbacks=_shared_runtime()
        graph=await asyncio.to_thread(create_native_graph,model,sandbox=adapter,pinned_skills=pins,
            tools=[artifact_publish_tool(), *standard_web_tools(), *standard_memory_tools()],interrupt_on=resolved['interruptOn'],tool_authority=HttpNativeToolAuthority(),checkpointer=checkpointer)
        yield graph.with_config({'callbacks':callbacks})
