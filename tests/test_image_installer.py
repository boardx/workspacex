"""Image installer contract: no daemon, root, network or production mutations."""
import importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('image_installer',ROOT/'scripts/image_install/installer.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
class InstallTests(unittest.TestCase):
 def test_supported_host_versions_and_negative_cases(self):
  spec=importlib.util.spec_from_file_location('installer_host',ROOT/'scripts/image_install/scripts/host.py')
  self.assertTrue(Path(spec.origin).is_file(),'Missing shared host validator for Ubuntu 26.04')
  host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
  for version in ('24.04','26.04'):
   host.validate_os('ID=ubuntu\nVERSION_ID="'+version+'"\n','Linux','x86_64')
  for release,system,machine in [('ID=debian\nVERSION_ID="26.04"','Linux','x86_64'),('ID=ubuntu\nVERSION_ID="22.04"','Linux','x86_64'),('ID=ubuntu\nVERSION_ID="26.04"','Linux','aarch64'),('ID=ubuntu\nVERSION_ID="26.04"','Darwin','x86_64'),('ID=notubuntu\nOTHER_VERSION_ID="26.04"','Linux','x86_64')]:
   with self.assertRaises(ValueError):host.validate_os(release,system,machine)
 def test_numeric_directory_ownership_uses_ids(self):
  spec=importlib.util.spec_from_file_location('host_setup',ROOT/'scripts/image_install/scripts/host_setup.py')
  self.assertTrue(Path(spec.origin).is_file(),'Missing numeric ownership/recovery helper')
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'sandbox';module.numeric_directory(p,os.geteuid(),os.getegid())
   self.assertEqual(p.stat().st_uid,os.geteuid());self.assertEqual(p.stat().st_gid,os.getegid());self.assertEqual(p.stat().st_mode & 0o777,0o700)
   file=Path(d)/'redis.conf';file.write_text('private');file.chmod(0o600);module.numeric_owner(file,os.geteuid(),os.getegid());self.assertEqual(file.stat().st_mode & 0o777,0o600)
   link=Path(d)/'link';link.symlink_to(p)
   with self.assertRaises(ValueError):module.numeric_directory(link,os.geteuid(),os.getegid())
 def test_archive_prebootstrap_preserves_staging_and_refuses_data(self):
  spec=importlib.util.spec_from_file_location('host_setup',ROOT/'scripts/image_install/scripts/host_setup.py')
  self.assertTrue(Path(spec.origin).is_file(),'Missing guarded prebootstrap recovery')
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  for bad in ('state','data','mismatch','symlink','extra','input',None):
   with tempfile.TemporaryDirectory() as d:
    root=Path(d);stage=root/'stage';runtime=root/'runtime';data=root/'data';state=root/'state';templates=root/'templates'
    for p in (stage,runtime,data,state,templates):p.mkdir(mode=0o700)
    for p in (stage,runtime):
     (p/'stable-secrets.json').write_text('same-stable-secret');(p/'input-config.sha256').write_text('input-hash\n')
    for name in ('docker-seccomp.json','docker-apparmor-sessions'):
     (templates/name).write_text('profile');(runtime/name).write_text('profile')
    if bad=='state':(state/'bootstrap-started').touch()
    if bad=='data':(data/'postgres').mkdir()
    if bad=='mismatch':(runtime/'stable-secrets.json').write_text('changed')
    if bad=='symlink':(runtime/'stable-secrets.json').unlink();(runtime/'stable-secrets.json').symlink_to(stage/'stable-secrets.json')
    if bad=='extra':(runtime/'foreign').touch()
    if bad=='input':(stage/'input-config.sha256').write_text('different')
    if bad:
     with self.assertRaises(ValueError):module.archive_prebootstrap(stage,runtime,data,state,templates,root,'input-hash')
     self.assertTrue(runtime.exists());self.assertTrue(data.exists());self.assertTrue(state.exists())
    else:
     backup=module.archive_prebootstrap(stage,runtime,data,state,templates,root,'input-hash')
     self.assertEqual((backup/'runtime/stable-secrets.json').read_text(),'same-stable-secret')
     self.assertEqual((stage/'stable-secrets.json').read_text(),'same-stable-secret');self.assertFalse(runtime.exists());self.assertTrue((backup/'state').is_dir())
 def config(self):return {'IMAGE_TAG':'123-1','PUBLIC_DOMAIN':'us.example.com','ADMIN_EMAIL':'admin@example.com','MODEL_BASE_URL':'https://models.example.com/v1','MODEL_ID':'test','MODEL_API_KEY':'private-test-key'}
 def test_failed_preflight_reuses_stable_staging(self):
  with tempfile.TemporaryDirectory() as d:
   c=installer.settings_from_values(self.config());c['sourceRevision']='a'*40;c['redisImage']='redis@sha256:'+'b'*64;out=Path(d)/'runtime'
   installer.prepare_runtime(c,'input-hash',out);before=(out/'stable-secrets.json').read_bytes()
   installer.prepare_runtime(c,'input-hash',out);self.assertEqual((out/'stable-secrets.json').read_bytes(),before)
   with self.assertRaises(ValueError):installer.prepare_runtime(c,'changed-hash',out)
 def test_public_compose_is_a_generated_view(self):
  self.assertEqual((ROOT/'deploy/us/compose.yaml').read_bytes(),(ROOT/'scripts/image_install/templates/compose.json').read_bytes())
 def test_single_config_and_safe_defaults(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'.env';p.write_text('\n'.join(k+'='+v for k,v in self.config().items()))
   c=installer.load_settings(p);self.assertEqual(c['domain'],'us.example.com');self.assertNotIn('runnerUser',c)
 def test_official_semver_image_tags_supported(self):
  c=self.config();c['IMAGE_TAG']='v1.2.3';self.assertEqual(installer.settings_from_values(c)['releaseTag'],'v1.2.3')
 def test_missing_or_placeholder_values_rejected(self):
  for value in ('','REPLACE_IMAGE_TAG','latest'):
   with tempfile.TemporaryDirectory() as d:
    c=self.config();c['IMAGE_TAG']=value;p=Path(d)/'.env';p.write_text('\n'.join(k+'='+v for k,v in c.items()))
    with self.assertRaises(ValueError):installer.load_settings(p)
 def test_image_source_validation_before_host_mutations(self):
  c=installer.settings_from_values(self.config())
  def inspect(image):return {'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':('b' if '/web:' in image else 'a')*40}}}
  with self.assertRaisesRegex(ValueError,'same source'):installer.resolve_source(c,inspect)
 def test_plan_does_not_print_secrets_or_require_docker(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'.env';p.write_text('\n'.join(k+'='+v for k,v in self.config().items()))
   r=subprocess.run(['python3',str(ROOT/'scripts/image_install/installer.py'),'plan','--config',str(p)],capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr);self.assertNotIn('private-test-key',r.stdout);self.assertIn('postgres-age',r.stdout)
 def test_bootstrap_order_and_no_runner(self):
  names=installer.step_names(acme=True)
  self.assertLess(names.index('10-install.sh'),names.index('20-bootstrap.sh'));self.assertLess(names.index('20-bootstrap.sh'),names.index('40-accept.sh'));self.assertNotIn('50-runner.sh',names)
 def test_render_compose_resolves_without_daemon(self):
  with tempfile.TemporaryDirectory() as d:
   c=installer.settings_from_values(self.config());c['sourceRevision']='a'*40;c['redisImage']='redis@sha256:'+'b'*64;out=Path(d)/'runtime';installer.render(c,out)
   r=subprocess.run(['docker','compose','--env-file',str(out/'compose.env'),'-f',str(out/'compose.json'),'config','--format','json'],capture_output=True,text=True)
   self.assertEqual(r.returncode,0,r.stderr);v=json.loads(r.stdout);self.assertEqual(len(v['services']),7)
   self.assertNotIn('MIGRATION_DB_PASSWORD',v['services']['api']['environment'])
   self.assertNotIn('workspacex-us',json.dumps(v))
 def test_internal_shell_scripts_parse(self):
  for path in (ROOT/'scripts/image_install/scripts').glob('*.sh'):
   r=subprocess.run(['bash','-n',str(path)],capture_output=True,text=True);self.assertEqual(r.returncode,0,path.name+r.stderr)
 def test_render_preserves_secret_boundaries_and_refuses_overwrite(self):
  with tempfile.TemporaryDirectory() as d:
   c=installer.settings_from_values(self.config());c['sourceRevision']='a'*40;c['redisImage']='redis@sha256:'+'b'*64;out=Path(d)/'runtime';installer.render(c,out)
   secrets=json.loads((out/'stable-secrets.json').read_text());self.assertEqual(len(secrets),len(set(secrets.values())))
   api=dict(line.split('=',1) for line in (out/'api.env').read_text().splitlines())
   self.assertEqual(api['REDIS_HOST'],'redis');self.assertEqual(api['REDIS_PORT'],'6379');self.assertEqual(api['REDIS_PASSWORD'],secrets['redis'])
   self.assertNotIn(secrets['owner'],(out/'api.env').read_text());self.assertNotIn(secrets['memoryOwner'],(out/'agent.env').read_text())
   with self.assertRaises(ValueError):installer.render(c,out)
   self.assertEqual(out.stat().st_mode & 0o777,0o700)
 def test_package_has_one_entry_and_one_config(self):
  with tempfile.TemporaryDirectory() as d:
   archive=installer.package(Path(d));import tarfile
   with tarfile.open(archive) as t:
    roots={p.name.split('/')[1] for p in t.getmembers() if len(p.name.split('/'))==2};self.assertEqual(roots,{'install.py','compose.yaml','.env.example','README.md','.runtime','SHA256SUMS'})
    self.assertFalse(any('/.local/' in m.name or '/dist/' in m.name for m in t.getmembers()))
    for name in ['docker-seccomp.json','docker-apparmor-sessions']:self.assertEqual(t.extractfile('workspacex-install/.runtime/templates/'+name).read(),(ROOT/'apps/skill-sandbox/security'/name).read_bytes())
    t.extractall(d,filter='data') if hasattr(tarfile,'data_filter') else t.extractall(d)
   kit=Path(d)/'workspacex-install';cfg=kit/'.env';cfg.write_text('\n'.join(k+'='+v for k,v in self.config().items()))
   r=subprocess.run(['python3',str(kit/'install.py'),'plan','--config',str(cfg)],capture_output=True,text=True);self.assertEqual(r.returncode,0,r.stderr);self.assertNotIn('private-test-key',r.stdout)
   import hashlib
   for line in (kit/'SHA256SUMS').read_text().splitlines():
    digest,name=line.split('  ',1);self.assertEqual(hashlib.sha256((kit/name).read_bytes()).hexdigest(),digest)
if __name__=='__main__':unittest.main()
