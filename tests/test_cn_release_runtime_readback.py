"""Actual temporary config/tar files and original runtime validator, no cloud."""
import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=module('readback',ROOT/'scripts/cn-release-runtime-readback.py')
f=module('bindfixtures',ROOT/'tests/test_cn_release_continuation_bind.py')
enc=lambda x:(json.dumps(x,sort_keys=True)+'\n').encode()


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        self.f=f.ReviewedPackageIntegration();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.f.root=self.f.root.resolve()  # macOS /var alias is not a trusted directory component
        self.runtime=self.f.root/'runtime';self.runtime.mkdir(mode=0o700)
        self.root=self.runtime/'upgrade-f0eb-readback';self.root.mkdir(mode=0o700)
        self.write(self.runtime/'release.lock',b'')
        live=self.f.root/'live';live.mkdir(mode=0o700)
        contents={'compose.json':b'{"fixture":true}\n','api.env':b'FAKE_ONLY=not-a-real-secret\n'}
        for name,raw in contents.items():self.write(live/name,raw)
        t=json.loads(self.f.inputs['template']);t['workingDir']=str(live)
        t['composeFiles']=[dict(path=str(live/'compose.json'),sha256=m.sha(contents['compose.json']))]
        t['envFiles']=[dict(path=str(live/'api.env'),sha256=m.sha(contents['api.env']))]
        t['backupPaths']=[str(live/'sandbox'),str(live/'sessions')]
        self.f.inputs['template']=enc(t);self.f.advance_inputs('backup');self.f.run_bind('generated')
        generated=self.f.root/'generated';self.braw=(generated/'binding.json').read_bytes();self.b=json.loads(self.braw)
        self.write(self.root/'binding.json',self.braw)
        for source,dest in [('upgrade-draft.py','upgrade-draft.py'),('backup-host.DRAFT.py','backup-host.py')]:
            self.write(self.root/dest,(generated/source).read_bytes())
        self.write(self.root/'backup-intent.json',enc(dict(bindingSha256=m.sha(self.braw),holdGeneration=self.b['hold']['generation'])))
        dest=self.root/'host-backup';dest.mkdir(mode=0o700)
        backup=m.trusted_module((self.root/'backup-host.py').read_bytes(),'fixturebackup')
        # Exercise original pure backup_config_files algorithm on nonsecret files.
        configs=backup['backup_config_files'](self.b['composeFiles']+self.b['envFiles'],dest/'config')
        for path in (dest/'config').iterdir():path.chmod(0o600)
        archives=[]
        for original in sorted(self.b['backupPaths']):
            path=dest/(Path(original).name+'.tar')
            with tarfile.open(path,'w')as archive:
                data=b'synthetic archive bytes';info=tarfile.TarInfo(Path(original).name+'/fixture.txt');info.size=len(data)
                archive.addfile(info,io.BytesIO(data))
            path.chmod(0o600);raw=path.read_bytes()
            archives.append(dict(originalPath=original,backupFile=path.name,sha256=m.sha(raw),bytes=len(raw)))
        self.manifest=dict(scope=self.b['backupScope'],configFiles=configs,dataArchives=archives,ephemeralSocketsExcluded=0,
            restoreTested=False,databaseBackup=False,redisBackup=False,ossBackup=False)
        self.result=dict(actual=dict(path=str(dest),manifestSHA256=m.sha(enc(self.manifest)),scope=self.b['backupScope'],restoreTested=False),holdGeneration=self.b['hold']['generation'])
        self.sync_manifest()
        now=dt.datetime.now(dt.timezone.utc)
        self.approval=dict(kind='cn-runtime-backup-readback-approval-v1',remoteRoot=str(self.root),bindingSha256=m.sha(self.braw),
            identity={k:self.b[k]for k in m.IDENTITY},holdGeneration=self.b['hold']['generation'],
            issuedAt=(now-dt.timedelta(seconds=2)).isoformat(),expiresAt=(now+dt.timedelta(minutes=5)).isoformat(),
            observerSha256=m.sha((ROOT/'scripts/cn-release-runtime-readback.py').read_bytes()),upgradeSha256=self.b['scriptSha256'],
            backupHelperSha256=self.b['backupHelperSha256'],holdHelperSha256=self.b['holdHelperSha256'],maxSeconds=120)

    def write(self,path,raw):path.write_bytes(raw);path.chmod(0o600)

    def sync_manifest(self):
        raw=enc(self.manifest);self.write(self.root/'host-backup/manifest.json',raw)
        self.result['actual']['manifestSHA256']=m.sha(raw);self.raw=enc(self.result);self.write(self.root/'backup-result.json',self.raw)

    def options(self):
        return dict(runtime_root=self.runtime,reader=m.Reader(os.getuid(),self.f.root),hold_reader=lambda:self.b['hold'])

    def test_actual_hash_readback_returns_exact_raw_no_file_content(self):
        raw=m.observe(self.approval,**self.options())
        self.assertEqual(raw,self.raw)
        self.assertNotIn(b'FAKE_ONLY',raw)
        self.assertTrue(m.verify_backup_receipt(raw,self.approval,**self.options()))
        with self.assertRaisesRegex(ValueError,'RAW_BACKUP_RECEIPT_MISMATCH'):
            m.verify_backup_receipt(raw+b' ',self.approval,**self.options())

    def test_archive_hash_and_size_wrong(self):
        path=self.root/'host-backup/sandbox.tar';raw=path.read_bytes();self.write(path,b'X'+raw[1:])
        with self.assertRaisesRegex(ValueError,'ARCHIVE_HASH'):m.observe(self.approval,**self.options())
        self.write(path,raw+b'x')
        with self.assertRaisesRegex(ValueError,'FILE_SIZE'):m.observe(self.approval,**self.options())

    def test_symlink_and_hardlink_rejected(self):
        path=self.root/'host-backup/sandbox.tar';other=self.root/'saved.tar';path.rename(other);path.symlink_to(other)
        with self.assertRaises(OSError):m.observe(self.approval,**self.options())
        path.unlink();os.link(other,path)
        with self.assertRaisesRegex(ValueError,'UNTRUSTED_FILE'):m.observe(self.approval,**self.options())

    def test_manifest_path_escape_and_mode_rejected(self):
        self.manifest['dataArchives'][0]['backupFile']='../../outside';self.sync_manifest()
        with self.assertRaisesRegex(ValueError,'ARCHIVE_MANIFEST'):m.observe(self.approval,**self.options())
        self.manifest['dataArchives'][0]['backupFile']='sandbox.tar';self.sync_manifest()
        (self.root/'host-backup/sandbox.tar').chmod(0o644)
        with self.assertRaisesRegex(ValueError,'UNTRUSTED_FILE'):m.observe(self.approval,**self.options())

    def test_changed_hold_before_and_after_rejected(self):
        opts=self.options();opts['hold_reader']=lambda:{**self.b['hold'],'generation':'other'}
        with self.assertRaisesRegex(ValueError,'CURRENT_HOLD_CHANGED'):m.observe(self.approval,**opts)
        answers=iter([self.b['hold'],{**self.b['hold'],'state':'cleared'}]);opts=self.options();opts['hold_reader']=lambda:next(answers)
        with self.assertRaisesRegex(ValueError,'CURRENT_HOLD_CHANGED'):m.observe(self.approval,**opts)

    def test_no_result_and_summary_mismatch_do_not_synthesize(self):
        path=self.root/'backup-result.json';path.unlink()
        with self.assertRaises(FileNotFoundError):m.observe(self.approval,**self.options())
        self.result['actual']['path']=str(self.root/'other');self.sync_manifest()
        with self.assertRaisesRegex(ValueError,'BACKUP_SUMMARY_MISMATCH'):m.observe(self.approval,**self.options())

    def test_approval_source_and_code_pins_rejected(self):
        self.approval['identity']['attemptId']='other'
        with self.assertRaisesRegex(ValueError,'BINDING_IDENTITY'):m.observe(self.approval,**self.options())
        self.approval['identity']['attemptId']=self.b['attemptId'];self.approval['upgradeSha256']='f'*64
        with self.assertRaisesRegex(ValueError,'UPGRADE_PIN'):m.observe(self.approval,**self.options())

    def test_fixed_runtime_scope_and_expiry(self):
        self.approval['remoteRoot']=str(self.runtime/'../elsewhere')
        with self.assertRaisesRegex(ValueError,'RUNTIME_SCOPE'):m.observe(self.approval,**self.options())
        self.approval['remoteRoot']=str(self.root);self.approval['expiresAt']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=1)).isoformat()
        with self.assertRaisesRegex(ValueError,'APPROVAL_EXPIRED'):m.observe(self.approval,**self.options())

    def test_config_backup_hash_bound_to_original_binding(self):
        path=self.root/'host-backup/config'/self.manifest['configFiles'][0]['backupFile'];raw=path.read_bytes()
        self.write(path,b'X'+raw[1:])
        with self.assertRaisesRegex(ValueError,'CONFIG_HASH'):m.observe(self.approval,**self.options())


if __name__=='__main__':unittest.main()
