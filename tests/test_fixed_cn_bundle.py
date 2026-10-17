"""Real tar bytes through canonical admission and actual fixed staging adapter."""
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import test_cn_image_candidate as fixtures
import fixed_cn_bundle as b
import cn_image_archive as a
import cn_image_candidate as c


class Bundle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.src = self.root / 'original'; self.src.mkdir()
        self.plan = fixtures.plan()
        self.plan.update(sourceRevision=b.fixed.SOURCE, controlRevision=b.fixed.CONTROL)
        labels = {'org.opencontainers.image.revision': b.fixed.SOURCE, c.LABEL: c.identity(self.plan)}
        self.images = {r: fixtures.archive(self.src / (r + '.tar'), self.plan, r, labels)
                       for r in b.fixed.ROLES}
        self.pr = a.json_bytes(self.plan)
        self.cr = a.json_bytes(fixtures.receipt(self.plan, self.images))
        self.inventory = dict(kind='github-metadata-only', run=b.fixed.RUN,
            control=b.fixed.CONTROL, expectedSource=b.fixed.SOURCE,
            observedAt=dt.datetime.now(dt.timezone.utc).isoformat(),
            artifacts=[dict(id=i+1, name=f'cn-image-candidate-{r}-{b.fixed.RUN}-1',
                            expires_at='2030-01-01T00:00:00Z') for i,r in enumerate(b.fixed.ROLES)])

    def tearDown(self):
        self.tmp.cleanup()

    def stage(self, out='staged'):
        return b.stage(self.src, self.pr, a.sha(self.pr), self.cr, a.sha(self.cr),
                       self.inventory, self.root / out)

    def test_real_bytes_manifest_and_replay(self):
        result = self.stage()
        self.assertEqual(result['status'], 'LOCAL_ARCHIVES_STAGED')
        out = self.root / 'staged'
        manifest = json.loads((out / 'manifest.json').read_bytes())
        self.assertEqual(a.sha((out / 'manifest.json').read_bytes()), result['manifestSha256'])
        self.assertEqual(set(manifest['images']), set(b.fixed.ROLES))
        for role in b.fixed.ROLES:
            self.assertEqual((out/(role+'.tar')).read_bytes(), (self.src/(role+'.tar')).read_bytes())
            self.assertEqual(manifest['images'][role]['imageId'], self.images[role]['imageId'])
        self.assertFalse(result['productionTransferPerformed'])
        with self.assertRaises(FileExistsError): self.stage()

    def test_wrong_candidate_or_control_no_output(self):
        for field in ('sourceRevision','controlRevision'):
            with self.subTest(field=field):
                original=self.pr
                value=dict(self.plan);value[field]='f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
                self.pr=a.json_bytes(value)
                with self.assertRaises(a.Rejected): self.stage(field)
                self.assertFalse((self.root/field).exists())
                self.pr=original

    def test_tampered_archive_before_copy(self):
        with (self.src/'api.tar').open('ab') as f:f.write(b'tampered')
        with self.assertRaises(a.Rejected): self.stage()
        self.assertFalse((self.root/'staged').exists())

    def test_expiry_missing_artifact_stale_observation(self):
        for mode in ('expiry','missing','stale'):
            with self.subTest(mode=mode):
                original=json.loads(json.dumps(self.inventory))
                if mode=='expiry': self.inventory['artifacts'][0]['expires_at']='2020-01-01T00:00:00Z'
                if mode=='missing': self.inventory['artifacts'].pop()
                if mode=='stale': self.inventory['observedAt']='2020-01-01T00:00:00Z'
                with self.assertRaises(a.Rejected): self.stage(mode)
                self.assertFalse((self.root/mode/'stage-receipt.json').exists())
                self.inventory=original

    def test_copy_drift_retains_failure_intent(self):
        original=c.verify_bundle
        calls=[]
        def after_verify(*args,**kwargs):
            result=original(*args,**kwargs)
            calls.append(1)
            if len(calls)==1:
                with (self.src/'api.tar').open('r+b') as f:f.write(b'bad')
            return result
        with patch.object(c,'verify_bundle',side_effect=after_verify):
            with self.assertRaises(a.Rejected):self.stage()
        self.assertTrue((self.root/'staged/stage-intent.json').exists())
        self.assertTrue((self.root/'staged/stage-failure.json').exists())
        self.assertFalse((self.root/'staged/stage-receipt.json').exists())

    def test_local_stage_cli(self):
        import subprocess,sys
        plan=self.root/'plan.json';plan.write_bytes(self.pr)
        candidate=self.root/'candidate.json';candidate.write_bytes(self.cr)
        inventory=self.root/'inventory.json';inventory.write_text(json.dumps(self.inventory))
        request=self.root/'request.json'
        request.write_text(json.dumps(dict(bundle=str(self.src),plan=str(plan),planSha256=a.sha(self.pr),
            candidate=str(candidate),candidateSha256=a.sha(self.cr),inventory=str(inventory),output=str(self.root/'cli-out'))))
        proc=subprocess.run([sys.executable,'-I','-B',str(b.Path(b.__file__).with_name('fixed-cn-release.py')),
            'stage-local','--request',str(request)],capture_output=True,text=True,timeout=10)
        self.assertEqual(proc.returncode,0,proc.stdout)
        self.assertEqual(json.loads(proc.stdout)['status'],'LOCAL_ARCHIVES_STAGED')

    def test_original_receipt_expiry_not_refreshed(self):
        value=json.loads(self.cr)
        value['producedAt']='2020-01-01T00:00:00Z';value['expiresAt']='2020-01-01T01:00:00Z'
        self.cr=a.json_bytes(value)
        with self.assertRaises(a.Rejected):self.stage()
        self.assertFalse((self.root/'staged').exists())


class HostCommands(unittest.TestCase):
    def test_exact_existing_entries_and_separate_approval(self):
        import fixed_cn_host_commands as host
        plan=fixtures.plan();plan.update(sourceRevision=b.fixed.SOURCE,controlRevision=b.fixed.CONTROL)
        raw=a.json_bytes(plan)
        for operation in ('download-check','image-download','publication-check','image-publication'):
            with self.subTest(operation=operation):
                command=host.prepare(raw,a.sha(raw),operation,'1'*64)
                self.assertEqual(command['argv'][:4],['/usr/bin/python3','-I','-S','-B'])
                self.assertEqual(command['target'],b.fixed.TARGET)
                self.assertFalse(command['executionPerformed'])
                self.assertFalse(command['approvalValidated'])
        for operation,pin in [('compose-up','1'*64),('image-download','')]:
            with self.assertRaises(a.Rejected):host.prepare(raw,a.sha(raw),operation,pin)

if __name__=='__main__':unittest.main()
