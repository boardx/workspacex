import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack, contextmanager

ROOT=Path(__file__).resolve().parents[1]
def module():
    spec=importlib.util.spec_from_file_location('deploy_registry',ROOT/'scripts/deploy-registry-images.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

@contextmanager
def host_fixture():
    """Exercise host state writes with fixed policy; replace privileged host boundaries."""
    m=module()
    with tempfile.TemporaryDirectory() as temp, ExitStack() as patches:
        root=Path(temp);state=root/'state';state.mkdir();lock=root/'lock';lock.touch()
        config={'environment':'devapp','registryPrefix':'registry.example/team','docker':'/usr/bin/docker',
                'dockerConfig':str(root/'docker'),'stateDirectory':str(state),
                'lockFile':'/run/workspacex-devapp-deploy.lock','composeFiles':[],
                'envFile':{'path':str(root/'env'),'sha256':'a'*64},'project':'example',
                'services':{},'health':{},'verificationCommand':['/usr/bin/true']}
        (root/'devapp.json').write_text(json.dumps(config))
        patches.enter_context(patch.object(m,'trusted',side_effect=lambda path,**kwargs:Path(path)))
        patches.enter_context(patch.object(m.engine,'trusted_file'))
        real_open=os.open
        patches.enter_context(patch.object(m.os,'open',side_effect=lambda path,*args,**kwargs:real_open(lock if str(path)==config['lockFile'] else path,*args,**kwargs)))
        images={role:{'sourceRevision':'b'*40} for role in m.registry.SERVICES}
        resolve=patches.enter_context(patch.object(m.registry,'resolve',side_effect=lambda docker,prefix,tag,role:images[role]))
        def release(config_file,manifest_file,directory,execute,lock_fd,commit):
            override=state/'override.yml';override.write_text('services: {}\n');commit(override)
            return {'status':'SUCCEEDED'}
        run=patches.enter_context(patch.object(m.engine,'release',side_effect=release))
        patches.enter_context(patch.object(m,'schema_preflight',return_value={'route':'image-only'}))
        yield m,root,state,images,resolve,run

class Policy(unittest.TestCase):
    def test_missing_policy_never_pulls_or_deploys(self):
        m=module()
        with patch.object(m.registry,'resolve') as pull:
            with self.assertRaises(FileNotFoundError): m.deploy('devapp','a'*40+'-123-1',Path('/nonexistent/release-config'))
            pull.assert_not_called()
    def test_environment_and_tag_reject_injection(self):
        m=module()
        for environment,tag in [('other','a'*40+'-123-1'),('cn','latest'),('../cn','a'*40+'-123-1')]:
            with self.assertRaises(ValueError): m.deploy(environment,tag)
    def test_cn_cannot_skip_existing_host_admission(self):
        m=module()
        with self.assertRaisesRegex(ValueError,'CN_ADMISSION_REQUIRED'):m.admission_command({},'cn')
        self.assertIsNone(m.admission_command({},'devapp'))

    def test_verified_image_source_propagates_for_short_and_legacy_tags(self):
        for tag in ['40174623496-1','b'*40+'-123-1']:
            with self.subTest(tag=tag), host_fixture() as (m,root,state,images,resolve,run):
                result=m.deploy('devapp',tag,root)
                manifest=json.loads((Path(result['evidenceDirectory'])/'manifest.json').read_text())
                pointer=json.loads((state/'current.json').read_text())
                self.assertEqual(manifest['sourceRevision'],'b'*40)
                self.assertEqual(pointer['sourceRevision'],'b'*40)
                self.assertEqual(pointer['tag'],tag)
                self.assertEqual(manifest['tag'],tag)
                self.assertEqual(resolve.call_count,5)
                run.assert_called_once()
                self.assertFalse((state/'pending.json').exists())

    def test_missing_invalid_or_mixed_image_sources_reject_before_state_mutation(self):
        for role in module().registry.SERVICES:
            for source in [None,'','b'*39,'B'*40,123,'c'*40]:
                with self.subTest(role=role,source=source), host_fixture() as (m,root,state,images,resolve,run):
                    image=images[role]
                    if source is None: image.pop('sourceRevision')
                    else: image['sourceRevision']=source
                    with self.assertRaisesRegex(ValueError,'IMAGE_SOURCE_MISMATCH'):
                        m.deploy('devapp','b'*40+'-123-1',root)
                    run.assert_not_called()
                    self.assertEqual(list(state.iterdir()),[])

    def test_us_uses_private_policy_and_canonical_selfhost_lock(self):
        with host_fixture() as (m,root,state,images,resolve,run):
            config=json.loads((root/'devapp.json').read_text())
            config.update(environment='us',lockFile='/run/workspacex-selfhost-deploy.lock')
            (root/'us.json').write_text(json.dumps(config))
            real_open=os.open
            fixture_lock=root/'us-lock';fixture_lock.touch()
            with patch.object(m.os,'open',side_effect=lambda path,*args,**kwargs:real_open(fixture_lock if str(path)==config['lockFile'] else path,*args,**kwargs)):
                result=m.deploy('us','40216660127-1',root)
            self.assertEqual(result['status'],'SUCCEEDED')
            self.assertEqual(result['environment'],'us')
            self.assertEqual(resolve.call_count,5)
            self.assertFalse((state/'pending.json').exists())
            config['lockFile']='/run/workspacex-devapp-deploy.lock'
            (root/'us.json').write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError,'CANONICAL_LOCK_REQUIRED'):
                m.deploy('us','40216660127-1',root)

    def test_schema_preflight_rejects_before_pulling_web_sandbox_and_postgres(self):
        from unittest.mock import Mock
        with host_fixture() as (m,root,state,images,resolve,run):
            config=json.loads((root/'devapp.json').read_text());config['environment']='us'
            config['lockFile']='/run/workspacex-selfhost-deploy.lock'
            (root/'us.json').write_text(json.dumps(config))
            lock=root/'us-lock';lock.touch();real_open=os.open
            plan={'route':'schema-preparation','changes':[{'role':'api','path':'migrations','added':['new.sql'],'removed':[],'changed':[]}],'planSha256':'a'*64}
            with patch.object(m.os,'open',side_effect=lambda path,*a,**kw:real_open(lock if str(path)==config['lockFile'] else path,*a,**kw)), patch.object(m,'schema_preflight',return_value=plan):
                result=m.deploy('us','41248889927-1',root)
            self.assertEqual(result['code'],'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE')
            self.assertEqual(result['route'],'schema-preparation')
            self.assertFalse(result['applyAttempted']);run.assert_not_called()
            self.assertEqual([call.args[-1] for call in resolve.call_args_list],['api'])
            self.assertTrue((Path(result['evidenceDirectory'])/'schema-plan.json').is_file())
            self.assertFalse((state/'pending.json').exists())

    def test_schema_preflight_compares_real_inventory_and_checks_live_binding(self):
        from unittest.mock import Mock
        m=module();d=Mock();old={'api':'sha256:'+'1'*64,'agent':'sha256:'+'2'*64}
        new={'api':{'imageId':'sha256:'+'3'*64},'agent':{'imageId':'sha256:'+'4'*64}}
        config={'project':'example','envFile':{'path':'/env'},'composeFiles':[], 'services':{'api':'api','agent':'agent','web':'web','sandbox':'sandbox'}}
        def output(args,**kw):
            return ('live-'+args[-1]).encode()
        d.run.side_effect=output
        def rows(args,**kw):
            role=args[-1].removeprefix('live-')
            return [{'Image':old[role],'State':{'Running':True},'Config':{'Labels':{'com.docker.compose.project':'example','com.docker.compose.service':role}}}]
        d.json.side_effect=rows
        inventories=[{'m':{'001.sql':'a'*64}},{'m':{'001.sql':'a'*64,'002.sql':'b'*64}},{'r':{'x':'c'*64}},{'r':{'x':'c'*64}}]
        with tempfile.TemporaryDirectory() as temp, patch.object(m.engine,'Docker',return_value=d), patch.object(m.engine,'schema',side_effect=inventories):
            plan=m.schema_preflight('us','41248889927-1','e'*40,config,new,Path(temp),'/docker')
        self.assertEqual(plan['route'],'schema-preparation')
        self.assertEqual(plan['changes'][0]['added'],['002.sql'])
        d.run.return_value=b'';d.run.side_effect=None
        with tempfile.TemporaryDirectory() as temp, patch.object(m.engine,'Docker',return_value=d):
            with self.assertRaisesRegex(ValueError,'EXISTING_CONTAINER_REQUIRED'):
                m.schema_preflight('us','41248889927-1','e'*40,config,new,Path(temp),'/docker')

    def test_schema_handoff_requires_a_separate_root_pinned_verifier(self):
        m=module();plan={'route':'schema-preparation','complete':True,'environment':'us'}
        policy={'kind':'installed-schema-release-adapter-v1','environment':'us','writer':{'path':'/writer','sha256':'a'*64},'verifier':{'path':'/verifier','sha256':'b'*64},'timeoutSeconds':30}
        calls=[]
        m.schema_handoff.validate_policy(plan,policy,lambda ref:calls.append(ref['path']))
        self.assertEqual(calls,['/writer','/verifier'])
        policy['verifier']['path']='/writer'
        with self.assertRaisesRegex(ValueError,'SEPARATE_SCHEMA_VERIFIER_REQUIRED'):
            m.schema_handoff.validate_policy(plan,policy,lambda ref:None)

    def test_schema_route_cannot_change_database_services_or_omit_applications(self):
        m=module()
        for services in [{}, {'postgres':'api','web':'web','agent':'agent','sandbox':'sandbox'}, {'api':'api','web':'web','agent':'agent','sandbox':'sandbox','redis':'sandbox'}]:
            with self.subTest(services=services),self.assertRaisesRegex(ValueError,'SCHEMA_APPLICATION_SERVICES'):
                m.schema_release('us','1-1',{'services':services},{},{},None,None,None,None)

    def test_full_schema_adapter_real_child_and_unknown_failure_blocks_retry(self):
        import sys
        for failure in ('', 'writer', 'runtime'):
            with self.subTest(failure=failure),host_fixture() as (m,root,state,images,resolve,run):
                for number,(role,image) in enumerate(images.items(),1):image['imageId']='sha256:'+str(number)*64
                config=json.loads((root/'devapp.json').read_text())
                config.update(environment='us',lockFile='/run/workspacex-selfhost-deploy.lock',services={v:v for v in ('api','web','agent','sandbox')})
                writer=root/'writer';verifier=root/'verifier'
                writer.write_text('#!'+sys.executable+'\n'+"""import hashlib,json,os,pathlib,sys
request=json.loads(pathlib.Path(sys.argv[2]).read_bytes());result=pathlib.Path(sys.argv[4])
assert os.fstat(int(os.environ['WSX_RELEASE_LOCK_FD'])).st_ino==request['canonicalLock']['inode']
proofs={}
for name in ('backup-restore','baseline-compatibility','migration-ledger','candidate-acceptance'):
 p=result.parent/(name+'.json');p.write_text(json.dumps({'fixtureOnly':True,'planSha256':request['planSha256']}));p.chmod(0o600)
 proofs[name]={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
result.write_text(json.dumps({'kind':'schema-release-result-v1','status':'SUCCEEDED',**{key:request[key] for key in ('environment','tag','sourceRevision','planSha256','manifestSha256')},'proofs':proofs}));result.chmod(0o600)
"""+('raise SystemExit(1)\n' if failure=='writer' else ''))
                verifier.write_text('#!'+sys.executable+'\n'+"""import hashlib,json,pathlib,sys
request=json.loads(pathlib.Path(sys.argv[2]).read_bytes());receipt=json.loads(pathlib.Path(sys.argv[4]).read_bytes())
assert request['planSha256']==receipt['planSha256']
for ref in receipt['proofs'].values():assert hashlib.sha256(pathlib.Path(ref['path']).read_bytes()).hexdigest()==ref['sha256']
""")
                for path in (writer,verifier):path.chmod(0o700)
                config['schemaRelease']={'kind':'installed-schema-release-adapter-v1','environment':'us','writer':{'path':str(writer),'sha256':m.engine.sha_file(writer)},'verifier':{'path':str(verifier),'sha256':m.engine.sha_file(verifier)},'timeoutSeconds':30}
                (root/'us.json').write_text(json.dumps(config));lock=root/'us-lock';lock.touch();real_open=os.open
                plan={'route':'schema-preparation','changes':[],'complete':True,'environment':'us','tag':'41248889927-1','sourceRevision':'b'*40,'planSha256':'a'*64}
                with patch.object(m.os,'open',side_effect=lambda path,*a,**kw:real_open(lock if str(path)==config['lockFile'] else path,*a,**kw)),patch.object(m,'schema_preflight',return_value=plan),patch.object(m.engine,'verify_runtime',side_effect=ValueError('runtime') if failure=='runtime' else None,return_value={'verified':True}):
                    result=m.deploy('us','41248889927-1',root)
                    run.assert_not_called()
                    if failure:
                        self.assertEqual(result['status'],'FAILED_OR_UNCERTAIN')
                        self.assertTrue((state/'pending.json').exists());self.assertFalse((state/'current.json').exists())
                        count=resolve.call_count
                        with self.assertRaisesRegex(ValueError,'UNRESOLVED_DEPLOYMENT_REQUIRES_RECONCILIATION'):m.deploy('us','41248889927-1',root)
                        self.assertEqual(resolve.call_count,count)
                    else:
                        self.assertEqual(result['status'],'SUCCEEDED');self.assertTrue((state/'current.json').exists());self.assertFalse((state/'pending.json').exists())

    def test_api_first_uses_actual_stopped_probe_commands_and_cleans_them(self):
        import test_minimal_docker_release as fixtures
        fixture=fixtures.Tests();fixture.setUp()
        try:
            fixture.state['schemaDrift']=True;fixture.statepath.write_text(json.dumps(fixture.state))
            with host_fixture() as (m,root,state,images,resolve,run):
                for role,image in images.items():image['imageId']=fixture.state['new'][role]
                config=json.loads((root/'devapp.json').read_text())
                config.update(environment='us',lockFile='/run/workspacex-selfhost-deploy.lock',project='example',services=fixture.state['services'],docker=str(fixture.root/'docker'))
                (root/'us.json').write_text(json.dumps(config));lock=root/'us-lock';lock.touch();real_open=os.open
                with patch.object(m.os,'open',side_effect=lambda path,*a,**kw:real_open(lock if str(path)==config['lockFile'] else path,*a,**kw)),patch.object(m,'schema_preflight',wraps=module().schema_preflight):
                    result=m.deploy('us','41248889927-1',root)
                self.assertEqual(result['code'],'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE')
                self.assertEqual(result['route'],'maintenance-review');self.assertFalse(result['schemaPlanComplete'])
                self.assertEqual(result['schemaChanges'][0]['changed'],['001.sql'])
                self.assertEqual([c.args[-1] for c in resolve.call_args_list],['api']);run.assert_not_called()
                actual=json.loads(fixture.statepath.read_text())
                self.assertEqual(actual['probes'],{});self.assertFalse(actual['applied'])
                self.assertEqual(sum(c[0]=='create' for c in actual['calls']),2)
                self.assertFalse(any('up' in c for c in actual['calls']))
        finally:fixture.tearDown()

    def test_worker_outcome_reports_only_structured_public_fields(self):
        import io
        from contextlib import redirect_stdout
        m=module()
        reply=type('Reply',(),{'stdout':'systemd noise\n'+json.dumps({'status':'REJECTED','code':'LIVE_CONFIG_DRIFT','secret':'never-forward'})+'\n'})()
        output=io.StringIO()
        with patch.object(m.subprocess,'run',return_value=reply), redirect_stdout(output):
            m.report_worker_result('wsx-image-us-fixture')
        self.assertEqual(json.loads(output.getvalue()),{'status':'REJECTED','code':'LIVE_CONFIG_DRIFT'})

    def test_atomic_pointer_is_complete(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'current.json';m.atomic(p,{'tag':'old'});m.atomic(p,{'tag':'new'})
            self.assertEqual(json.loads(p.read_text()),{'tag':'new'});self.assertEqual(p.stat().st_mode & 0o777,0o600)
    def test_untrusted_policy_is_rejected(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'config';p.write_text('{}');p.chmod(0o666)
            with self.assertRaises(ValueError): m.trusted(p)
    def test_symlink_ancestor_is_rejected(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'real').mkdir();(root/'link').symlink_to(root/'real',target_is_directory=True)
            p=root/'real'/'config';p.write_text('{}')
            with self.assertRaises(ValueError): m.trusted(root/'link'/'config')

if __name__=='__main__':unittest.main()
