import copy
import hashlib
import json
import unittest
import datetime
from candidate_completion_contract import ledger_sha
from candidate_plan_producer import produce, write_candidate, BIND
from candidate_writer import validate
from current_held_epoch_evidence_producer import ECS
from test_candidate_writer import fixture
from writer_fence import DATABASES, digest


def data_fixture():
    identity,template,j,t=fixture();identity['attemptId']='candidate-one'
    template['host']=dict(instanceId=ECS,bootId='12345678-1234-1234-1234-123456789abc')
    bound={k:template[k] for k in ('identity','host','epoch','holdGeneration')};bound['toolRevision']='f'*40
    artifact_raw=b'fixed offline candidate artifact'
    template['artifactSha256']=hashlib.sha256(artifact_raw).hexdigest()
    control={};diagnostic={};pid=100
    for db in DATABASES:
        for target,role in ((control,'migration_admin'),(diagnostic,'diagnostic')):
            pid+=1;target[db]=dict(pid=pid,backendStart='2026-10-04T00:00:00Z',role=role,
                peer=template['databasePeers'][db],clientAddr='192.168.100.40')
    rp=dict(identity=identity,host=bound['host'],holdGeneration=bound['holdGeneration'],
        databasePeers=template['databasePeers'],controlSessions=control,diagnosticSessions=diagnostic)
    runtime=dict(schemaVersion=1,kind='sealed-maintenance-writer-runtime',identity=identity,
        toolRevision=bound['toolRevision'],runtimePlan=rp,runtimePlanSha256=digest(rp),
        sessionsSha256=digest(dict(control=control,diagnostic=diagnostic)),ready=False,productionAvailabilityProven=False)
    stage=dict(**bound,kind='candidate-staged-container-inspection',containers=[],composeSha256={})
    for w in template['candidateWriters']+template['baselineWriters']:
        b=w['binding'];config=dict(Labels={'com.docker.compose.service':b['service'],
            'com.docker.compose.project.config_files':b['composePath']});b['configSha256']=digest(config)
        stage['containers'].append(dict(Id=b['containerId'],Image=b['imageId'],Config=config,State=dict(Running=True,Paused=True)))
        stage['composeSha256'][b['composePath']]=b['composeSha256']
    collection=dict(**bound,kind='current-held-epoch-evidence-collection',collectionVerified=True,qualified=False,ready=False)
    manifest=dict(schemaVersion=1,kind='held-current-epoch-manifest',identity=identity,toolRevision=bound['toolRevision'],
        holdGeneration=bound['holdGeneration'],databases={db:dict(path='/etc/workspacex-cn/'+db+'.json',sha256='a'*64) for db in DATABASES},
        objectRecovery=dict(path='/etc/workspacex-cn/object.json',sha256='b'*64),
        beforeHeldObservationSha256='c'*64,afterHeldObservationSha256='d'*64)
    docs=dict(template=template,epochInput=dict(**bound),epochCollection=collection,epochManifest=manifest,runtimeSeal=runtime,
        completion=dict(schemaVersion=1,scope='validated-production-migration-completion',sourceRevision=identity['sourceRevision'],
            baselineRevision=identity['baselineRevision'],attemptId=identity['attemptId'],originalPlanSha256=identity['migrationPlanSha256'],
            release='2026.10.3-cn.1',completionPlanSha256='a'*64,sourceInventorySha256='b'*64,sourceBindingSha256='c'*64,
            snapshotSha256='d'*64,fullResponseSha256='e'*64,ledgerSha256=ledger_sha([dict(name='001_test.sql',checksum='a'*64)]),
            appliedSqlCount=1,pendingCount=0,driftCount=0,unknownAppliedCount=0,productionMutationAuthorized=False,
            capturedAt=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),
            providerFinishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),
            expiresAt=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=59)).isoformat().replace('+00:00','Z')),
        liveLedger=dict(**bound,kind='retained-live-migration-ledger',connection=diagnostic['workspacex'],rowCount=1,
            ledger=[dict(name='001_test.sql',checksum='a'*64)]),stageInspection=stage,
        artifact=dict(**bound,kind='candidate-artifact-reference',artifact=dict(path='/etc/workspacex-cn/artifact.json',sha256=template['artifactSha256'])))
    refs={};bytes_by_path={}
    for name,value in docs.items():
        raw=json.dumps(value,sort_keys=True).encode();path='/etc/workspacex-cn/input/'+name+'.json'
        if name=='runtimeSeal':path='/var/lib/workspacex-cn/runtime/'+identity['attemptId']+'/sealed-writer-runtime.json'
        if name=='completion':path='/etc/workspacex-cn/migration-completion-inputs/'+identity['sourceRevision']+'/'+identity['attemptId']+'.completed.json'
        if name=='epochManifest':path='/etc/workspacex-cn/maintenance-evidence/'+identity['sourceRevision']+'/'+identity['attemptId']+'/qualified-current-epoch/epoch.json'
        refs[name]=dict(path=path,sha256=hashlib.sha256(raw).hexdigest());bytes_by_path[path]=raw
    bytes_by_path['/etc/workspacex-cn/artifact.json']=artifact_raw
    inputs=dict(**bound,refs=refs)
    def reader(path,expected):
        raw=bytes_by_path[path]
        if hashlib.sha256(raw).hexdigest()!=expected:raise RuntimeError('INPUT_HASH_DRIFT')
        return raw
    class Transport:
        def verify_runtime_seal(self,ref,b):return copy.deepcopy(runtime)
        def require_lock(self):pass
        def observe_hold(self):return dict(schemaVersion=1,state='held',generation=bound['holdGeneration'],identity=identity,host=bound['host'])
        def observe_retained_sessions(self,b):return copy.deepcopy(dict(control=control,diagnostic=diagnostic))
        def verify_current_epoch(self,ref,b):return dict(**bound,kind='retained-current-epoch-verified',collectionSha256=ref['collection']['sha256'],epochManifestSha256=ref['manifest']['sha256'],recoveryEvidenceSha256='b'*64,acceptanceEvidenceSha256='c'*64)
        def observe_stage(self,b):return copy.deepcopy(stage)
        def observe_completion(self,b):return dict(completion=refs['completion'],ledger=copy.deepcopy(docs['liveLedger']))
    return inputs,docs,bytes_by_path,reader,Transport(),lambda p,r,l:copy.deepcopy(collection)


class Tests(unittest.TestCase):
    def test_late_plan_uses_actual_sessions_stage_completion_and_compatible_schema(self):
        inputs,docs,raw,reader,transport,epoch=data_fixture()
        output=produce(inputs,transport,reader,epoch_producer=epoch)
        validate(output['plan'],inputs['identity'])
        self.assertEqual(set(output),{'schemaVersion','toolRevision','plan','artifact'})
        self.assertEqual(output['plan']['heldSessions']['workspacex'][0]['pid'],101)
        self.assertEqual(output['plan']['migrationCompletionSha256'],inputs['refs']['completion']['sha256'])
        self.assertFalse(docs['epochCollection']['qualified'])
        self.assertEqual(output['plan']['epoch'],inputs['refs']['epochManifest']['sha256'])
        self.assertNotEqual(output['plan']['epoch'],inputs['epoch'])

    def test_missing_real_transport_cannot_be_replaced_by_plan_boolean(self):
        inputs,docs,raw,reader,transport,epoch=data_fixture()
        with self.assertRaisesRegex(RuntimeError,'TRANSPORT_REQUIRED'):produce(inputs,None,reader,epoch_producer=epoch)
        inputs['qualified']=True
        with self.assertRaisesRegex(RuntimeError,'INPUT_SCHEMA'):produce(inputs,transport,reader,epoch_producer=epoch)

    def test_identity_generation_epoch_peer_completion_stage_and_sessions_fail_closed(self):
        for variant in ('hold','epoch','sessions','stage','completion','recompute','rawhash','live-ledger'):
            inputs,docs,raw,reader,transport,epoch=data_fixture()
            if variant=='hold':transport.observe_hold=lambda:dict(schemaVersion=1,state='cleared')
            if variant=='epoch':transport.verify_current_epoch=lambda r,b:dict(**b,kind='caller-approved',collectionSha256=r['collection']['sha256'],epochManifestSha256=r['manifest']['sha256'],recoveryEvidenceSha256='b'*64,acceptanceEvidenceSha256='c'*64)
            if variant=='sessions':transport.observe_retained_sessions=lambda b:{}
            if variant=='stage':transport.observe_stage=lambda b:{}
            if variant=='completion':transport.observe_completion=lambda b:{}
            if variant=='recompute':epoch=lambda p,r,l:{}
            if variant=='rawhash':raw[inputs['refs']['runtimeSeal']['path']]+=b' '
            if variant=='live-ledger':docs['liveLedger']['connection']={}
            with self.assertRaises((RuntimeError,ValueError)):produce(inputs,transport,reader,epoch_producer=epoch)

    def test_valid_hash_does_not_hide_bad_stage_identity_or_qualification(self):
        for variant in ('image','config','compose','running','collection-qualified','session-alias','runtime-unverified','artifact'):
            inputs,docs,raw,reader,transport,epoch=data_fixture()
            changed='stageInspection';stage=docs['stageInspection']
            if variant=='image':stage['containers'][0]['Image']='sha256:'+'9'*64
            if variant=='config':stage['containers'][0]['Config']['Labels']['com.docker.compose.service']='foreign'
            if variant=='compose':stage['composeSha256']['/etc/candidate.yml']='9'*64
            if variant=='running':stage['containers'][0]['State']['Paused']=False
            if variant=='collection-qualified':
                changed='epochCollection';docs[changed]['qualified']=True
            if variant=='session-alias':
                changed='runtimeSeal';runtime=docs[changed];rp=runtime['runtimePlan']
                rp['diagnosticSessions']['workspacex']['pid']=rp['controlSessions']['workspacex']['pid']
                runtime['runtimePlanSha256']=digest(rp)
                runtime['sessionsSha256']=digest(dict(control=rp['controlSessions'],diagnostic=rp['diagnosticSessions']))
            if variant=='runtime-unverified':transport.verify_runtime_seal=lambda r,b:{}
            if variant=='artifact':raw['/etc/workspacex-cn/artifact.json']=b'tampered'
            ref=inputs['refs'][changed];content=json.dumps(docs[changed],sort_keys=True).encode()
            raw[ref['path']]=content;ref['sha256']=hashlib.sha256(content).hexdigest()
            with self.assertRaises((RuntimeError,ValueError)):produce(inputs,transport,reader,epoch_producer=epoch)

    def test_sanitized_stage_preserves_full_config_hash_without_secret_values(self):
        from candidate_stage_actions import safe_inspection
        inputs,docs,raw,reader,transport,epoch=data_fixture()
        # Real stage module exposes only identity labels and a full-config digest.
        stage=docs['stageInspection']
        for container in stage['containers']:container['HostConfig']=dict(NetworkMode='fixture_default')
        stage['containers']=safe_inspection(stage['containers'])
        content=json.dumps(stage,sort_keys=True).encode();ref=inputs['refs']['stageInspection']
        raw[ref['path']]=content;ref['sha256']=hashlib.sha256(content).hexdigest()
        output=produce(inputs,transport,reader,epoch_producer=epoch)
        self.assertEqual(output['plan']['candidateWriters'][0]['binding']['configSha256'],stage['containers'][0]['configSha256'])

    def test_native_runtime_completion_and_manifest_paths_are_exact(self):
        for name in ('runtimeSeal','completion','epochManifest'):
            inputs,docs,raw,reader,transport,epoch=data_fixture()
            inputs['refs'][name]['path']='/etc/workspacex-cn/foreign/'+name+'.json'
            with self.assertRaisesRegex(RuntimeError,'REFERENCE_PATH'):
                produce(inputs,transport,reader,epoch_producer=epoch)

    def test_epoch_manifest_raw_hash_bridge_rejects_missing_wrong_or_drifted_manifest(self):
        for variant in ('missing','raw-hash','proof-hash','wrong-generation','qualified-flag','drift'):
            inputs,docs,raw,reader,transport,epoch=data_fixture()
            if variant=='missing':del inputs['refs']['epochManifest']
            if variant=='raw-hash':inputs['refs']['epochManifest']['sha256']='9'*64
            if variant=='proof-hash':
                original=transport.verify_current_epoch
                def wrong(refs,b):
                    value=original(refs,b);value['epochManifestSha256']='9'*64;return value
                transport.verify_current_epoch=wrong
            if variant in ('wrong-generation','qualified-flag'):
                manifest=docs['epochManifest']
                if variant=='wrong-generation':manifest['holdGeneration']='9'*32
                else:manifest['qualified']=True
                content=json.dumps(manifest,sort_keys=True).encode();ref=inputs['refs']['epochManifest']
                raw[ref['path']]=content;ref['sha256']=hashlib.sha256(content).hexdigest()
            reads=[0]
            def drift(path,expected):
                value=reader(path,expected)
                if path==inputs['refs'].get('epochManifest',{}).get('path'):
                    reads[0]+=1
                    if variant=='drift' and reads[0]>1:return value+b' '
                return value
            with self.assertRaises((RuntimeError,ValueError)):produce(inputs,transport,drift,epoch_producer=epoch)

    def test_exclusive_private_fsynced_output_without_host_writes(self):
        import os,pathlib,stat,tempfile
        from types import SimpleNamespace
        from unittest.mock import patch
        inputs,docs,raw,reader,transport,epoch=data_fixture()
        output=produce(inputs,transport,reader,epoch_producer=epoch)
        target='/etc/workspacex-cn/maintenance-candidate/'+inputs['identity']['sourceRevision']+'/'+inputs['identity']['attemptId']+'/candidate-plan.json'
        with tempfile.TemporaryDirectory() as td:
            local=pathlib.Path(td)/'candidate-plan.json';real_open=os.open;opens=[]
            def redirected(path,flags,*args):
                opens.append(flags)
                return real_open(str(local) if str(path)==target else td,flags,*args)
            trust=SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=0,st_gid=0)
            with patch('candidate_plan_producer.os.geteuid',return_value=0),patch('candidate_plan_producer.os.open',side_effect=redirected),patch.object(pathlib.Path,'lstat',return_value=trust),patch.object(pathlib.Path,'stat',return_value=trust),patch('candidate_plan_producer.os.fsync',wraps=os.fsync) as sync:
                ref=write_candidate(target,output)
                self.assertEqual(ref['path'],target)
                self.assertEqual(sync.call_count,2)
                self.assertTrue(opens[0]&os.O_EXCL)
                self.assertTrue(opens[0]&os.O_NOFOLLOW)
                with self.assertRaises(FileExistsError):write_candidate(target,output)
            self.assertEqual(stat.S_IMODE(local.stat().st_mode),0o600)
            self.assertEqual(hashlib.sha256(local.read_bytes()).hexdigest(),ref['sha256'])

    def test_stable_refs_and_actual_stage_are_rechecked_before_return(self):
        for variant in ('ref','stage','sessions','completion'):
            inputs,docs,raw,reader,transport,epoch=data_fixture();counts={}
            def changed_reader(path,expected):
                counts[path]=counts.get(path,0)+1
                result=reader(path,expected)
                if variant=='ref' and counts[path]>1:return result+b' '
                return result
            name={'stage':'observe_stage','sessions':'observe_retained_sessions','completion':'observe_completion'}.get(variant)
            if name:
                original=getattr(transport,name);calls=[0]
                def observe(b):
                    calls[0]+=1
                    return original(b) if calls[0]==1 else {}
                setattr(transport,name,observe)
            with self.assertRaisesRegex(RuntimeError,'RACE'):produce(inputs,transport,changed_reader,epoch_producer=epoch)

if __name__=='__main__':unittest.main()
