"""Late source-owned candidate staging seal. Import is inert; no host/SQL execution.

A compiled retained transport is required. This module supplies no transport and
never upgrades the held-epoch collection's qualified=false into approval.
"""
import copy
import hashlib
import json
import os
import pathlib
import re
import stat
from candidate_writer import validate, APP, BASELINE
from writer_fence import DATABASES, digest, require
from current_held_epoch_evidence_producer import binding, produce as collect_epoch
from isolated_conservation_plan import private_bytes, read_ref

REFS = ('template', 'epochInput', 'epochCollection', 'epochManifest', 'runtimeSeal', 'completion',
        'liveLedger', 'stageInspection', 'artifact')
BIND = ('identity', 'toolRevision', 'host', 'epoch', 'holdGeneration')


def exact(value, keys, code):
    require(type(value) is dict and set(value) == set(keys), code)


def produce(inputs, transport=None, reader=private_bytes, large_reader=None, epoch_producer=collect_epoch):
    exact(inputs, (*BIND, 'refs'), 'CANDIDATE_PRODUCER_INPUT_SCHEMA')
    bound = binding(inputs)
    exact(inputs['refs'], REFS, 'CANDIDATE_PRODUCER_REFERENCE_CLOSURE')
    require(transport is not None and all(callable(getattr(transport, method, None)) for method in
        ('require_lock', 'observe_hold', 'observe_retained_sessions', 'verify_current_epoch',
         'observe_stage', 'observe_completion', 'verify_runtime_seal')), 'CANDIDATE_PRODUCER_TRANSPORT_REQUIRED')
    refs = inputs['refs']; raw_reads = {}
    def read(name):
        ref = refs[name]
        exact(ref, ('path', 'sha256'), 'CANDIDATE_PRODUCER_REFERENCE_SCHEMA')
        attempt=bound['identity']['attemptId']
        fixed_paths=dict(runtimeSeal=f'/var/lib/workspacex-cn/runtime/{attempt}/sealed-writer-runtime.json',
            completion=f'/etc/workspacex-cn/migration-completion-inputs/{APP}/{attempt}.completed.json',
            epochManifest=f'/etc/workspacex-cn/maintenance-epoch/{APP}/{attempt}/epoch.json')
        require(type(ref['path']) is str and '..' not in pathlib.Path(ref['path']).parts and
                (ref['path']==fixed_paths[name] if name in fixed_paths else ref['path'].startswith('/etc/workspacex-cn/')),
                'CANDIDATE_PRODUCER_REFERENCE_PATH')
        raw = reader(ref['path'], ref['sha256']); raw_reads[name] = raw
        return json.loads(raw)
    def guard():
        transport.require_lock()
        require(transport.observe_hold() == dict(schemaVersion=1,state='held',
            generation=bound['holdGeneration'],identity=bound['identity'],host=bound['host']),
            'CANDIDATE_PRODUCER_HOLD_DRIFT')
    def bound_record(value):
        require(all(value.get(k) == bound[k] for k in BIND), 'CANDIDATE_PRODUCER_EVIDENCE_BINDING')
    guard()
    template = read('template'); validate(template, bound['identity'])
    require(template['identity'] == bound['identity'] and template['host'] == bound['host'] and
            template['baselineRevision'] == BASELINE, 'CANDIDATE_PRODUCER_TEMPLATE_BINDING')
    epoch_input = read('epochInput'); collection = read('epochCollection')
    require(epoch_producer(epoch_input, reader, large_reader) == collection,
            'CANDIDATE_PRODUCER_EPOCH_RECOMPUTE')
    bound_record(collection)
    require(collection.get('kind') == 'current-held-epoch-evidence-collection' and
            collection.get('collectionVerified') is True and collection.get('qualified') is False and
            collection.get('ready') is False, 'CANDIDATE_PRODUCER_COLLECTION_SCOPE')
    manifest=read('epochManifest')
    exact(manifest,('schemaVersion','kind','identity','toolRevision','holdGeneration','databases','objectRecovery',
                    'beforeHeldObservationSha256','afterHeldObservationSha256'),'CANDIDATE_PRODUCER_MANIFEST_SCHEMA')
    require(manifest['schemaVersion']==1 and manifest['kind']=='held-current-epoch-manifest' and
            all(manifest[k]==bound[k] for k in ('identity','toolRevision','holdGeneration')),
            'CANDIDATE_PRODUCER_MANIFEST_BINDING')
    exact(manifest['databases'],DATABASES,'CANDIDATE_PRODUCER_MANIFEST_DATABASES')
    for ref in list(manifest['databases'].values())+[manifest['objectRecovery']]:
        exact(ref,('path','sha256'),'CANDIDATE_PRODUCER_MANIFEST_REFERENCE')
        require(type(ref['path']) is str and ref['path'].startswith('/etc/workspacex-cn/') and
                '..' not in pathlib.Path(ref['path']).parts and type(ref['sha256']) is str and
                re.fullmatch('[a-f0-9]{64}',ref['sha256']),'CANDIDATE_PRODUCER_MANIFEST_REFERENCE')
    require(all(type(manifest[k]) is str and re.fullmatch('[a-f0-9]{64}',manifest[k]) for k in
                ('beforeHeldObservationSha256','afterHeldObservationSha256')) and
            manifest['beforeHeldObservationSha256']!=manifest['afterHeldObservationSha256'],
            'CANDIDATE_PRODUCER_MANIFEST_OBSERVATIONS')
    # Semantic collection epoch is distinct from the immutable manifest byte hash.
    epoch_refs=dict(collection=refs['epochCollection'],manifest=refs['epochManifest'])
    qualification = transport.verify_current_epoch(copy.deepcopy(epoch_refs),copy.deepcopy(bound))
    exact(qualification, (*BIND,'collectionSha256','epochManifestSha256','kind','recoveryEvidenceSha256','acceptanceEvidenceSha256'),
          'CANDIDATE_PRODUCER_EPOCH_TRANSPORT_SCHEMA')
    bound_record(qualification)
    require(qualification['kind'] == 'retained-current-epoch-verified' and
            qualification['collectionSha256'] == refs['epochCollection']['sha256'] and
            qualification['epochManifestSha256'] == refs['epochManifest']['sha256'] and
            all(type(qualification[k]) is str and re.fullmatch('[a-f0-9]{64}',qualification[k]) for k in
                ('recoveryEvidenceSha256','acceptanceEvidenceSha256')), 'CANDIDATE_PRODUCER_EPOCH_UNPROVEN')
    runtime = read('runtimeSeal')
    require(runtime.get('schemaVersion') == 1 and runtime.get('kind') == 'sealed-maintenance-writer-runtime'
            and runtime.get('identity') == bound['identity'] and runtime.get('toolRevision') == bound['toolRevision']
            and runtime.get('ready') is False and runtime.get('productionAvailabilityProven') is False,
            'CANDIDATE_PRODUCER_RUNTIME_SEAL')
    require(transport.verify_runtime_seal(copy.deepcopy(refs['runtimeSeal']),copy.deepcopy(bound)) == runtime,
            'CANDIDATE_PRODUCER_RETAINED_RUNTIME_UNPROVEN')
    rp = runtime['runtimePlan']
    require(rp['identity'] == bound['identity'] and rp['host'] == bound['host'] and
            rp['holdGeneration'] == bound['holdGeneration'] and rp['databasePeers'] == template['databasePeers']
            and runtime['runtimePlanSha256'] == digest(rp), 'CANDIDATE_PRODUCER_RUNTIME_BINDING')
    sessions = dict(control=rp['controlSessions'],diagnostic=rp['diagnosticSessions'])
    require(runtime['sessionsSha256'] == digest(sessions) and
            transport.observe_retained_sessions(copy.deepcopy(bound)) == sessions,
            'CANDIDATE_PRODUCER_ACTUAL_SESSIONS')
    held = {}; pids = set()
    for db in DATABASES:
        held[db] = []
        for mode in ('control','diagnostic'):
            exact(sessions[mode], DATABASES, 'CANDIDATE_PRODUCER_SIX_SESSIONS')
            session = sessions[mode][db]
            require(session['peer'] == template['databasePeers'][db] and type(session['pid']) is int
                    and session['pid'] > 1 and session['pid'] not in pids and
                    type(session['backendStart']) is str and session['backendStart'],
                    'CANDIDATE_PRODUCER_SESSION_IDENTITY')
            pids.add(session['pid'])
            held[db].append(dict(pid=session['pid'],backendStart=session['backendStart'],role=session['role'],
                transactionMode='idle-controlled' if mode=='control' else 'read-only', backendType='client backend',
                peerSha256=digest(session['peer']),clientIdentity='maintenance-control' if mode=='control' else template['diagnosticClientIdentity']))
    completion = read('completion'); ledger = read('liveLedger'); stage = read('stageInspection'); artifact = read('artifact')
    for value in (ledger,stage,artifact):bound_record(value)
    require(completion.get('schemaVersion') == 1 and completion.get('kind') == 'validated-migration-completion'
            and completion.get('identity') == bound['identity'] and completion.get('toolRevision') == bound['toolRevision'],
            'CANDIDATE_PRODUCER_COMPLETION_IDENTITY')
    require(transport.observe_completion(copy.deepcopy(bound)) == dict(completion=refs['completion'],ledger=ledger),
            'CANDIDATE_PRODUCER_DURABLE_COMPLETION')
    require(ledger.get('kind') == 'retained-live-migration-ledger' and ledger['connection'] == sessions['diagnostic']['workspacex']
            and ledger['rowCount'] == len(ledger['ledger']) and len({r['name'] for r in ledger['ledger']}) == len(ledger['ledger']),
            'CANDIDATE_PRODUCER_LIVE_LEDGER')
    require(stage.get('kind') == 'candidate-staged-container-inspection' and
            transport.observe_stage(copy.deepcopy(bound)) == stage, 'CANDIDATE_PRODUCER_LIVE_STAGE')
    containers = stage['containers']; require(type(containers) is list and
        len({c['Id'] for c in containers}) == len(containers), 'CANDIDATE_PRODUCER_CONTAINER_CLOSURE')
    indexed = {c['Id']:c for c in containers}
    for writer in template['candidateWriters'] + template['baselineWriters']:
        b = writer['binding']; live = indexed.get(b['containerId'])
        require(live is not None and live['Image'] == b['imageId'] and digest(live['Config']) == b['configSha256']
                and (live['State']['Running'] is False or live['State']['Paused'] is True),
                'CANDIDATE_PRODUCER_STAGE_WRITER_BINDING')
        labels=live['Config'].get('Labels',{})
        require(labels.get('com.docker.compose.service')==b['service'] and
                labels.get('com.docker.compose.project.config_files')==b['composePath'] and
                stage['composeSha256'].get(b['composePath'])==b['composeSha256'], 'CANDIDATE_PRODUCER_COMPOSE_BINDING')
    require(artifact.get('kind') == 'candidate-artifact-reference' and artifact['artifact']['sha256'] == template['artifactSha256'],
            'CANDIDATE_PRODUCER_ARTIFACT_BINDING')
    artifact_ref=artifact['artifact'];exact(artifact_ref,('path','sha256'),'CANDIDATE_PRODUCER_ARTIFACT_SCHEMA')
    require(type(artifact_ref['path']) is str and artifact_ref['path'].startswith('/etc/workspacex-cn/')
            and '..' not in pathlib.Path(artifact_ref['path']).parts,'CANDIDATE_PRODUCER_ARTIFACT_PATH')
    artifact_raw=reader(artifact_ref['path'],artifact_ref['sha256'])
    require(hashlib.sha256(artifact_raw).hexdigest()==artifact_ref['sha256'],'CANDIDATE_PRODUCER_ARTIFACT_BYTES')
    plan=copy.deepcopy(template);plan.update(heldSessions=held,candidateSessions={db:[] for db in DATABASES},
        epoch=refs['epochManifest']['sha256'],holdGeneration=bound['holdGeneration'],migrationCompletionSha256=refs['completion']['sha256'],
        migrationLedgerSha256=digest(sorted([dict(name=r['name'],checksum=r['checksum']) for r in ledger['ledger']],key=lambda r:r['name'])))
    plan['stagingIdentity']=dict(identity=bound['identity'],sourceRevision=APP,baselineRevision=BASELINE,
        writersSha256=digest(plan['candidateWriters']),artifactSha256=plan['artifactSha256'],epoch=plan['epoch'])
    validate(plan,bound['identity'])
    guard()
    require(transport.observe_retained_sessions(copy.deepcopy(bound))==sessions and
            transport.observe_stage(copy.deepcopy(bound))==stage and
            transport.observe_completion(copy.deepcopy(bound))==dict(completion=refs['completion'],ledger=ledger),
            'CANDIDATE_PRODUCER_LATE_RACE')
    require(reader(artifact_ref['path'],artifact_ref['sha256'])==artifact_raw,'CANDIDATE_PRODUCER_ARTIFACT_RACE')
    for name,raw in raw_reads.items():require(reader(refs[name]['path'],refs[name]['sha256'])==raw,'CANDIDATE_PRODUCER_REF_RACE')
    return dict(schemaVersion=1,toolRevision=bound['toolRevision'],plan=plan,artifact=artifact['artifact'])


def write_candidate(path,value):
    """Root-private exact actor wrapper; exclusive create, no overwrite/retry guess."""
    exact(value,('schemaVersion','toolRevision','plan','artifact'),'CANDIDATE_PRODUCER_OUTPUT_SCHEMA')
    require(value['schemaVersion']==1 and type(value['toolRevision']) is str and re.fullmatch('[a-f0-9]{40}',value['toolRevision']),'CANDIDATE_PRODUCER_OUTPUT_TOOL')
    validate(value['plan'],value['plan']['identity'])
    exact(value['artifact'],('path','sha256'),'CANDIDATE_PRODUCER_OUTPUT_ARTIFACT')
    require(value['artifact']['sha256']==value['plan']['artifactSha256'],'CANDIDATE_PRODUCER_OUTPUT_ARTIFACT')
    p=pathlib.Path(path);i=value['plan']['identity']
    require(str(p)==f"/etc/workspacex-cn/maintenance-candidate/{APP}/{i['attemptId']}/candidate-plan.json",'CANDIDATE_PRODUCER_OUTPUT_PATH')
    require(os.geteuid()==0,'CANDIDATE_PRODUCER_ROOT_REQUIRED')
    for parent in p.parents:
        s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_gid==0 and not s.st_mode&0o022,'CANDIDATE_PRODUCER_PARENT_TRUST')
    require(stat.S_IMODE(p.parent.stat().st_mode)==0o700,'CANDIDATE_PRODUCER_PRIVATE_PARENT')
    raw=json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
    fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
    return dict(path=str(p),sha256=hashlib.sha256(raw).hexdigest())
