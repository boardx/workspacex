import copy
import hashlib
import json
import unittest
from candidate_stage_actions import prepare,held_readback,start_paused,SERVICES,PROBES,DOCKER_PREFIX
from test_candidate_plan_producer import data_fixture
from writer_fence import DATABASES


def fixture():
    previous,docs,raw,reader,transport,epoch=data_fixture()
    b={k:previous[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')}
    manifest=dict(schemaVersion=1,sourceRevision=b['identity']['sourceRevision'],release='2026.10.3-cn.1',platform='linux/amd64',
        images={s:dict(image='registry.example.cn/wsx/'+s+'@sha256:'+str(n)*64) for n,s in enumerate(('web','api','agent','sandbox','postgres','redis'),1)})
    compose=dict(name='wsx_candidate_one',services={},networks={'default':{'external':True,'name':'wsx_candidate_one-runtime'}})
    imageids={};inspection=[]
    for n,s in enumerate(SERVICES,1):
        key='sandbox' if s=='sandbox-sessions' else s;image=manifest['images'][key]['image']
        cfg=dict(image=image,pull_policy='never',platform='linux/amd64')
        if s in ('sandbox','sandbox-sessions'):cfg.update(network_mode='none',read_only=True)
        if s in ('web','api'):cfg['ports']=['127.0.0.1:'+('3000:3000' if s=='web' else '3200:3200')]
        if s=='api':cfg['environment']=dict(KERNEL_DEEP_AGENT_BASE_URL='http://agent:8000')
        compose['services'][s]=cfg;imageids[image]='sha256:'+str(n if s!='sandbox-sessions' else 4)*64
        inspection.append(dict(Id=str(n)*64,Image=imageids[image],Config=dict(Labels={
            'com.docker.compose.project':compose['name'],'com.docker.compose.service':s,
            'com.docker.compose.project.config_files':'/etc/workspacex-cn/candidate-compose.json'}),
            State=dict(Running=False,Paused=False),HostConfig=dict(NetworkMode='none' if s in ('sandbox','sandbox-sessions') else compose['name']+'-runtime')))
    inputs=dict(**b)
    for name,value in (('manifest',manifest),('compose',compose)):
        path='/etc/workspacex-cn/'+('candidate-compose' if name=='compose' else name)+'.json'
        content=json.dumps(value,sort_keys=True).encode();raw[path]=content;inputs[name]=dict(path=path,sha256=hashlib.sha256(content).hexdigest())
    calls=[]
    class Source:
        def require_lock(self):calls.append('lock')
        def observe_hold(self):return dict(schemaVersion=1,state='held',identity=b['identity'],host=b['host'],generation=b['holdGeneration'])
        def observe_admission(self):return {db:dict(app=False,lane=False,migration_admin=False) for db in DATABASES}
        def observe_baseline(self):return dict(projectName='wsx_baseline',containers=[dict(Id='9'*64,State=dict(Running=True,Paused=True))])
        def verify_frozen_compose(self,i,m):return copy.deepcopy(compose)
        def run_docker(self,args):
            calls.append(args)
            if args[len(DOCKER_PREFIX):len(DOCKER_PREFIX)+2]==['image','inspect']:
                image=args[-1];return [dict(Id=imageids[image],RepoDigests=[image],Architecture='amd64',Os='linux',Config=dict(Labels={'org.opencontainers.image.revision':b['identity']['sourceRevision']}))]
            if args[len(DOCKER_PREFIX):len(DOCKER_PREFIX)+2]==['network','inspect']:
                return [dict(Name=compose['name']+'-runtime',Driver='bridge',Internal=False,Labels={'com.docker.compose.project':compose['name']})]
            if 'create' in args:return None
            raise RuntimeError('UNEXPECTED_COMMAND')
        def inspect_stage(self,project):return copy.deepcopy(inspection)
        def verify_stage_configuration(self,s,cfg,c):return True
        def record_stage_intent(self,b,refs):calls.append('intent')
        def retained_diagnostic_binding(self,db):
            value=copy.deepcopy(docs['runtimeSeal']['runtimePlan']['diagnosticSessions'][db]);value['peer']['database']=db
            return value
        def retained_query(self,db,probe,params):
            assert params==dict(expectedReadbackSha256=self.expected_ref['sha256'])
            calls.append((db,probe));return dict(identity=b['identity'],connection=self.retained_diagnostic_binding(db),probe=probe,
                readOnlyTransaction=True,rollbackComplete=True,verified=True,evidenceSha256='a'*64)
    source=Source()
    expected=dict(**b,kind='source-derived-held-candidate-readback',qualificationEvidenceSha256='f'*64,
        targets={db:[dict(targetId='source-verified-target',keyValues=dict(scope='fixture'),expectedCount=1,expectedDigest='a'*64)] for db in DATABASES})
    path='/etc/workspacex-cn/maintenance-readback/'+b['identity']['sourceRevision']+'/'+b['identity']['attemptId']+'/expected.json'
    content=json.dumps(expected,sort_keys=True).encode();raw[path]=content
    source.expected_ref=dict(path=path,sha256=hashlib.sha256(content).hexdigest())
    source.verify_expected_readback=lambda ref,b:copy.deepcopy(expected)
    return inputs,manifest,compose,raw,reader,source,calls,inspection


class Tests(unittest.TestCase):
    def test_offline_create_only_keeps_frozen_bridge_loopback_dns_and_sandbox_none(self):
        i,m,c,r,reader,s,calls,inspect=fixture()
        inspect[0]['Config']['Env']=['TOKEN=fixture-sensitive-marker']
        out=prepare(i,s,reader,expected_identity=fixture()[0]['identity'])
        self.assertNotIn('fixture-sensitive-marker',json.dumps(out))
        self.assertEqual(out['containers'][0]['configSha256'],hashlib.sha256(json.dumps(inspect[0]['Config'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
        self.assertEqual(out['kind'],'candidate-staged-container-inspection')
        commands=[call for call in calls if isinstance(call,list)]
        self.assertEqual(sum('create' in cmd for cmd in commands),1)
        cmd=next(cmd for cmd in commands if 'create' in cmd)
        self.assertIn('--no-build',cmd);self.assertIn('--no-deps',cmd)
        self.assertEqual(cmd[-5:],list(SERVICES))
        self.assertLess(calls.index('intent'),calls.index(cmd))
        self.assertFalse(any(any(word in cmd for word in ('start','up','pull','build','unpause','restart','rm')) for cmd in commands))
        self.assertTrue(all(x['State']['Running'] is False for x in out['containers']))

    def test_topology_and_project_changes_fail_before_create(self):
        for variant in ('network','port','dns','sandbox','project','build','image','source-compose'):
            i,m,c,r,reader,s,calls,inspect=fixture()
            if variant=='network':c['services']['api']['network_mode']='host'
            if variant=='port':c['services']['api']['ports']=['0.0.0.0:3200:3200']
            if variant=='dns':c['services']['api']['environment']['KERNEL_DEEP_AGENT_BASE_URL']='http://127.0.0.1:8000'
            if variant=='sandbox':c['services']['sandbox']['network_mode']='host'
            if variant=='project':c['name']='wsx_baseline'
            if variant=='build':c['services']['api']['build']='.'
            if variant=='image':c['services']['api']['image']='mutable:latest'
            if variant=='source-compose':s.verify_frozen_compose=lambda i,m:{}
            raw=json.dumps(c,sort_keys=True).encode();r[i['compose']['path']]=raw;i['compose']['sha256']=hashlib.sha256(raw).hexdigest()
            with self.assertRaises(RuntimeError):prepare(i,s,reader,expected_identity=fixture()[0]['identity'])
            self.assertFalse(any(isinstance(call,list) and 'create' in call for call in calls))

    def test_stage_actual_inspection_admission_baseline_and_late_races_reject(self):
        for variant in ('running','network','image','full-config','baseline','open-role','late-inspect','lost-response','network-driver'):
            i,m,c,r,reader,s,calls,inspect=fixture()
            if variant=='running':inspect[0]['State']['Running']=True
            if variant=='network':inspect[0]['HostConfig']['NetworkMode']='host'
            if variant=='image':inspect[0]['Image']='sha256:'+'9'*64
            if variant=='full-config':s.verify_stage_configuration=lambda a,b,c:False
            if variant=='baseline':
                original=s.observe_baseline;count=[0]
                def baseline():
                    count[0]+=1;v=original()
                    if count[0]>1:v['containers'][0]['Id']='8'*64
                    return v
                s.observe_baseline=baseline
            if variant=='open-role':s.observe_admission=lambda:{db:dict(app=True) for db in DATABASES}
            if variant=='late-inspect':
                original=s.inspect_stage;count=[0]
                def actual(project):
                    count[0]+=1;v=original(project)
                    if count[0]>1:v[0]['Id']='8'*64
                    return v
                s.inspect_stage=actual
            if variant=='network-driver':
                original=s.run_docker
                def run(args):
                    value=original(args)
                    if args[len(DOCKER_PREFIX):len(DOCKER_PREFIX)+2]==['network','inspect']:value[0]['Driver']='overlay'
                    return value
                s.run_docker=run
            if variant=='lost-response':
                original=s.run_docker
                def run(args):
                    if 'create' in args:raise RuntimeError('COMMAND_OUTCOME_UNKNOWN')
                    return original(args)
                s.run_docker=run
            with self.assertRaises(RuntimeError):prepare(i,s,reader,expected_identity=fixture()[0]['identity'])

    def test_missing_atomic_start_transport_never_runs_standard_start_then_pause(self):
        i,m,c,r,reader,s,calls,inspect=fixture()
        with self.assertRaisesRegex(RuntimeError,'SOURCE_TRANSPORT_REQUIRED'):prepare(i,None,reader,expected_identity=fixture()[0]['identity'])
        with self.assertRaisesRegex(RuntimeError,'ATOMIC_START_PAUSED'):start_paused(i,s)
        self.assertEqual(calls,[])

    def test_seed_expected_artifact_cannot_default_empty_or_caller_qualify(self):
        for variant in ('empty-targets','qualified-flag','missing-digest','unverified-source','unknown-param'):
            i,m,c,r,reader,s,calls,inspect=fixture()
            expected=json.loads(r[s.expected_ref['path']])
            if variant=='empty-targets':expected['targets']['workspacex_agent']=[]
            if variant=='qualified-flag':expected['qualified']=True
            if variant=='missing-digest':del expected['targets']['workspacex_memory'][0]['expectedDigest']
            if variant=='unverified-source':s.verify_expected_readback=lambda r,b:{}
            if variant=='unknown-param':expected['targets']['workspacex'][0]['sql']='SELECT arbitrary'
            content=json.dumps(expected,sort_keys=True).encode();r[s.expected_ref['path']]=content;s.expected_ref['sha256']=hashlib.sha256(content).hexdigest()
            source_result=copy.deepcopy(expected)
            if variant!='unverified-source':s.verify_expected_readback=lambda ref,b:copy.deepcopy(source_result)
            request={**{k:i[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')},'expectedReadbackRef':s.expected_ref}
            with self.assertRaises(RuntimeError):held_readback(request,s,reader,expected_identity=fixture()[0]['identity'])
            self.assertFalse(any(isinstance(call,tuple) for call in calls))

    def test_three_source_seed_keys_share_fixed_target_id_and_duplicate_keys_reject(self):
        for duplicate in (False,True):
            i,m,c,r,reader,s,calls,inspect=fixture();expected=json.loads(r[s.expected_ref['path']])
            expected['targets']['workspacex']=[dict(targetId='api-system-agent',keyValues=dict(orgId='source-org',stableName='seed-'+str(n),provider='provider-'+str(n)),expectedCount=1,expectedDigest='a'*64) for n in range(3)]
            if duplicate:expected['targets']['workspacex'].append(copy.deepcopy(expected['targets']['workspacex'][0]))
            content=json.dumps(expected,sort_keys=True).encode();r[s.expected_ref['path']]=content;s.expected_ref['sha256']=hashlib.sha256(content).hexdigest()
            s.verify_expected_readback=lambda ref,b:copy.deepcopy(expected)
            request={**{k:i[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')},'expectedReadbackRef':s.expected_ref}
            if duplicate:
                with self.assertRaisesRegex(RuntimeError,'TARGET_DUPLICATE'):held_readback(request,s,reader,expected_identity=fixture()[0]['identity'])
            else:self.assertFalse(held_readback(request,s,reader,expected_identity=fixture()[0]['identity'])['ready'])

    def test_retained_three_db_nine_probes_all_rollback_and_no_legacy_bootstrap(self):
        i,m,c,r,reader,s,calls,inspect=fixture();out=held_readback({**{k:i[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')},'expectedReadbackRef':s.expected_ref},s,reader,expected_identity=fixture()[0]['identity'])
        self.assertFalse(out['ready'])
        self.assertEqual([call for call in calls if isinstance(call,tuple)],[(db,p) for db in DATABASES for p in PROBES])
        for field in ('verified','readOnlyTransaction','rollbackComplete','connection','probe','identity','evidenceSha256'):
            i,m,c,r,reader,s,calls,inspect=fixture();original=s.retained_query
            def bad(db,p,params):
                value=original(db,p,params);value[field]=False
                return value
            s.retained_query=bad
            with self.assertRaises(RuntimeError):held_readback({**{k:i[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')},'expectedReadbackRef':s.expected_ref},s,reader,expected_identity=fixture()[0]['identity'])

if __name__=='__main__':unittest.main()
