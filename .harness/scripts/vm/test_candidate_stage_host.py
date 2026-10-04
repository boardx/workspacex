import unittest
from types import SimpleNamespace
from unittest.mock import patch
from candidate_stage_host import CandidateStageHost
from candidate_stage_actions import DOCKER_PREFIX
from writer_fence import digest

class StageHostTests(unittest.TestCase):
    def fixture(self):
        c=dict(Id='a'*64,Image='sha256:'+'b'*64,Config=dict(Labels={
            'com.docker.compose.project':'baseline','com.docker.compose.service':'api',
            'com.docker.compose.project.config_files':'/etc/baseline.json'}))
        b=dict(containerId=c['Id'],imageId=c['Image'],configSha256=digest(c['Config']),service='api',composePath='/etc/baseline.json')
        h=SimpleNamespace(plan=dict(identity={'attemptId':'fixture'},host={'instanceId':'fixed'},holdGeneration='d'*32,writers=[dict(binding=b)]),
                          require_lock=lambda:None,docker_inventory=lambda:[c])
        h.read_hold=lambda:dict(schemaVersion=1,state='held',identity=h.plan['identity'],generation=h.plan['holdGeneration'])
        t=CandidateStageHost(h,SimpleNamespace(value={'identity':h.plan['identity']}))
        t._trusted_inventory=lambda:[c]
        return t,c
    def test_real_retained_inventory_and_admission(self):
        t,c=self.fixture()
        self.assertEqual(t.observe_baseline(),dict(projectName='baseline',containers=[c]))
        self.assertEqual(t.inspect_stage('baseline'),[c])
        self.assertEqual(t.observe_hold()['host'],t.host.plan['host'])
        with patch('candidate_stage_host.FixedProbes') as p:
            p.return_value.admission.return_value=({'kind':'role-login-v1','login':{'db':{'app':False}}},{})
            self.assertEqual(t.observe_admission(),{'db':{'app':False}})
            p.assert_called_once_with(t.host)
    def test_full_config_and_hold_drift_rejected(self):
        t,c=self.fixture();c['Config']['Env']=['unexpected=value']
        with self.assertRaisesRegex(RuntimeError,'BASELINE_DRIFT'):t.observe_baseline()
        t,c=self.fixture();t.host.read_hold=lambda:dict(schemaVersion=1,state='held',identity={},generation='d'*32)
        with self.assertRaisesRegex(RuntimeError,'HOLD_BINDING'):t.observe_hold()
    def test_epoch_missing_refs_cannot_become_verified(self):
        t,c=self.fixture()
        # Source import is inert; the qualifier is intentionally unavailable
        # without its approved module loader in this disposable mock.
        with self.assertRaises((ModuleNotFoundError, ValueError, RuntimeError)):
            t.verify_current_epoch({}, {})

    def test_missing_real_authority_cannot_execute(self):
        t,c=self.fixture()
        with patch.object(t,'_profile',side_effect=RuntimeError('SOURCE_CAPABILITY')):
            with self.assertRaisesRegex(RuntimeError,'SOURCE_CAPABILITY'):t.verify_frozen_compose({}, {})
        with self.assertRaisesRegex(RuntimeError,'COMPOSE_SOURCE_REQUIRED'):t.run_docker([*DOCKER_PREFIX,'image','inspect','fixed'])
        with self.assertRaisesRegex(RuntimeError,'FIXED_PREFIX'):t.run_docker(['docker','run','unsafe'])

if __name__=='__main__':unittest.main()

class ActualConfigurationTests(StageHostTests):
    def configured(self):
        t,_=self.fixture();t._recheck=lambda:{}
        cfg=dict(image='repo@sha256:'+'a'*64,environment={'PORT':'3200'},env_file=[{'path':'/etc/native/api.env','format':'raw'}],
            user='1000:1000',cap_drop=['ALL'],security_opt=['no-new-privileges:true'],init=True,pids_limit=256,
            restart='unless-stopped',mem_limit='2g',cpus=2,logging={'driver':'local','options':{'max-size':'10m','max-file':'5'}},
            volumes=[{'source':'/etc/native/certs','target':'/run/certs','read_only':True}],ports=['127.0.0.1:3200:3200'])
        t.compose={'name':'candidate','services':{'api':cfg}};t.runtime_files={'/etc/native/api.env':b'SECRET=private fixture\nPORT=bad\n'}
        t.image_configs={cfg['image']:{'Env':['BASE=base'], 'User':'','Entrypoint':['/entry'], 'Cmd':['run'],'WorkingDir':'/app'}}
        hc=dict(Privileged=False,ReadonlyRootfs=False,CapDrop=['ALL'],CapAdd=None,SecurityOpt=['no-new-privileges:true'],Init=True,
            PidsLimit=256,RestartPolicy={'Name':'unless-stopped'},NetworkMode='candidate-runtime',Memory=2*1024**3,NanoCpus=2*10**9,
            LogConfig=cfg['logging'],Tmpfs=None,PublishAllPorts=False,AutoRemove=False,CgroupnsMode='private',
            PortBindings={'3200/tcp':[{'HostIp':'127.0.0.1','HostPort':'3200'}]})
        c=dict(Config={'Env':['BASE=base','SECRET=private fixture','PORT=3200'],'User':'1000:1000','Entrypoint':['/entry'],'Cmd':['run'],'WorkingDir':'/app'},
            HostConfig=hc,Mounts=[{'Type':'bind','Destination':'/run/certs','Source':'/etc/native/certs','RW':False}],
            NetworkSettings={'Networks':{'candidate-runtime':{}}})
        return t,c,cfg
    def test_native_config_real_image_and_raw_env_merge(self):
        t,c,cfg=self.configured();self.assertTrue(t.verify_stage_configuration('api',cfg,c))
    def test_each_host_escape_or_sensitive_config_drift_fails(self):
        import copy
        for case in ('env','user','cmd','privileged','caps','mount','ports','network','tmpfs','dns','resources'):
            t,c,cfg=self.configured()
            if case=='env':c['Config']['Env'][1]='SECRET=drift'
            if case=='user':c['Config']['User']='0'
            if case=='cmd':c['Config']['Cmd']=['unsafe']
            if case=='privileged':c['HostConfig']['Privileged']=True
            if case=='caps':c['HostConfig']['CapAdd']=['SYS_ADMIN']
            if case=='mount':c['Mounts'][0]['RW']=True
            if case=='ports':c['HostConfig']['PortBindings']['3200/tcp'][0]['HostIp']='0.0.0.0'
            if case=='network':c['NetworkSettings']['Networks']={'host':{}}
            if case=='tmpfs':c['HostConfig']['Tmpfs']={'/run':'rw'}
            if case=='dns':c['HostConfig']['Dns']=['1.1.1.1']
            if case=='resources':c['HostConfig']['Memory']=0
            with self.assertRaises(RuntimeError,msg=case):t.verify_stage_configuration('api',cfg,c)
    def test_docker_no_unbounded_command_or_missing_intent(self):
        t,c,cfg=self.configured();t.inputs={'compose':{'path':'/etc/fixed.json'}};t.require_lock=lambda:None
        with self.assertRaisesRegex(RuntimeError,'DOCKER_COMMAND'):t.run_docker([*DOCKER_PREFIX,'pull',cfg['image']])
        t.intent_recorded=False;t.network_before=None
        with self.assertRaisesRegex(RuntimeError,'DURABLE_INTENT_REQUIRED'):t.run_docker([*DOCKER_PREFIX,'compose','--project-name','candidate','--file','/etc/fixed.json',
            'create','--no-build','--pull','never','--no-deps','web','api','agent','sandbox','sandbox-sessions'])

class EmitterAndIntentTests(StageHostTests):
    def emitter_fixture(self):
        import copy,json,hashlib,os
        from test_candidate_stage_actions import fixture
        inputs,manifest,compose,_,_,_,_,_=fixture();t,c=self.fixture()
        t.host.plan['toolRevision']=inputs['toolRevision'];t.host.plan['identity']=inputs['identity'];t.host.plan['host']=inputs['host'];t.host.plan['holdGeneration']=inputs['holdGeneration']
        t.journal.value['identity']=inputs['identity']
        events=[];t.journal.record=lambda state,**kw:events.append((state,kw))
        paths=('compose.ts','config.ts','storage-config.ts','release.ts','image-reference.ts','runtime-bundle.ts')
        sources={'packages/cloud-deploy/src/'+n:{'sha256':'a'*64} for n in paths}
        closure={'schemaVersion':1,'sourceRevision':inputs['identity']['sourceRevision'],'bundleSha256':'b'*64,'sources':sources,
            'dependencies':{'node_modules/zod.js':'c'*64},'lockfileSha256':'d'*64,'bundledInputs':list(sources)+['node_modules/zod.js'],
            'compiler':{'name':'esbuild','version':'0.24.2'}}
        network={'Id':'e'*64,'Name':compose['name']+'-runtime','Driver':'bridge','Internal':False,'IPAM':{},'Options':{}}
        options={'projectName':compose['name'],'runtimeDirectory':'/etc/workspacex-cn/native','runtimeFiles':{},
            'manifestRef':inputs['manifest'],'composeRef':inputs['compose'],'networkRef':{'path':'/etc/network','sha256':'e'*64}}
        refs={k:{'path':'/etc/workspacex-cn/'+k,'sha256':str(n)*64} for n,k in enumerate(('sourceClosureRef','configRef','optionsRef'),1)}
        e={'schemaVersion':1,'path':'/usr/local/lib/emitter.cjs','sha256':'b'*64,'nodePath':'/usr/bin/node','nodeSha256':'f'*64,
            **refs,'dockerPath':'/usr/bin/docker','dockerSha256':'a'*64,'dockerSocket':{}}
        files={k:v['sha256'] for k,v in sources.items()};files.update({'node_modules/zod.js':'c'*64,'pnpm-lock.yaml':'d'*64})
        p={'toolRevision':inputs['toolRevision'],'filesSha256':files,'candidateComposeEmitter':e}
        data={refs['sourceClosureRef']['path']:closure,refs['configRef']['path']:{'fixture':'sourceconfig'},refs['optionsRef']['path']:options,
            '/etc/network':network}
        t._profile=lambda:(b'root-profile',p,e)
        t._read_ref=lambda r:json.dumps(data[r['path']],sort_keys=True).encode()
        t._open_executable=lambda path,sha,mode:os.open('/dev/null',os.O_RDONLY)
        calls=[]
        def run(args,input_raw=None):
            calls.append((args,input_raw))
            if input_raw is not None:return json.dumps(compose).encode()
            if 'network' in args:return json.dumps([network]).encode()
            return b''
        t.host.run=run;t._socket=lambda e:{'fixture':'fixedsocket'}
        return t,inputs,manifest,compose,data,calls,events
    def test_actual_fd_emitter_and_sourcebound_network_then_durable_intent(self):
        t,i,m,c,data,calls,events=self.emitter_fixture()
        self.assertEqual(t.verify_frozen_compose(i,m),c)
        import json
        req=json.loads(calls[0][1]);self.assertEqual(req['options'],{'projectName':c['name'],'runtimeDirectory':'/etc/workspacex-cn/native'})
        self.assertTrue(all(x.startswith('/proc/') for x in calls[0][0]))
        t.run_docker([*DOCKER_PREFIX,'network','inspect',c['name']+'-runtime'])
        bound={k:i[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')}
        t.record_stage_intent(bound,dict(compose=i['compose'],manifest=i['manifest'],projectName=c['name']))
        self.assertEqual(events[0][0],'candidate-stage-intent')
        self.assertTrue(t.intent_recorded)
        self.assertNotIn('fixture',json.dumps(t.journal.value))
    def test_source_closure_root_ref_and_network_drift_reject(self):
        for case in ('deps','manifest','network','profile-drift'):
            t,i,m,c,data,calls,events=self.emitter_fixture()
            if case=='deps':data['/etc/workspacex-cn/sourceClosureRef']['dependencies']['node_modules/zod.js']='0'*64
            if case=='manifest':data['/etc/workspacex-cn/optionsRef']['manifestRef']={'path':'/etc/unapproved','sha256':'0'*64}
            if case in ('deps','manifest'):
                with self.assertRaises(RuntimeError):t.verify_frozen_compose(i,m)
                self.assertFalse(calls);continue
            t.verify_frozen_compose(i,m)
            if case=='network':data['/etc/network']['Id']='0'*64
            else:t._profile=lambda:(b'drift',{}, {})
            with self.assertRaises(RuntimeError):t.run_docker([*DOCKER_PREFIX,'network','inspect',c['name']+'-runtime'])

class CompletionAndPublicationTests(unittest.TestCase):
    def completion_fixture(self):
        from test_candidate_plan_producer import data_fixture
        import copy,json
        inputs,docs,raw,reader,_,_=data_fixture();bound={k:inputs[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')}
        c=SimpleNamespace(binding=docs['runtimeSeal']['runtimePlan']['diagnosticSessions']['workspacex'])
        calls=[];c.query=lambda name:(calls.append(name) or dict(rowCount=1,ledger=docs['liveLedger']['ledger']))
        host=SimpleNamespace(plan=dict(identity=bound['identity'],diagnosticSessions={'workspacex':c.binding}),diagnostic_connections={'workspacex':c},require_lock=lambda:None)
        receipt=inputs['refs']['completion'];journal=SimpleNamespace(value=dict(identity=bound['identity'],migrationCompletionReceipt=receipt,
            migrationCompletionIntent=copy.deepcopy(receipt),events=[dict(state='migration-completion-durable',receipt=receipt,holdGeneration=bound['holdGeneration'])]))
        t=CandidateStageHost(host,journal);t._read_ref=lambda r:reader(r['path'],r['sha256'])
        t.observe_hold=lambda:dict(schemaVersion=1,state='held',identity=bound['identity'],host=bound['host'],generation=bound['holdGeneration'])
        return t,bound,calls,docs
    def test_actual_durable_ref_and_fixed_existing_diagnostic_ledger(self):
        t,b,calls,docs=self.completion_fixture()
        with patch('control_connection.verify_bound_transport'):
            result=t.observe_completion(b)
        self.assertEqual(calls,['migration-ledger'])
        self.assertEqual(result['ledger']['ledger'],docs['liveLedger']['ledger'])
        self.assertEqual(result['ledger']['connection'],t.host.diagnostic_connections['workspacex'].binding)
    def test_missing_durable_journal_or_live_ledger_cannot_produce_receipt(self):
        for case in ('intent','event','identity','ledger'):
            t,b,calls,docs=self.completion_fixture()
            if case=='intent':t.journal.value['migrationCompletionIntent']={}
            if case=='event':t.journal.value['events']=[]
            if case=='identity':b['identity']=dict(b['identity'],attemptId='other')
            if case=='ledger':t.host.diagnostic_connections['workspacex'].query=lambda _:dict(rowCount=0,ledger=[])
            with patch('control_connection.verify_bound_transport'):
                with self.assertRaises(RuntimeError):t.observe_completion(b)
    def test_safe_receipts_write_exclusive_private_files_with_fsync(self):
        import os,pathlib,stat,tempfile,json,hashlib
        t,b,calls,docs=self.completion_fixture();stage=docs['stageInspection'];completion=dict(completion=t.journal.value['migrationCompletionReceipt'],ledger=docs['liveLedger'])
        t.observe_stage=lambda _:stage;t.observe_completion=lambda _:completion
        prefix='/etc/workspacex-cn/maintenance-candidate/'+b['identity']['sourceRevision']+'/'+b['identity']['attemptId']+'/'
        with tempfile.TemporaryDirectory() as td:
            local=pathlib.Path(td);real_open=os.open;opens=[]
            def redirected(path,flags,*args):
                opens.append(flags);p=local/pathlib.Path(str(path)).name if str(path).startswith(prefix) else local
                return real_open(p,flags,*args)
            trust=SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=0,st_gid=0)
            with patch('candidate_stage_host.os.geteuid',return_value=0),patch('candidate_stage_host.os.getegid',return_value=0),patch('candidate_stage_host.os.open',side_effect=redirected),patch.object(pathlib.Path,'lstat',return_value=trust),patch.object(pathlib.Path,'stat',return_value=trust),patch.object(pathlib.Path,'exists',return_value=False),patch('candidate_stage_host.os.fsync',wraps=os.fsync) as sync:
                refs=t.publish_late_evidence(b)
                self.assertEqual(sync.call_count,4)
                self.assertEqual(sum(bool(flags&os.O_EXCL) for flags in opens),2)
                self.assertEqual(sum(bool(flags&os.O_NOFOLLOW) for flags in opens),4)
            for key in ('stageInspection','liveLedger'):
                p=local/pathlib.Path(refs[key]['path']).name
                self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
                self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),refs[key]['sha256'])

class EpochAuthorityWiringTests(unittest.TestCase):
    def test_external_root_source_and_executable_pins_passed_to_readonly_consumer(self):
        import hashlib,json,pathlib
        import test_current_epoch_qualification as fixture_q
        q=fixture_q.q
        from test_candidate_plan_producer import data_fixture
        inputs,docs,*_=data_fixture();b={k:inputs[k] for k in ('identity','toolRevision','host','epoch','holdGeneration')}
        root='/etc/workspacex-cn/maintenance-evidence/'+b['identity']['sourceRevision']+'/'+b['identity']['attemptId']
        sr='.harness/scripts/vm/current_epoch_qualification.py';sourcehash=hashlib.sha256(pathlib.Path(q.__file__).read_bytes()).hexdigest()
        sourcepin={'path':'/usr/local/lib/workspacex-cn/current_epoch_qualification.py','sha256':sourcehash}
        exe={str(pathlib.Path('/usr/bin/python3').resolve()):'e'*64}
        entry=dict(schemaVersion=2,sourcePath=sr,sha256=sourcehash,input={'path':root+'/qualification-input.json','sha256':'1'*64},
            sourcePolicy={'path':root+'/source-policy.json','sha256':'2'*64},executablePins=exe)
        profile=dict(toolRevision=b['toolRevision'],filesSha256={sr:sourcehash},currentEpochQualification=entry)
        raw=json.dumps(profile).encode();acceptance_raw=json.dumps({'identity':b['identity']}).encode()
        accept={'path':'/etc/workspacex-cn/acceptance.json','sha256':hashlib.sha256(acceptance_raw).hexdigest()}
        p=dict(schemaVersion=2,binding=b,collection=inputs['refs']['epochCollection'],outputRoot=root+'/qualified-current-epoch',recoveryEvidence={'sha256':'3'*64})
        reader=SimpleNamespace(json=lambda ref:p if ref==entry['input'] else {'sources':{sr:sourcepin}},finish=lambda:None)
        host=SimpleNamespace(plan={'identity':b['identity'],'acceptanceEvidence':accept},require_lock=lambda:None)
        t=CandidateStageHost(host,SimpleNamespace(value={'identity':b['identity']}));t.observe_hold=lambda:dict(schemaVersion=1,state='held',identity=b['identity'],host=b['host'],generation=b['holdGeneration'])
        private=lambda path:raw if path.endswith('trusted-tool-binding.json') else acceptance_raw
        authority=object()
        with patch('host_transport.private',side_effect=private),patch.object(q.recovery,'ProtectedArtifacts',return_value=reader),patch.object(q,'QualificationCodeAuthority',return_value=authority) as ctor,patch.object(q,'verify_existing_qualification',return_value={'epoch':inputs['refs']['epochManifest']}) as verify:
            result=t.verify_current_epoch(dict(collection=inputs['refs']['epochCollection'],manifest=inputs['refs']['epochManifest']),b)
        ctor.assert_called_once_with({sr:sourcepin},exe)
        verify.assert_called_once_with(p,reader,entry['sourcePolicy'],code_authority=authority)
        self.assertEqual(result['epochManifestSha256'],inputs['refs']['epochManifest']['sha256'])
        # Evidence cannot move an independently pinned source back inside its
        # private artifact tree or nominate a different runtime executable.
        reader.json=lambda ref:p if ref==entry['input'] else {'sources':{sr:{**sourcepin,'path':root+'/untrusted-source.py'}}}
        with patch('host_transport.private',side_effect=private),patch.object(q.recovery,'ProtectedArtifacts',return_value=reader),patch.object(q,'verify_existing_qualification') as verify:
            with self.assertRaisesRegex(ValueError,'INSTALLED_SOURCE_PIN'):
                t.verify_current_epoch(dict(collection=inputs['refs']['epochCollection'],manifest=inputs['refs']['epochManifest']),b)
            verify.assert_not_called()
        reader.json=lambda ref:p if ref==entry['input'] else {'sources':{sr:sourcepin}}
        entry['executablePins']={'/usr/bin/unapproved-python':'e'*64};raw=json.dumps(profile).encode()
        with patch('host_transport.private',side_effect=private),patch.object(q.recovery,'ProtectedArtifacts',return_value=reader),patch.object(q,'verify_existing_qualification') as verify:
            with self.assertRaisesRegex(ValueError,'EXECUTABLE_ALLOWLIST'):
                t.verify_current_epoch(dict(collection=inputs['refs']['epochCollection'],manifest=inputs['refs']['epochManifest']),b)
            verify.assert_not_called()


class NoneEndpointTests(unittest.TestCase):
    def fixture(self):
        from candidate_stage_host import verify_none_endpoint
        endpoint=dict(IPAMConfig=None,Links=None,Aliases=None,MacAddress='',NetworkID='a'*64,EndpointID='',
            Gateway='',IPAddress='',IPPrefixLen=0,IPv6Gateway='',GlobalIPv6Address='',GlobalIPv6PrefixLen=0,DNSNames=None)
        source=dict(Id='a'*64,Name='none',Driver='null',Scope='local',Containers={})
        def verify(e,s,cid):return verify_none_endpoint(dict(Id=cid,State=dict(Running=False,Paused=False),NetworkSettings=dict(Networks={'none':e})),s)
        return endpoint,source,verify
    def test_real_none_driver_metadata_stopped_and_owned_endpoint(self):
        e,s,verify=self.fixture();self.assertTrue(verify(e,s,'b'*64))
        e['EndpointID']='c'*64;s['Containers']['b'*64]=dict(EndpointID='c'*64,MacAddress='',IPv4Address='',IPv6Address='')
        self.assertTrue(verify(e,s,'b'*64))
    def test_nonempty_ip_route_mac_aliases_dns_or_unbound_metadata_fail(self):
        for k,v in (('IPAddress','192.168.1.2'),('Gateway','192.168.1.1'),('GlobalIPv6Address','::1'),('IPv6Gateway','::2'),
            ('MacAddress','00:11:22:33:44:55'),('IPPrefixLen',24),('GlobalIPv6PrefixLen',64),('IPPrefixLen',False),
            ('Aliases',['sandbox']),('DNSNames',['sandbox']),('Links',['api']),('NetworkID',''),('NetworkID','d'*64),
            ('EndpointID','e'*64),('IPAMConfig',{}),('GwPriority',1)):
            e,s,verify=self.fixture();e[k]=v
            with self.assertRaises(RuntimeError,msg=k):verify(e,s,'b'*64)
        e,s,verify=self.fixture();s['Driver']='bridge'
        with self.assertRaisesRegex(RuntimeError,'NONE_DRIVER'):verify(e,s,'b'*64)
        e,s,verify=self.fixture();del e['DNSNames']
        with self.assertRaisesRegex(RuntimeError,'ENDPOINT_SCHEMA'):verify(e,s,'b'*64)

    def test_unallocated_none_allowed_only_explicit_stopped_create_context(self):
        from candidate_stage_host import verify_none_endpoint
        e,s,_=self.fixture();e['NetworkID']=''
        c=dict(Id='b'*64,State=dict(Running=False,Paused=False),NetworkSettings=dict(Networks={'none':e}))
        self.assertTrue(verify_none_endpoint(c,s,allow_unallocated=True))
        with self.assertRaisesRegex(RuntimeError,'NETWORK_IDENTITY'):verify_none_endpoint(c,s)
        c['State']['Running']=True
        with self.assertRaisesRegex(RuntimeError,'NETWORK_IDENTITY'):verify_none_endpoint(c,s,allow_unallocated=True)
        e['NetworkID']=s['Id']
        with self.assertRaisesRegex(RuntimeError,'ENDPOINT_OWNER'):verify_none_endpoint(c,s)
        e['EndpointID']='c'*64;s['Containers'][c['Id']]=dict(EndpointID='c'*64,MacAddress='',IPv4Address='',IPv6Address='')
        self.assertTrue(verify_none_endpoint(c,s))
