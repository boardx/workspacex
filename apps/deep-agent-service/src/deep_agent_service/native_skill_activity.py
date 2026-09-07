"""Observed native Skill discovery/reads, never inferred execution success."""
from contextvars import ContextVar
import hashlib
import json
from pathlib import Path

from jsonschema import Draft7Validator
from langchain.agents.middleware import AgentMiddleware
from langgraph.config import get_stream_writer

_ARTIFACT = json.loads((Path(__file__).parent / 'generated/skill_activity_schema.json').read_text())
_VALIDATOR = Draft7Validator(_ARTIFACT['schema'])
_READ_CONTEXT = ContextVar('native_skill_read_context', default=None)


class SkillActivityError(RuntimeError):
    pass


def canonical_package_manifest(files):
    algorithm = _ARTIFACT['packageDigestAlgorithm']
    if algorithm != {'version': 1, 'hash': 'sha256', 'encoding': 'utf-8', 'ordering': 'unicode-code-point',
                     'serialization': 'compact-json-path-digest-pairs'}:
        raise SkillActivityError('Unsupported package digest algorithm')
    paths = [f['path'] for f in files]
    if len(paths) != len(set(paths)):
        raise SkillActivityError('Duplicate package paths')
    return json.dumps([[f['path'], f['digest']] for f in sorted(files, key=lambda f:f['path'])],
                      ensure_ascii=False, separators=(',', ':'))


def observe_skill_read(path, result):
    context = _READ_CONTEXT.get()
    if (context is not None and result.error is None and result.file_data is not None
            and not getattr(result, "no_lines_requested", False) and result.file_data.get("content")):
        activity, call_id, writer = context
        activity.body_read(path, call_id, writer)


def observe_skill_execute(command, result):
    context = _READ_CONTEXT.get()
    if context is None or result.exit_code != 0 or result.truncated:
        return
    activity, call_id, writer = context
    activity.complete_cat_read(command, result.output, call_id, writer)


class NativeSkillActivity(AgentMiddleware):
    def __init__(self, pinned_skills):
        self._by_path = {}
        self._instruction_digests = {}
        for skill in pinned_skills:
            package = skill['package']
            digest = hashlib.sha256(canonical_package_manifest(package['files']).encode('utf-8')).hexdigest()
            path = f"/skills/{skill['stable_name']}/SKILL.md"
            self._instruction_digests[path] = next(f['digest'] for f in package['files'] if f['path'] == 'SKILL.md')
            self._by_path[path] = {
                'contractVersion': 1, 'skillId': package['skillId'], 'skillStableName': skill['stable_name'],
                'skillVersion': package['versionId'], 'packageDigest': digest}

    def complete_cat_read(self, command, output, call_id, writer):
        # Deliberately not arbitrary shell tracing: exact single cat, real complete
        # stdout, and immutable pinned bytes are all required before an event.
        for path, expected in self._instruction_digests.items():
            if command not in (f"cat {path}", f"/usr/bin/cat {path}"):
                continue
            if hashlib.sha256(output.encode('utf-8')).hexdigest() == expected:
                self.body_read(path, call_id, writer)
            return

    def _emit(self, identity, stage, writer, *, path=None, call_id=None):
        material = [stage, identity['skillId'], identity['skillStableName'], identity['skillVersion'], identity['packageDigest'], path, call_id]
        fact = {**identity, 'stage': stage,
                'factId': hashlib.sha256(json.dumps(material, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()}
        if path is not None:
            fact['readPath'] = path
        envelope = {'type': 'skill_activity', 'version': 1, 'fact': fact}
        try:
            _VALIDATOR.validate(envelope)
            writer(envelope)
        except Exception as error:
            raise SkillActivityError('Skill activity stream delivery failed') from error

    def metadata_discovered(self, metadata):
        writer = get_stream_writer()
        for entry in metadata:
            identity = self._by_path.get(entry['path'])
            if identity is None or identity['skillStableName'] != entry['name']:
                raise SkillActivityError('Discovered skill does not match trusted package identity')
            self._emit(identity, 'metadata_discovered', writer)

    def body_read(self, path, call_id, writer):
        identity = self._by_path.get(path)
        if identity is not None:
            if not isinstance(call_id, str) or not call_id:
                raise SkillActivityError('Native skill body read requires actual tool-call identity')
            self._emit(identity, 'body_read', writer, path=path, call_id=call_id)

    def wrap_tool_call(self, request, handler):
        if request.tool_call['name'] not in ('read_file', 'execute'):
            return handler(request)
        token = _READ_CONTEXT.set((self, request.tool_call.get('id'), get_stream_writer()))
        try:
            return handler(request)
        finally:
            _READ_CONTEXT.reset(token)

    async def awrap_tool_call(self, request, handler):
        if request.tool_call['name'] not in ('read_file', 'execute'):
            return await handler(request)
        token = _READ_CONTEXT.set((self, request.tool_call.get('id'), get_stream_writer()))
        try:
            return await handler(request)
        finally:
            _READ_CONTEXT.reset(token)
