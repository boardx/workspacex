"""Real Git/object and filesystem rejection tests for source packaging."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('package_runtime',ROOT/'scripts/cn-package-runtime.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class PackageContracts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.repo=self.root/'repo';self.repo.mkdir()
        self.git('init','-q');self.git('config','user.name','package-fixture')
        self.git('config','user.email','package-fixture@example.invalid')
        path=self.repo/'apps/api/migrations/001.sql';path.parent.mkdir(parents=True);path.write_text('select 1;')
        path=self.repo/'skills/starter-packs/example/1.json';path.parent.mkdir(parents=True);path.write_text('{}')
        self.git('add','.');self.git('commit','-qm','first')
        self.old=self.git('rev-parse','HEAD')
        (self.repo/'apps/api/migrations/001.sql').write_text('select 2;')
        self.git('commit','-qam','second');self.revision=self.git('rev-parse','HEAD')

    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.DEVNULL,text=True).strip()

    def test_exact_commit_tree_blobs_without_history_or_checkout_auth(self):
        self.git('config','http.https://github.com/.extraheader','fixture-do-not-copy')
        (self.repo/'.git/hooks/private-marker').write_text('fixture')
        dest=self.root/'stage';dest.mkdir()
        m.minimal_git(self.repo,self.revision,dest)
        self.assertEqual(m.run(['git','rev-parse','HEAD'],dest).decode().strip(),self.revision)
        self.assertEqual(m.run(['git','show',self.revision+':apps/api/migrations/001.sql'],dest),b'select 2;')
        self.assertEqual(m.run(['git','ls-files','--error-unmatch','apps/api/migrations/001.sql'],dest),b'apps/api/migrations/001.sql\n')
        self.assertNotIn(b'fixture-do-not-copy',(dest/'.git/config').read_bytes())
        self.assertFalse((dest/'.git/hooks').exists())
        with self.assertRaises(ValueError):m.run(['git','cat-file','-e',self.old],dest)

    def test_source_snapshot_uses_commit_bytes_not_dirty_worktree(self):
        (self.repo/'apps/api/migrations/001.sql').write_text('uncommitted')
        rows=m.source_files(self.repo,self.revision)
        self.assertEqual(rows['apps/api/migrations/001.sql'],b'select 2;')
        self.assertEqual(rows['skills/starter-packs/example/1.json'],b'{}')

    def test_dirty_control_and_between_check_and_copy_tamper_rejected(self):
        m.require_clean(self.repo,self.revision)
        name='apps/api/migrations/001.sql';(self.repo/name).write_text('uncommitted')
        with self.assertRaisesRegex(ValueError,'TRACKED_WORKTREE_DIRTY'):m.require_clean(self.repo,self.revision)
        with self.assertRaisesRegex(ValueError,'COPIED_SOURCE_DIFFERS_FROM_COMMIT'):
            m.copy_commit_file(self.repo,name,self.revision,self.root/'stage')

    def test_error_retains_missing_module_identity_without_raw_environment(self):
        raw=b"Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'example-module' imported from /safe/stage/apps/api/core.ts\nTOKEN=do-not-retain\npostgres://secret"
        result=m.safe_error(raw,Path('/safe/stage'))
        self.assertEqual(result,{'errorCode':'ERR_MODULE_NOT_FOUND','missingPackage':'example-module','importerRelativeFile':'apps/api/core.ts'})
        self.assertNotIn('secret',str(result));self.assertNotIn('TOKEN',str(result))
        self.assertEqual(m.safe_error(b'MISSING_REQUIRED_PACKAGE:<runtime>',Path('/safe/stage')),
                         {'errorCode':'MISSING_REQUIRED_PACKAGE','syntheticRuntimeEdge':True})
        for name in ('/private/example', '../example', './example'):
            self.assertEqual(m.safe_error(('MISSING_REQUIRED_PACKAGE:'+name).encode(),Path('/safe/stage')),
                             {'errorCode':'MISSING_REQUIRED_PACKAGE'})
        self.assertEqual(m.safe_error(b'MISSING_REQUIRED_PACKAGE:@scope/example',Path('/safe/stage')),
                         {'errorCode':'MISSING_REQUIRED_PACKAGE','missingPackage':'@scope/example'})

    def test_source_snapshot_rejects_symlink(self):
        path=self.repo/'skills/starter-packs/link.json';path.symlink_to('example/1.json')
        self.git('add','.');self.git('commit','-qm','link')
        with self.assertRaisesRegex(ValueError,'SOURCE_FILE_KIND'):
            m.source_files(self.repo,self.git('rev-parse','HEAD'))

    def test_manifest_rejects_external_or_missing_links(self):
        dest=self.root/'payload';dest.mkdir();(dest/'escape').symlink_to(self.repo)
        with self.assertRaisesRegex(ValueError,'PACKAGE_LINK_ESCAPE'):
            m.manifest(dest)
        (dest/'escape').unlink();(dest/'broken').symlink_to('absent')
        with self.assertRaisesRegex(ValueError,'PACKAGE_LINK_ESCAPE'):
            m.manifest(dest)

    def test_copy_rejects_paths_and_symlink_bytes(self):
        with self.assertRaisesRegex(ValueError,'PACKAGE_PATH'):m.copy_file(self.repo,'../escape',self.root/'out')
        path=self.repo/'link';path.symlink_to('apps/api/migrations/001.sql')
        with self.assertRaisesRegex(ValueError,'PACKAGE_FILE_UNSAFE'):m.copy_file(self.repo,'link',self.root/'out')

    def test_archive_deterministic_and_keeps_internal_link(self):
        dest=self.root/'payload';dest.mkdir();(dest/'data').write_bytes(b'actual-bytes')
        (dest/'alias').symlink_to('data')
        first=self.root/'one.gz';second=self.root/'two.gz'
        m.make_archive(dest,first);m.make_archive(dest,second)
        self.assertEqual(first.read_bytes(),second.read_bytes())
        self.assertEqual(m.manifest(dest)['alias'],m.digest(b'actual-bytes'))


if __name__=='__main__':unittest.main()
