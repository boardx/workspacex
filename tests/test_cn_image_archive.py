import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import cn_image_archive as c
spec = importlib.util.spec_from_file_location('archive_import', ROOT / '.harness/scripts/vm/import-cn-image-archives.py')
i = importlib.util.module_from_spec(spec); spec.loader.exec_module(i)
spec = importlib.util.spec_from_file_location('archive_export', ROOT / 'scripts/export-cn-image-archives.py')
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)


def plan():
    return dict(schemaVersion=1, sourceRevision='a'*40, controlRevision='b'*40, release='1.2.3', attemptId='test-1',
                platform='linux/amd64', baseImages=dict(node='docker.io/library/node@sha256:'+'1'*64,
                python='docker.io/library/python@sha256:'+'2'*64, postgres='docker.io/pgvector/pgvector@sha256:'+'3'*64,
                redis=c.PREFIX+'/base-redis@sha256:'+'4'*64), maxArchiveBytes=1024**2, maxTotalBytes=5*1024**2, storageMarginBytes=1024**3)


def archive(path, build, service, damage=None):
    layer=b'a deterministic uncompressed layer'
    config=dict(os='linux', architecture='amd64', config=dict(Labels={'org.opencontainers.image.revision':build['sourceRevision'],
        'org.workspacex.archive-build-identity':c.build_identity(build)}), rootfs=dict(type='layers', diff_ids=['sha256:'+c.sha(layer)]))
    if damage == 'arch': config['architecture']='arm64'
    if damage == 'source': config['config']['Labels']['org.opencontainers.image.revision']='c'*40
    if damage == 'layer': layer += b'corruption'
    raw=c.json_bytes(config); name=c.sha(raw)+'.json'
    manifest=c.json_bytes([dict(Config=name, RepoTags=[c.staging_tag(build,service)], Layers=['layer/layer.tar'])])
    with tarfile.open(path,'w',format=tarfile.USTAR_FORMAT) as t:
        for filename, data in ((name,raw),('layer/layer.tar',layer),('manifest.json',manifest)):
            member=tarfile.TarInfo(filename); member.size=len(data);t.addfile(member,io.BytesIO(data))
        if damage in ('extra','duplicate','traversal','symlink'):
            member=tarfile.TarInfo({'extra':'unexpected','duplicate':'manifest.json','traversal':'../escape','symlink':'link'}[damage])
            if damage=='symlink': member.type=tarfile.SYMTYPE;member.linkname='/etc/passwd'
            else: member.size=1
            t.addfile(member,None if damage=='symlink' else io.BytesIO(b'x'))


def image(entry, build):
    return dict(Id=entry['imageId'], Os='linux', Architecture='amd64', Config=dict(Labels={'org.opencontainers.image.revision':build['sourceRevision'],
        'org.workspacex.archive-build-identity':c.build_identity(build)}))


class Adapter:
    def __init__(self, build, entries):
        self.build=build;self.entries=entries;self.local_images={};self.remote={};self.calls=[];self.fail=None;self.lost_ack=False
    def check_validity(self): self.calls.append(('ttl-check',))
    def local(self,tag): return self.local_images.get(tag)
    def protect_running_targets(self,*args): self.calls.append(('running-check',))
    def authenticate(self): self.calls.append(('auth',))
    def remote_config_id(self,tag): self.calls.append(('probe',tag));return self.remote.get(tag,{}).get('Id')
    def pull_optional(self,tag):
        if tag in self.remote: self.local_images[tag]=self.remote[tag]
        return self.remote.get(tag)
    def load(self,path):
        service=Path(path).stem;entry=self.entries[service];self.local_images[entry['stagingTag']]=image(entry,self.build);self.calls.append(('load',service))
        if self.fail=='load':raise i.Rejected('INJECTED_LOAD')
    def tag(self,source,target):self.local_images[target]=self.local_images[source];self.calls.append(('tag',target))
    def push(self,target):
        self.calls.append(('push',target))
        if self.fail=='push': return False
        self.remote[target]=self.local_images[target];return not self.lost_ack
    def pull_required(self,target):self.local_images[target]=dict(Os='linux',Architecture='amd64')
    def registry_digest(self,target,img):return target.split('@')[0].rsplit(':',1)[0]+'@sha256:'+'9'*64 if '@' not in target else target
    def canonical_publish(self,value):self.calls.append(('seal',));return value
    def remove_owned_tag(self,tag,imgid):
        self.calls.append(('cleanup',tag))
        if self.local_images.get(tag,{}).get('Id')==imgid: self.local_images.pop(tag)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.build=plan();self.entries={}
        for service in c.REPOSITORIES:
            path=self.root/(service+'.tar');archive(path,self.build,service)
            size,sha=c.file_digest(path,self.build['maxArchiveBytes'])
            self.entries[service]=dict(file=service+'.tar',size=size,sha256=sha,**c.inspect_archive(path,self.build,service))
    def value(self):
        now=datetime.now(timezone.utc)
        value={k:self.build[k] for k in ('sourceRevision','controlRevision','release','attemptId','platform')}
        value.update(schemaVersion=1,receiptKind='cn-image-archive-set-v1',planSha256=c.sha(c.json_bytes(self.build)),producedAt=now.isoformat(),expiresAt=(now+timedelta(minutes=30)).isoformat(),images=self.entries,ready=False,prepared=False,productionActivated=False)
        return value
    def test_complete_archive_set(self):
        raw=c.json_bytes(self.value());v,total=c.validate_set(self.root,raw,c.sha(raw),self.build);self.assertEqual(len(v['images']),5);self.assertGreater(total,0)
    def test_archive_attack_inputs(self):
        for damage in ('arch','source','layer','extra','duplicate','traversal','symlink'):
            with self.subTest(damage=damage):
                p=self.root/'bad.tar';archive(p,self.build,'api',damage)
                with self.assertRaises((ValueError,tarfile.TarError)):c.inspect_archive(p,self.build,'api')
    def test_metadata_tamper(self):
        for field,value in (('imageId','sha256:'+'f'*64),('size',1),('sha256','f'*64),('stagingTag','foreign:tag')):
            v=self.value();v=copy.deepcopy(v);v['images']['api'][field]=value;raw=c.json_bytes(v)
            with self.subTest(field=field),self.assertRaises(ValueError):c.validate_set(self.root,raw,c.sha(raw),self.build)
    def test_expiry_missing_and_privilege(self):
        for mutation in ('expiry','missing','ready'):
            v=copy.deepcopy(self.value())
            if mutation=='expiry':v['expiresAt']=v['producedAt']
            elif mutation=='missing':del v['images']['api']
            else:v['ready']=True
            raw=c.json_bytes(v)
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):c.validate_set(self.root,raw,c.sha(raw),self.build)
    def test_duplicate_json(self):
        with self.assertRaises(ValueError):c.decode(b'{"a":1,"a":2}')
    def test_identity_stable_across_attempt(self):
        other=copy.deepcopy(self.build);other['attemptId']='retry-2';other['maxTotalBytes']*=2
        self.assertEqual(c.build_identity(other),c.build_identity(self.build));self.assertNotEqual(c.staging_tag(other,'api'),c.staging_tag(self.build,'api'))
    def test_all_remote_collision_checks_before_write(self):
        a=Adapter(self.build,self.entries);target=c.PREFIX+'/postgres-age:'+self.build['sourceRevision'];a.remote[target]=dict(Id='sha256:'+'f'*64)
        with self.assertRaisesRegex(ValueError,'REMOTE_IMAGE_ID_MISMATCH'):i.publish_images({'buildPlan':self.build},self.value(),self.root,a,c)
        self.assertFalse(any(x[0] in ('load','tag','push') for x in a.calls));self.assertEqual(sum(x[0]=='probe' for x in a.calls),5)
    def test_success_and_retry_no_repeated_push(self):
        a=Adapter(self.build,self.entries);result=i.publish_images({'buildPlan':self.build},self.value(),self.root,a,c)
        self.assertEqual(sum(x[0]=='push' for x in a.calls),5);self.assertEqual(len(result['images']),6)
        self.assertNotEqual(result['images']['api']['image'].split('@')[1],self.entries['api']['imageId'])
        a.calls=[];i.publish_images({'buildPlan':self.build},self.value(),self.root,a,c);self.assertFalse(any(x[0]=='push' for x in a.calls))
    def test_lost_acknowledgement_readback(self):
        a=Adapter(self.build,self.entries);a.lost_ack=True;i.publish_images({'buildPlan':self.build},self.value(),self.root,a,c)
        self.assertEqual(sum(x[0]=='push' for x in a.calls),5)
    def test_partial_load_failure_cleanup(self):
        a=Adapter(self.build,self.entries);a.fail='load'
        with self.assertRaisesRegex(ValueError,'INJECTED_LOAD'):i.publish_images({'buildPlan':self.build},self.value(),self.root,a,c)
        self.assertEqual(a.local_images,{});self.assertFalse(any(x[0]=='push' for x in a.calls))
    def test_failed_push_never_seals(self):
        a=Adapter(self.build,self.entries);a.fail='push'
        with self.assertRaisesRegex(ValueError,'REGISTRY_PUSH_UNCONFIRMED'):i.publish_images({'buildPlan':self.build},self.value(),self.root,a,c)
        self.assertFalse(any(x[0]=='seal' for x in a.calls));self.assertEqual(sum(x[0]=='push' for x in a.calls),1)
    def test_preexisting_staging_reference_not_removed(self):
        a=Adapter(self.build,self.entries);entry=self.entries['api'];a.local_images[entry['stagingTag']]=image(entry,self.build)
        i.publish_images({'buildPlan':self.build},self.value(),self.root,a,c);self.assertIn(entry['stagingTag'],a.local_images)
    def test_unknown_immutable_provider_response_fails_closed(self):
        now=datetime.now(timezone.utc).isoformat()
        proof=dict(schemaVersion=1,observedAt=now,accountId='1177216024653153',region='cn-shanghai',instanceId=c.INSTANCE,repositories={})
        approved={k:proof[k] for k in ('observedAt','accountId','region','instanceId')};approved['repositories']={}
        for name in c.REPOSITORIES.values():
            proof['repositories'][name]=dict(IsSuccess=True,Code='success',InstanceId=c.INSTANCE,RepoNamespaceName='workspacex-prod',RepoName=name,RepoStatus='NORMAL',RepoType='PRIVATE',TagImmutability=True,RepoId='crr-fixture'+name.replace('-',''))
            approved['repositories'][name]=dict(repositoryId=proof['repositories'][name]['RepoId'],immutable=True)
        # Synthetic positive contract input is not evidence about any real repository.
        c.validate_immutable_evidence(proof,approved)
        for unknown in (None,False,'true','unknown',1):
            bad=copy.deepcopy(proof);bad['repositories']['postgres-age']['TagImmutability']=unknown
            with self.subTest(unknown=unknown),self.assertRaisesRegex(ValueError,'IMMUTABILITY_RAW_NOT_PROVEN'):c.validate_immutable_evidence(bad,approved)
        bad=copy.deepcopy(proof);del bad['repositories']['web']
        with self.assertRaisesRegex(ValueError,'IMMUTABILITY_RAW_COMPLETE'):c.validate_immutable_evidence(bad,approved)

    def test_export_workflow_only_manual_main_without_cloud_authority(self):
        source=(ROOT/'.github/workflows/export-cn-image-archives.yml').read_text()
        import re
        triggers=source.split('\non:\n')[1].split('\npermissions:')[0]
        self.assertEqual(re.findall(r'^  ([a-z_]+):',triggers,re.M),['workflow_dispatch'])
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",source)
        self.assertIn('contents: read',source);self.assertIn('runs-on: ubuntu-24.04',source)
        for forbidden in ('self-hosted','id-token:','secrets.','environment:','sudo','--publish','--prepare','aliyun','docker push','docker login'):
            self.assertNotIn(forbidden,source)
        self.assertEqual(source.count('persist-credentials: false'),4)
        self.assertEqual(source.count('[[ "$EVENT_NAME" == workflow_dispatch && "$GITHUB_REF" == refs/heads/main ]]'),4)
        self.assertIn('compression-level: 0',source)
        self.assertIn("plan['controlRevision'] == os.environ['GITHUB_SHA']",source)
        self.assertIn('merge-base --is-ancestor HEAD origin/main',source)
        self.assertIn('fsck --full --no-reflogs',source)

    def test_export_shell_rejects_automatic_and_wrong_ref_before_tools(self):
        import os, subprocess
        source=(ROOT/'.github/workflows/export-cn-image-archives.yml').read_text()
        scripts=[]
        for block in source.split('      - name: ')[1:]:
            if '        run: |\n' in block:
                body=block.split('        run: |\n',1)[1]
                scripts.append('\n'.join(line[10:] for line in body.splitlines() if line.startswith('          '))+'\n')
        self.assertEqual(len(scripts),4)
        for script in scripts:
            for event,ref in [('workflow_run','refs/heads/main'),('pull_request','refs/pull/5512/merge'),('push','refs/heads/main'),('workflow_dispatch','refs/heads/branch'),('workflow_dispatch','refs/tags/main')]:
                env=dict(PATH='/usr/bin:/bin',EVENT_NAME=event,GITHUB_REF=ref,RUNNER_TEMP=str(self.root),BUILD_PLAN='{}')
                result=subprocess.run(['/bin/bash','-c',script],env=env,text=True,capture_output=True,timeout=5)
                with self.subTest(event=event,ref=ref):
                    self.assertEqual(result.returncode,2,result.stderr)
                    self.assertEqual(result.stderr,'')
                    self.assertFalse((self.root/'cn-archive-plan.json').exists())

    def test_dirty_control_rejected_before_build(self):
        def command(argv,cwd=None):
            if argv[1:]==['rev-parse','HEAD']:return (self.build['controlRevision']+'\n').encode()
            if argv[1]=='status':return b' M scripts/export-cn-image-archives.py\n'
            raise AssertionError(argv)
        with self.assertRaisesRegex(ValueError,'CONTROL_DIRTY'):e.produce(self.build,ROOT,self.root/'out',command)
        self.assertFalse((self.root/'out').exists())

if __name__=='__main__':unittest.main()
