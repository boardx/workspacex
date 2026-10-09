import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_only', ROOT / 'scripts/cloud-build-only.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
SOURCE='a'*40
CONTROL='b'*40

def valid_plan():
    return dict(schemaVersion=2, sourceRevision=SOURCE, controlRevision=CONTROL, platform='linux/amd64',
                baseImages={key: tag.rsplit(':', 1)[0] + '@sha256:' + 'c'*64 for key, tag in m.BASES.items()},
                maxArchiveBytes=m.MAX_ARCHIVE, storageMarginBytes=m.MARGIN)

class BuildOnlyTests(unittest.TestCase):
    def setUp(self):
        m.DEADLINE=None; m.MEASUREMENT=None

    def fake(self, calls, failure=None):
        source_heads=0
        def execute(argv, env):
            nonlocal source_heads
            calls.append(argv)
            if argv[0]=='git':
                args=argv[3:] if argv[1]=='-C' else argv[1:]
                if args==['rev-parse','HEAD']:
                    if argv[1]=='-C': return 'd'*40 if failure=='control' else CONTROL
                    source_heads+=1
                    return 'd'*40 if failure=='source' or (failure=='drift' and source_heads>1) else SOURCE
                if args[:2]==['status','--porcelain']:return ' M source' if failure=='dirty' else ''
                if args[0]=='archive':
                    with tarfile.open(args[args.index('--output')+1],'w') as tar:
                        for path,_,_ in m.SERVICES.values():
                            info=tarfile.TarInfo(path);info.size=2;tar.addfile(info,io.BytesIO(b'ok'))
                        if failure=='link':
                            info=tarfile.TarInfo('escape');info.type=tarfile.SYMTYPE;info.linkname='/etc';tar.addfile(info)
                    return ''
            if argv[:3]==['docker','buildx','build']:
                if failure=='build':raise ValueError('BUILD_ONLY_COMMAND_FAILED')
                return ''
            if argv[:3]==['docker','image','inspect']:
                return json.dumps([{'Id':'sha256:'+'e'*64,'Size':True if failure=='size' else 123,
                    'Os':'linux','Architecture':'arm64' if failure=='platform' else 'amd64',
                    'Config':{'Labels':{'org.opencontainers.image.revision':'d'*40 if failure=='label' else SOURCE,
                                       'org.workspacex.scope':'build-only'}}}])
            if argv[:3]==['docker','image','save']:
                Path(argv[argv.index('--output')+1]).write_bytes(b'measurement-only');return ''
            if argv[:4]==['docker','buildx','imagetools','inspect']:return json.dumps({'digest':'sha256:'+'c'*64})
            raise AssertionError('Unapproved command '+repr(argv))
        return execute

    def run_build(self, output, calls, failure=None, value=None):
        with patch.object(m,'execute',self.fake(calls,failure)):
            m.build(value or valid_plan(),'api',output,{},'f'*64,SOURCE,CONTROL)

    def test_plan_explicit_identity_and_raw_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'plan';calls=[]
            with patch.object(m,'execute',self.fake(calls)):
                digest=m.plan(path,{},SOURCE,CONTROL)
            self.assertEqual(digest,hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(m.decode_plan(path.read_bytes(),digest),valid_plan())
            self.assertEqual(sum(cmd[:4]==['docker','buildx','imagetools','inspect'] for cmd in calls),3)

    def test_full_sha_required_and_no_frozen_old_source(self):
        for value in ['main','a'*39,'A'*40,'a'*40+'\n',None]:
            with self.assertRaises(ValueError):m.exact_sha(value)
        m.validate(valid_plan());self.assertFalse(hasattr(m,'APP'))

    def test_bad_plan_identity_bases_or_authority(self):
        patches=[{'schemaVersion':True},{'schemaVersion':1},{'platform':'linux/arm64'},
                 {'sourceRevision':'main'},{'controlRevision':'main'},{'registryPrefix':'production'},
                 {'maxArchiveBytes':m.MAX_ARCHIVE+1},{'storageMarginBytes':1}]
        for changes in patches:
            value=valid_plan();value.update(changes)
            with self.assertRaises(ValueError):m.validate(value)
        for base in ['node:22','private.invalid/node@sha256:'+'c'*64,None]:
            value=valid_plan();value['baseImages']['node']=base
            with self.assertRaises(ValueError):m.validate(value)

    def test_plan_tampering_duplicate_keys_or_oversize(self):
        raw=json.dumps(valid_plan()).encode()
        with self.assertRaisesRegex(ValueError,'PLAN_HASH_MISMATCH'):m.decode_plan(raw,'0'*64)
        duplicate=b'{"schemaVersion":2,"schemaVersion":2}'
        with self.assertRaisesRegex(ValueError,'DUPLICATE_PLAN_KEY'):m.decode_plan(duplicate,hashlib.sha256(duplicate).hexdigest())
        with self.assertRaises(ValueError):m.decode_plan(b'x'*16385,'f'*64)

    def test_five_measurements_are_not_release_receipts(self):
        for service in m.SERVICES:
            with self.subTest(service=service),tempfile.TemporaryDirectory() as tmp:
                calls=[];path=Path(tmp)/'result'
                with patch.object(m,'execute',self.fake(calls)):
                    m.build(valid_plan(),service,path,{},'f'*64,SOURCE,CONTROL)
                report=json.loads(path.read_text())
                for flag in ['ready','pushed','sealed','prepared','productionActivated','runtimeVerified','dockerSaveRetained']:
                    self.assertIs(report[flag],False)
                self.assertEqual(report['dockerSaveSizeBytes'],len(b'measurement-only'))
                self.assertEqual(report['planSha256'],'f'*64)
                self.assertIn('sampled',report['diskMeasurementScope'])
                for cmd in calls:
                    for forbidden in ['--push','push','login','sudo','--cache-to']:self.assertNotIn(forbidden,cmd)
                    self.assertIn(cmd[0],['git','docker'])

    def test_identity_failure_before_docker(self):
        for failure in ['source','control','dirty']:
            calls=[]
            with self.assertRaises(ValueError):self.run_build('unused',calls,failure)
            self.assertFalse(any(cmd[0]=='docker' for cmd in calls))

    def test_failed_build_bad_image_or_postbuild_drift_has_no_result(self):
        for failure in ['build','label','platform','size','drift','link']:
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'result'
                with self.assertRaises((ValueError,tarfile.FilterError)):self.run_build(path,[],failure)
                self.assertFalse(path.exists())

    def test_capacity_and_archive_limit_fail_closed(self):
        with patch.object(m.shutil,'disk_usage',return_value=type('Disk',(),{'free':1})()):
            calls=[]
            with self.assertRaisesRegex(ValueError,'BUILD_ONLY_CAPACITY'):self.run_build('unused',calls)
            self.assertFalse(any(cmd[0]=='docker' for cmd in calls))
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'data';path.write_bytes(b'abc')
            with patch.object(m,'MAX_ARCHIVE',2):
                with self.assertRaisesRegex(ValueError,'MEASUREMENT_ARCHIVE_LIMIT'):m.file_hash(path)

    def test_execute_discards_secret_stderr(self):
        with self.assertRaisesRegex(ValueError,'^BUILD_ONLY_COMMAND_FAILED$'):
            m.execute([sys.executable,'-c','import sys; sys.stderr.write("SECRET"); sys.exit(1)'],{})

    def test_execute_deadline(self):
        m.DEADLINE=time.monotonic()+.05
        with self.assertRaisesRegex(ValueError,'BUILD_ONLY_DEADLINE'):
            m.execute([sys.executable,'-c','import time; time.sleep(5)'],{})

    def test_workflow_manual_only_sha_bound_serial(self):
        workflow=(ROOT/'.github/workflows/cloud-build-only.yml').read_text()
        trigger=workflow.split('on:\n',1)[1].split('permissions:',1)[0]
        for event in ['pull_request','push','workflow_run','schedule']:self.assertNotIn(event+':',trigger)
        self.assertIn('source_sha:',trigger);self.assertIn('required: true',trigger)
        self.assertEqual(workflow.count("if: github.event_name == 'workflow_dispatch'"),2)
        self.assertEqual(workflow.count('[[ "$EVENT_NAME" == workflow_dispatch ]]'),2)
        self.assertIn('max-parallel: 1',workflow);self.assertIn('--plan-sha256 "$PLAN_SHA256"',workflow)
        self.assertIn('ref: ${{ needs.plan.outputs.source_sha }}',workflow)
        self.assertNotIn('ee7e682805c27a38e9fd601c4aca66f11763ba91',workflow)
        for forbidden in ['secrets.','vars.','environment:','self-hosted','contents: write','pull_request_target','docker push','sudo ']:self.assertNotIn(forbidden,workflow)

if __name__=='__main__':unittest.main()
