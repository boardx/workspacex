"""Record one actual parent-owned retained capture. Never approves source policy.

No CLI, JSON operation registry, supplied PID, passed flag or success callback.
Production dispatch is the exact compiled RetainedEpochCapture.run_production.
External producer outputs cannot acquire invocation receipts through this API.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import types

DATABASES = ('workspacex', 'workspacex_agent', 'workspacex_memory')
SOURCE = '.harness/scripts/vm/parent_source_invocation_receipt.py'
CAPTURE = '.harness/scripts/vm/retained_epoch_capture.py'


def require(value, code):
    if not value:
        raise ValueError(code)


def identity():
    pid = os.getpid()
    proc = Path('/proc') / str(pid)
    fields = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
    namespaces = {name: re.fullmatch(name + r':\[([0-9]+)\]', os.readlink(proc / 'ns' / name)).group(1) for name in ('pid', 'mnt', 'net')}
    return {'pid': pid, 'processStart': fields[19], 'namespaces': namespaces,
            'executable': str(Path(os.readlink(proc / 'exe')).resolve())}


def direct_children():
    # Include live processes and zombies. Reading PPID is portable across Linux
    # proc mounts that omit the optional per-task children pseudo-file.
    result = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(fields[1]) == os.getpid():
                result[int(entry.name)] = fields[19]
        except (FileNotFoundError, ProcessLookupError):
            pass
    return result


def compiled_method(raw, filename, class_name, method):
    module = compile(raw, filename, 'exec')
    classes = [c for c in module.co_consts if isinstance(c, types.CodeType) and c.co_name == class_name]
    require(len(classes) == 1, 'PARENT_SOURCE_CLASS')
    methods = [c for c in classes[0].co_consts if isinstance(c, types.CodeType) and c.co_name == method]
    require(len(methods) == 1, 'PARENT_SOURCE_METHOD')
    return methods[0]


def nested_refs(value):
    found = []
    def walk(v):
        if type(v) is dict:
            if set(v) in ({'path', 'sha256'}, {'path', 'sha256', 'bytes'}):
                if v not in found:
                    found.append(v)
            else:
                for child in v.values():
                    walk(child)
        elif type(v) is list:
            for child in v:
                walk(child)
    walk(value)
    return found


def record_production(capture, code_authority, protected, producer_id,
                      input_references, *, local_fixture=False):
    """Actual parent operation -> invocation drafts, pending external approval.

    Authorities must be the concrete protected/code readers already loaded from
    the independent root profile. Input refs are checked before capture, every
    nested capture-plan/output ref is required, and source/exe pins are read again
    after capture. Failed operations produce no invocation drafts.
    """
    from current_epoch_qualification import QualificationCodeAuthority, QualificationReader
    import epoch_recovery
    require(type(code_authority) is QualificationCodeAuthority and type(protected) is epoch_recovery.ProtectedArtifacts, 'PARENT_SOURCE_EXTERNAL_AUTHORITIES')
    require(type(producer_id) is str and re.fullmatch('[a-z0-9][a-z0-9._-]{0,127}', producer_id), 'PARENT_SOURCE_PRODUCER_ID')
    require(type(input_references) is list, 'PARENT_SOURCE_INPUT_REFS')
    if local_fixture:
        require(os.geteuid() != 0 and code_authority.fixture_root is not None and type(capture) is _FixtureCapture, 'PARENT_SOURCE_FIXTURE_FORBIDDEN')
        source_key = SOURCE
        module = sys.modules[__name__]
        cls = _FixtureCapture
    else:
        require(os.geteuid() == 0 and code_authority.fixture_root is None, 'PARENT_SOURCE_ROOT_REQUIRED')
        import retained_epoch_capture
        cls = retained_epoch_capture.RetainedEpochCapture
        require(type(capture) is cls, 'PARENT_SOURCE_FIXED_CAPTURE')
        source_key = CAPTURE
        module = retained_epoch_capture
    require(SOURCE in code_authority.source_pins and source_key in code_authority.source_pins, 'PARENT_SOURCE_PIN_REQUIRED')
    source = code_authority.source_pins[source_key]
    raw_source = code_authority.read(source)
    expected = compiled_method(raw_source, module.__file__, cls.__name__, 'run_production')
    require(expected == cls.run_production.__code__, 'PARENT_SOURCE_LOADED_METHOD_PIN')
    require(capture.run_production.__func__ is cls.run_production, 'PARENT_SOURCE_NO_CALLBACK')
    output_method = compiled_method(raw_source, module.__file__, cls.__name__, 'actual_production_outputs')
    require(output_method == cls.actual_production_outputs.__code__, 'PARENT_SOURCE_OUTPUT_METHOD_PIN')
    require(hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == code_authority.source_pins[SOURCE]['sha256'], 'PARENT_SOURCE_RECORDER_LOADED_PIN')
    parent = identity()
    exe = {'path': parent['executable'], 'sha256': code_authority.approved.get(parent['executable'], (None, None))[0]}
    require(code_authority.admits(exe), 'PARENT_SOURCE_ACTUAL_EXECUTABLE_PIN')
    code_authority.read(exe)
    qr = QualificationReader(protected, code_authority)
    inputs = []
    for ref in [*input_references, *code_authority.source_pins.values()]:
        expanded = qr.expand(ref)
        list(qr.blocks(expanded))
        if expanded not in inputs:
            inputs.append(expanded)
    if not local_fixture:
        require(capture.b['providerBindingSha256'] == capture.host.plan['providerBindingSha256'], 'PARENT_SOURCE_HOST_PROVIDER_BINDING')
        snapshot_method = compiled_method(raw_source, module.__file__, cls.__name__, 'snapshot_inputs')
        require(snapshot_method == cls.snapshot_inputs.__code__, 'PARENT_SOURCE_INPUT_METHOD_PIN')
    # Adopt orphaned descendants so a leader exit cannot hide live children.
    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'PARENT_SOURCE_SUBREAPER_REQUIRED')
    before_children = direct_children()
    started = time.time()
    # Exact source call once. Existing retained sessions stay in this parent.
    draft_ref = cls.run_production(capture)
    ended = time.time()
    require(identity() == parent, 'PARENT_SOURCE_PROCESS_CHANGED')
    require(direct_children() == before_children, 'PARENT_SOURCE_NEW_CHILD_NOT_JOINED')
    if not local_fixture:
        require(capture.host.stream_attempts == capture.host.joined_streams == len(DATABASES), 'PARENT_SOURCE_STREAMS_NOT_JOINED')
        watchdog = capture.host.watchdog
        require(watchdog is not None and watchdog.failure is None and
                (watchdog.thread is None or not watchdog.thread.is_alive()), 'PARENT_SOURCE_WATCHDOG_NOT_JOINED')
    draft = qr.json(draft_ref)
    require(draft.get('kind') == 'source-owned-epoch-capture-draft' and draft.get('binding') == capture.b and draft.get('qualified') is False and draft.get('ready') is False, 'PARENT_SOURCE_CAPTURE_DRAFT')
    start = draft['captureStartedAt']
    end = draft['captureEndedAt']
    require(type(start) in (int, float) and type(end) in (int, float) and started <= start <= end <= ended, 'PARENT_SOURCE_CAPTURE_TIMES')
    require(draft['before']['value']['observedAt'] <= start <= end <= draft['after']['value']['observedAt'], 'PARENT_SOURCE_HELD_WINDOW')
    require(draft['producerProcess']['pid'] == parent['pid'] and draft['producerProcess']['processStart'] == parent['processStart'] and draft['producerProcess']['namespaces'] == parent['namespaces'], 'PARENT_SOURCE_CAPTURE_PROCESS')
    require(draft['producerProcess']['sourceSha256'] == source['sha256'] and draft['producerProcess']['executableSha256'] == exe['sha256'], 'PARENT_SOURCE_CAPTURE_IDENTITY')
    if not local_fixture:
        witnesses = draft.get('inputReferences')
        require(type(witnesses) is list and len(witnesses) >= 7, 'PARENT_SOURCE_PROTECTED_INPUT_WITNESSES')
        for ref in witnesses:
            require(Path(ref['path']).parent == capture.root, 'PARENT_SOURCE_INPUT_SCOPE')
            expanded = qr.expand(ref)
            list(qr.blocks(expanded))
            if expanded not in inputs:
                inputs.append(expanded)
    output_records = cls.actual_production_outputs(capture)
    expected_kinds = {'before-held-drained', 'after-held-drained', 'held-interval-journal',
                      *(prefix + ':' + db for prefix in ('permissions', 'dump', 'backend') for db in DATABASES)}
    require(type(output_records) is dict and set(output_records) == expected_kinds, 'PARENT_SOURCE_TWELVE_OUTPUTS')
    outputs = {}
    for kind, record in output_records.items():
        require(type(record) is dict and set(record) == {'output', 'startedAt', 'endedAt'}, 'PARENT_SOURCE_OPERATION_RECORD')
        left, right = record['startedAt'], record['endedAt']
        require(type(left) in (int, float) and type(right) in (int, float) and started <= left <= right <= ended, 'PARENT_SOURCE_OPERATION_WINDOW')
        if kind.startswith(('permissions:', 'dump:', 'backend:')):
            require(start <= left <= right <= end, 'PARENT_SOURCE_PRODUCTION_WINDOW')
        outputs[kind] = record['output']
    # Outputs must originate in this source operation's fixed attempt directory.
    require(all(Path(ref['path']).parent == capture.root for ref in outputs.values()), 'PARENT_SOURCE_OUTPUT_SCOPE')
    for ref in outputs.values():
        value = qr.json(ref)
        for nested in nested_refs(value):
            expanded = qr.expand(nested)
            list(qr.blocks(expanded))
            if expanded not in inputs:
                inputs.append(expanded)
    require(re.fullmatch('[a-f0-9]{64}', capture.b.get('providerBindingSha256', '')), 'PARENT_SOURCE_PROVIDER_BINDING')
    qr.finish()
    invocations = {}
    for kind, ref in outputs.items():
        left, right = output_records[kind]['startedAt'], output_records[kind]['endedAt']
        invocations[kind] = {'schemaVersion': 2, 'kind': kind, 'binding': capture.b,
            'producerId': producer_id, 'source': source, 'executable': exe,
            'pid': parent['pid'], 'processStart': parent['processStart'],
            'startedAt': left, 'endedAt': right, 'namespaces': parent['namespaces'],
            'providerBindingSha256': capture.b['providerBindingSha256'],
            'inputs': inputs, 'output': qr.expand(ref), 'exitCode': 0,
            'ownedChildrenJoined': True}
    return {'schemaVersion': 1, 'kind': 'parent-source-invocation-draft',
            'capture': qr.expand(draft_ref), 'invocations': invocations,
            'ready': False, 'qualified': False, 'sourcePolicyApproved': False}


class _FixtureCapture:
    """Non-root source-compiled disposable fixture; never a production dispatch."""
    def __init__(self, root, binding, mode='success'):
        require(os.geteuid() != 0, 'PARENT_SOURCE_FIXTURE_ROOT_FORBIDDEN')
        self.root = Path(root)
        self.b = binding
        self.mode = mode
        self.host = types.SimpleNamespace(plan={})
        self.actor = types.SimpleNamespace(plan={})
        self.serial = 0
    def save(self, value):
        self.serial += 1
        path = self.root / (str(self.serial) + '.json')
        raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
        return {'path': str(path), 'sha256': hashlib.sha256(raw).hexdigest()}
    def run_production(self):
        require(self.mode != 'failure', 'PARENT_SOURCE_FIXTURE_ACTUAL_FAILURE')
        parent = identity()
        before = {'value': {'observedAt': time.time()}, 'qualification': self.save({'binding': self.b, 'fixture': 'before'})}
        start = time.time()
        values = {key: {db: self.save({'binding': self.b, 'database': db, 'fixture': key}) for db in DATABASES} for key in ('permissions', 'dumpLanes', 'backend')}
        end = time.time()
        after = {'value': {'observedAt': time.time()}, 'qualification': self.save({'binding': self.b, 'fixture': 'after'})}
        exe = Path(parent['executable']).read_bytes()
        source = Path(__file__).read_bytes()
        draft = {'kind': 'source-owned-epoch-capture-draft', 'binding': self.b,
                 'before': before, 'after': after, **values,
                 'heldJournal': self.save({'binding': self.b, 'fixture': 'journal'}),
                 'captureStartedAt': start, 'captureEndedAt': end,
                 'producerProcess': {**parent, 'sourceSha256': hashlib.sha256(source).hexdigest(), 'executableSha256': hashlib.sha256(exe).hexdigest()},
                 'ready': False, 'qualified': False}
        if self.mode == 'unjoined':
            pid = os.fork()
            if pid == 0:
                os._exit(0)
        self.draft_value = draft
        self.actual_outputs = {'before-held-drained': {'output': before['qualification'], 'startedAt': before['value']['observedAt'], 'endedAt': start},
                               'after-held-drained': {'output': after['qualification'], 'startedAt': end, 'endedAt': after['value']['observedAt']},
                               'held-interval-journal': {'output': draft['heldJournal'], 'startedAt': end, 'endedAt': time.time()}}
        for prefix, key in (('permissions', 'permissions'), ('dump', 'dumpLanes'), ('backend', 'backend')):
            self.actual_outputs.update({prefix + ':' + db: {'output': ref, 'startedAt': start, 'endedAt': end} for db, ref in values[key].items()})
        return self.save(draft)
    def actual_production_outputs(self):
        return self.actual_outputs
