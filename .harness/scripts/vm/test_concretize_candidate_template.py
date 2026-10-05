import copy,hashlib,json,unittest
from types import SimpleNamespace
from concretize_candidate_template import concretize,concretize_and_write
from candidate_stage_host import candidate_stage_profile_sha256
from test_candidate_plan_producer import data_fixture
from test_candidate_stage_actions import fixture as stage_fixture
from writer_fence import FAMILIES,digest,DATABASES

class ConcretizeTests(unittest.TestCase):
    def fixture(self):
        inputs,docs,_,_,_,_=data_fixture();stage_inputs,manifest,compose,_,_,_,_,actual=stage_fixture()
        for n,c in enumerate(actual):c['Id']=format(n+10,'x')*64
        b={k:inputs[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')}
        blueprint=copy.deepcopy(docs['template'])
        blueprint['candidateWriters']=[dict(key='candidate-'+s,service=s,families=list(FAMILIES) if s=='web' else ['privileged']) for s in compose['services']]
        baseline=copy.deepcopy(docs['stageInspection']['containers'][len(docs['template']['candidateWriters']):])
        s=SimpleNamespace(host=SimpleNamespace(plan=dict(writers=docs['template']['baselineWriters'],
            databaseWriterRoles=docs['template']['fencedRoles'])),compose=compose,inputs=stage_inputs,profile_raw=b'{}')
        refs={k:{'path':'/etc/workspacex-cn/'+k+'.json','sha256':'a'*64} for k in ('blueprintRef','runtimeRef','snapshotRef')}
        profile={'candidateTemplateRecipe':{k:refs[k] for k in ('blueprintRef','runtimeRef')}}
        s.profile_raw=json.dumps(profile).encode()
        snapshot=dict(schemaVersion=1,kind='source-inspected-candidate-stage-snapshot',binding=b,
            sourceProfileSha256=candidate_stage_profile_sha256(profile),composeRef=stage_inputs['compose'],manifestRef=stage_inputs['manifest'],
            containers=actual+baseline,candidateContainerIds=[c['Id'] for c in actual],baselineContainerIds=[c['Id'] for c in baseline])
        payload=dict(**b,kind='source-approved-candidate-blueprint',plan=blueprint)
        data={refs['blueprintRef']['path']:payload,refs['snapshotRef']['path']:snapshot}
        s.require_lock=lambda:None;s._recheck=lambda:None
        s._profile=lambda:(s.profile_raw,profile,{})
        s._read_ref=lambda r:json.dumps(data[r['path']],sort_keys=True).encode()
        s.verify_runtime_seal=lambda r,b:copy.deepcopy(docs['runtimeSeal'])
        s.inspect_stage=lambda p:copy.deepcopy(actual);s.observe_baseline=lambda:dict(containers=copy.deepcopy(baseline))
        s.verify_stage_configuration=lambda service,cfg,c:True
        return b,s,refs['snapshotRef'],data,actual,payload
    def test_actual_stage_ids_are_concretized_and_existing_schema_validates(self):
        b,s,ref,data,actual,payload=self.fixture();result=concretize(b,s,ref)
        self.assertEqual([w['binding']['containerId'] for w in result['candidateWriters']],[c['Id'] for c in actual])
        self.assertEqual(result['candidateWriters'][0]['binding']['configSha256'],digest(actual[0]['Config']))
        self.assertEqual(result['baselineWriters'],s.host.plan['writers'])
        self.assertIn('service',payload['plan']['candidateWriters'][0])
    def test_caller_plan_flags_or_actual_evidence_drift_cannot_concretize(self):
        for case in ('extra-caller-binding','caller-verified','missing-service','snapshot-id','baseline','roles','config','actual-running','source-recipe'):
            b,s,ref,data,actual,payload=self.fixture()
            if case=='extra-caller-binding':payload['plan']['candidateWriters'][0]['binding']={'containerId':'0'*64}
            if case=='caller-verified':data[ref['path']]['verified']=True
            if case=='missing-service':payload['plan']['candidateWriters'].pop()
            if case=='snapshot-id':data[ref['path']]['candidateContainerIds'][0]='0'*64
            if case=='baseline':payload['plan']['baselineWriters'][0]['binding']['containerId']='0'*64
            if case=='roles':payload['plan']['fencedRoles'][DATABASES[0]].append('unapproved')
            if case=='config':s.verify_stage_configuration=lambda *a:(_ for _ in ()).throw(RuntimeError('FULL_CONFIG'))
            if case=='actual-running':actual[0]['State']['Running']=True
            if case=='source-recipe':s._profile=lambda:(b'',{}, {})
            with self.assertRaises(RuntimeError,msg=case):concretize(b,s,ref)
    def test_actual_snapshot_late_race_rejects(self):
        b,s,ref,data,actual,payload=self.fixture();original=s.inspect_stage;count=[0]
        def inspect(p):
            count[0]+=1;out=original(p)
            if count[0]>1:out[0]['Id']='0'*64
            return out
        s.inspect_stage=inspect
        with self.assertRaisesRegex(RuntimeError,'LATE_RACE'):concretize(b,s,ref)

    def test_manifest_epoch_requires_source_qualification_and_keeps_semantic_blueprint(self):
        b,s,ref,data,actual,payload=self.fixture();stage=dict(b,epoch='f'*64)
        data[ref['path']]['binding']=stage;calls=[]
        s.verify_snapshot_binding=lambda semantic,snapshot:(calls.append((semantic,snapshot)) or True)
        result=concretize(b,s,ref,stage_binding=stage)
        self.assertEqual(calls,[(b,stage)]);self.assertEqual(result['epoch'],payload['plan']['epoch'])
        s.verify_snapshot_binding=lambda *args:False
        with self.assertRaisesRegex(RuntimeError,'UNQUALIFIED_STAGE_BINDING'):concretize(b,s,ref,stage_binding=stage)
        for field in ('identity','host','toolRevision','holdGeneration'):
            bad=copy.deepcopy(stage);bad[field]={} if type(stage[field]) is dict else '0'*64
            with self.assertRaisesRegex(RuntimeError,'STAGE_BINDING_SCHEMA'):concretize(b,s,ref,stage_binding=bad)

    def test_real_publication_returns_written_bytes_hash_and_retries_identically(self):
        import os,pathlib,stat,tempfile
        from unittest.mock import patch
        b,s,ref,data,actual,payload=self.fixture();stage=dict(b,epoch='f'*64)
        data[ref['path']]['binding']=stage;checks=[]
        s.verify_snapshot_binding=lambda semantic,snapshot:(checks.append((semantic,snapshot)) or True)
        real_path=type(pathlib.Path());real_stat=real_path.stat;real_lstat=real_path.lstat
        with tempfile.TemporaryDirectory(prefix='candidate-template-test-') as root:
            target=real_path(root)/'candidate'/b['identity']['sourceRevision']/b['identity']['attemptId'];target.mkdir(parents=True,mode=0o700)
            def mapped_path(value):
                return real_path(root)/'candidate' if value=='/etc/workspacex-cn/maintenance-candidate' else real_path(value)
            def trusted_stat(path,*args,**kwargs):
                value=real_stat(path,*args,**kwargs);items=list(value)
                if path==target or path in target.parents:items[0]=stat.S_IFDIR|(0o700 if path==target else 0o755)
                items[4]=items[5]=0
                return os.stat_result(items)
            def trusted_lstat(path,*args,**kwargs):
                value=real_lstat(path,*args,**kwargs);items=list(value)
                if path==target or path in target.parents:items[0]=stat.S_IFDIR|(0o700 if path==target else 0o755)
                items[4]=items[5]=0
                return os.stat_result(items)
            # Trust metadata is a fixture; file creation, writes, fsync and digest
            # execute the actual publisher on a disposable private directory.
            with patch('pathlib.Path',mapped_path),patch.object(real_path,'stat',trusted_stat),patch.object(real_path,'lstat',trusted_lstat),patch('os.geteuid',return_value=0),patch('os.getegid',return_value=0),patch('host_transport.private',lambda path:real_path(path).read_bytes()):
                first=concretize_and_write(b,s,ref,stage_binding=stage)
                written=real_path(first['path']).read_bytes()
                self.assertEqual(first['sha256'],hashlib.sha256(written).hexdigest())
                self.assertEqual(json.loads(written)['candidateWriters'][0]['binding']['containerId'],actual[0]['Id'])
                self.assertEqual(concretize_and_write(b,s,ref,stage_binding=stage),first)
                self.assertEqual(len(checks),4)
                real_path(first['path']).write_bytes(b'{}')
                with self.assertRaisesRegex(RuntimeError,'RETRY_CONFLICT'):concretize_and_write(b,s,ref,stage_binding=stage)
