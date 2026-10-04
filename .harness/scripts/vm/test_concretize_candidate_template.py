import copy,hashlib,json,unittest
from types import SimpleNamespace
from concretize_candidate_template import concretize
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
            databaseWriterRoles=docs['template']['fencedRoles'])),compose=compose,inputs=stage_inputs,profile_raw=b'root-profile')
        refs={k:{'path':'/etc/workspacex-cn/'+k+'.json','sha256':'a'*64} for k in ('blueprintRef','runtimeRef','snapshotRef')}
        snapshot=dict(schemaVersion=1,kind='source-inspected-candidate-stage-snapshot',binding=b,
            sourceProfileSha256=hashlib.sha256(s.profile_raw).hexdigest(),composeRef=stage_inputs['compose'],manifestRef=stage_inputs['manifest'],
            containers=actual+baseline,candidateContainerIds=[c['Id'] for c in actual],baselineContainerIds=[c['Id'] for c in baseline])
        payload=dict(**b,kind='source-approved-candidate-blueprint',plan=blueprint)
        data={refs['blueprintRef']['path']:payload,refs['snapshotRef']['path']:snapshot}
        s.require_lock=lambda:None;s._recheck=lambda:None
        s._profile=lambda:(s.profile_raw,{'candidateTemplateRecipe':{k:refs[k] for k in ('blueprintRef','runtimeRef')}},{})
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
