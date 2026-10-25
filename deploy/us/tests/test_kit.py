"""Offline contract checks: no root, network, daemon or application containers."""
import copy,hashlib,importlib.util,json,os,re,shutil,stat,subprocess,tarfile,tempfile,unittest
from pathlib import Path
P=Path(__file__).resolve().parents[1];R=P.parents[1]
spec=importlib.util.spec_from_file_location('configure',P/'scripts/configure.py');config=importlib.util.module_from_spec(spec);spec.loader.exec_module(config)
def settings():
    return dict(repository='example/workspacex',domain='us.example.com',registryPrefix='registry.example.com/wsx',releaseTag='123-1',sourceRevision='a'*40,redisImage='redis@sha256:'+'b'*64,runnerUser='ghrunner',runnerName='us-prod',runnerArchiveUrl='https://github.com/actions/runner/releases/download/v2.999.0/actions-runner-linux-x64-2.999.0.tar.gz',runnerArchiveSha256='c'*64,adminEmail='admin@example.com',adminName='Test Admin',orgName='Test US',modelBaseUrl='https://model.example.com/v1',modelId='test-model',modelApiKey='test-private-key')
def env(path):return dict(line.split('=',1) for line in path.read_text().splitlines())
class KitTest(unittest.TestCase):
    def test_settings_keys_and_docs_cover_every_input(self):
        template=json.loads((P/'config/settings.example.json').read_text());self.assertEqual(set(template),set(settings()))
        docs=(P/'docs/VALUES.md').read_text()
        for key in template:self.assertIn('`'+key+'`',docs)
    def test_bad_or_unfilled_settings_rejected(self):
        cases=[json.loads((P/'config/settings.example.json').read_text())]
        for key,value in [('domain','foo;id.example.com'),('sourceRevision','abc'),('redisImage','redis:latest'),('runnerArchiveUrl','https://evil.example/runner.tgz'),('runnerUser','root;id'),('modelApiKey','line\nline')]:
            c=settings();c[key]=value;cases.append(c)
        for c in cases:
            with self.subTest(c=c):
                with self.assertRaises(ValueError):config.validate(c)
    def test_private_config_and_separate_identities(self):
        with tempfile.TemporaryDirectory() as t:
            d=Path(t)/'runtime';config.render(settings(),d)
            self.assertEqual(stat.S_IMODE(d.stat().st_mode),0o700)
            for p in d.iterdir():self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600,p.name)
            s=json.loads((d/'stable-secrets.json').read_text());self.assertEqual(len(s),len(set(s.values())))
            api=env(d/'api.env');mig=env(d/'migration.env');agent=env(d/'agent.env');mem=env(d/'memory-migration.env')
            self.assertEqual(api['APP_DB_PASSWORD'],mig['APP_DB_PASSWORD']);self.assertNotIn('MIGRATION_DB_PASSWORD',api)
            self.assertNotIn(s['owner'],(d/'api.env').read_text());self.assertNotIn('WORKSPACEX_DEPLOY_PROFILE',api)
            self.assertEqual(api['DEEP_AGENT_SERVICE_INTERNAL_KEY'],agent['NATIVE_SESSION_SERVICE_KEY'])
            self.assertEqual(agent['MEMORY_STORE_DATABASE_URL'],mem['MEMORY_STORE_DATABASE_URL'])
            self.assertEqual(mem['PROVISION_TIMEOUT_MS'],'240000')
            self.assertIn('FILL_FROM_BOOTSTRAP',(d/'probe.env').read_text())
            with self.assertRaises(ValueError):config.render(settings(),d)
    def test_compose_cli_resolves_all_services_without_daemon(self):
        if not shutil.which('docker'):self.skipTest('Docker Compose CLI unavailable; no daemon needed')
        with tempfile.TemporaryDirectory() as t:
            d=Path(t)/'runtime';config.render(settings(),d)
            result=subprocess.run(['docker','compose','-p','workspacex-us','--env-file',str(d/'compose.env'),'-f',str(d/'compose.json'),'config','--format','json'],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr);c=json.loads(result.stdout)
            self.assertEqual(set(c['services']),{'api','web','agent','sandbox','sandbox-sessions','postgres','redis'})
            self.assertEqual(c['services']['api']['environment']['APP_DB_USER'],'app_rw')
            for name in ['postgres','redis','agent','sandbox','sandbox-sessions']:self.assertFalse(c['services'][name].get('ports'))
            self.assertNotIn('WORKSPACEX_DEPLOY_PROFILE',c['services']['api']['environment'])
    def test_apparmor_persists_across_reboot(self):
        install=(P/'scripts/10-install.sh').read_text()
        self.assertIn('apparmor_parser -r /etc/apparmor.d/workspacex-native-sessions',install)
        self.assertIn('After=apparmor.service',install)
        self.assertIn("ref('/etc/apparmor.d/workspacex-native-sessions')",(P/'scripts/seal-policy.py').read_text())
    def test_file_index_covers_source_files(self):
        index=(P/'docs/FILES.md').read_text()
        for path in P.rglob('*'):
            if not path.is_file() or any(x in path.parts for x in ('.local','dist','__pycache__')):continue
            self.assertIn('`'+str(path.relative_to(P))+'`',index)
    def test_shell_syntax(self):
        for p in [*(P/'scripts').glob('*.sh'),*(P/'github').glob('*.sh')]:
            r=subprocess.run(['bash','-n',str(p)],capture_output=True,text=True);self.assertEqual(r.returncode,0,p.name+': '+r.stderr)
    def test_dispatch_is_manual_and_fixed_to_us(self):
        with tempfile.TemporaryDirectory() as t:
            fake=Path(t)/'gh';capture=Path(t)/'args';fake.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n');fake.chmod(0o755)
            e=dict(os.environ,PATH=t+os.pathsep+os.environ['PATH'],CAPTURE=str(capture))
            subprocess.run(['bash',str(P/'scripts/manual-release.sh'),'example/workspacex','123-1'],env=e,check=True)
            args=capture.read_text();self.assertIn('main-us',args);self.assertIn('environment=us',args);self.assertIn('build_only=false',args);self.assertIn('tag=123-1',args)
    @unittest.skipUnless((R/'scripts/registry-images.py').exists(),'Maintainer checkout required for packaging test')
    def test_package_and_patched_branch_admission(self):
        subprocess.run(['python3',str(P/'scripts/package.py')],check=True,capture_output=True)
        with tempfile.TemporaryDirectory() as t:
            with tarfile.open(P/'dist/workspacex-us.tar.gz') as archive:
                for name in archive.getnames():
                    self.assertNotIn('/.local/',name);self.assertNotIn('/dist/',name);self.assertNotIn('/__pycache__/',name)
                archive.extractall(t,filter='data') if hasattr(tarfile,'data_filter') else archive.extractall(t)
            kit=Path(t)/'workspacex-us'
            for line in (kit/'SHA256SUMS').read_text().splitlines():
                digest,name=line.split('  ',1);self.assertEqual(hashlib.sha256((kit/name).read_bytes()).hexdigest(),digest)
            planner=kit/'tools/registry-images.py'
            for branch,target in [('main-us','us'),('main','cn'),('develop','devapp')]:
                out=Path(t)/(branch+'.txt');e=dict(os.environ,GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REF_NAME=branch,GITHUB_RUN_ID='123',GITHUB_RUN_ATTEMPT='1',GITHUB_OUTPUT=str(out),TARGET_ENVIRONMENT='auto',BUILD_ONLY='false',BUILD_SERVICE='all',EXISTING_TAG='')
                r=subprocess.run(['python3',str(planner),'plan','--source','a'*40],env=e,capture_output=True,text=True)
                self.assertEqual(r.returncode,0,r.stderr);row=env(out);self.assertEqual(row['target'],target)
                if target=='us':
                    self.assertEqual(row['environment'],'production-us');self.assertIn('workspacex-us-production',row['runner']);self.assertEqual(row['group'],'workspacex-us-production-deploy')
            for event,target in [('push','auto'),('workflow_dispatch','cn')]:
                e=dict(os.environ,GITHUB_EVENT_NAME=event,GITHUB_REF_NAME='main-us',GITHUB_RUN_ID='123',GITHUB_RUN_ATTEMPT='1',GITHUB_OUTPUT=str(Path(t)/'rejected'),TARGET_ENVIRONMENT=target,BUILD_ONLY='false')
                r=subprocess.run(['python3',str(planner),'plan','--source','a'*40],env=e,capture_output=True,text=True);self.assertNotEqual(r.returncode,0)
            patch=(P/'github/us-support.patch').read_text();self.assertNotIn('+    branches:',patch)
    def test_runtime_files_and_source_provenance(self):
        for p in [*(P/'templates').glob('*.json'),*(P/'config').glob('*.json')]:json.loads(p.read_text())
        if (R/'scripts/registry-images.py').exists():
            for path,digest in json.loads((P/'templates/provenance.json').read_text()).items():self.assertEqual(hashlib.sha256((R/path).read_bytes()).hexdigest(),digest,path)
        self.assertIn("'readinessTimeoutSeconds':120",(P/'scripts/seal-policy.py').read_text())
        self.assertIn('PROVISION_TIMEOUT_MS',(P/'scripts/configure.py').read_text())
if __name__=='__main__':unittest.main()
