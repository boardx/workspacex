import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
C=load('collector',ROOT/'scripts/cn-release-mvp-trusted-collector.py')
fixture=load('entry_fixture',ROOT/'tests/test_cn_release_entry.py')


class TrustedCollector(unittest.TestCase):
    def payload(self):
        return dict(identity=dict(sourceRevision='a'*40,controlRevision='b'*40,releaseId='test',contentManifestSha256='c'*64),
            buildRunId=11,transferRunId=12,productionRunId=13,requestedAt='2026-10-14T04:00:00Z',deadlineAt='2026-10-14T04:30:00Z')

    def record(self):
        return dict(id=13,repository={'full_name':'boardx/workspacex'},path='.github/workflows/release-cn-fixed.yml',
            head_sha='b'*40,head_branch='main',event='workflow_dispatch',run_attempt=1,
            display_title='cn-mvp-test-production',created_at='2026-10-14T04:01:00Z',status='completed',conclusion='success')

    def test_provider_uses_pinned_host_profile_not_hk_policy_binary(self):
        release='d'*64;host={'ghExecutable':'/usr/local/bin/gh','ghSha256':'e'*64,'authentication':'existing-root-gh'}
        profile={'identity':{'sourceRevision':'a'*40,'controlRevision':'b'*40},'githubProvider':host}
        raw=C.E.encode(profile);approval={'identity':profile['identity'],'mvp':{'stageInputs':{'profileSha256':C.E.sha(raw)}}}
        paths=[]
        def read(path):paths.append(path);return raw
        sentinel=object()
        with patch.object(C,'protected_github',return_value=sentinel)as protected:
            self.assertIs(C.provider_for(approval,release,read),sentinel);protected.assert_called_once_with(host)
        self.assertEqual(paths,[Path('/var/lib/workspacex-cn/release-inputs')/release/'mvp-profile.json'])
        approval['mvp']['stageInputs']['profileSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'HOST_PROVIDER_PROFILE_PIN'):C.provider_for(approval,release,read)

    def test_host_profile_missing_or_credential_transfer_mode_rejected(self):
        with self.assertRaisesRegex(ValueError,'HOST_PROVIDER_PROFILE'):C.validate_host_provider(None)
        host={'ghExecutable':'/usr/local/bin/gh','ghSha256':'e'*64,'authentication':'copy-hk-token'}
        with self.assertRaisesRegex(ValueError,'HOST_PROVIDER_PROFILE'):C.validate_host_provider(host)
        host['authentication']='existing-root-gh';host['ghExecutable']='relative/gh'
        with self.assertRaisesRegex(ValueError,'HOST_PROVIDER_BINARY_PIN'):C.validate_host_provider(host)

    def test_actual_provider_context_bound_and_never_authority(self):
        payload=self.payload();approval={'identity':dict(sourceRevision='a'*40,controlRevision='b'*40,requestedAt=payload['requestedAt'],deadlineAt=payload['deadlineAt'])}
        calls=[]
        def provider(endpoint):calls.append(endpoint);return self.record()
        value=C.production_context(approval,'d'*64,payload,provider,completed=True)
        self.assertFalse(value['authorityGranted']);self.assertEqual(calls,['/repos/boardx/workspacex/actions/runs/13/attempts/1'])
        for key,value in [('head_sha','f'*40),('display_title','cn-mvp-other-production'),('run_attempt',2),('conclusion','failure'),('created_at','2026-10-14T03:59:59Z')]:
            record=self.record();record[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):C.production_context(approval,'d'*64,payload,lambda _:record,completed=True)

    def test_real_process_historical_admission_and_file_tamper(self):
        helper=fixture.EntryTests(methodName='runTest');helper.setUp()
        try:
            request=helper.package();helper.advance(request)
            receipt_path=helper.state/'test-one/00-consume.receipt.json'
            manifest,_=fixture.e.load_package(request,'test-one')
            raw=receipt_path.read_bytes();manifest_raw=fixture.e.encode(manifest)
            objects={C.E.sha(raw):raw,C.E.sha(manifest_raw):manifest_raw}
            bundle={'originals':{'durableReceipt':C.E.sha(raw),'durableManifest':C.E.sha(manifest_raw)}}
            self.assertEqual(C.historical(bundle,objects,fixture.e)['requestSha256'],request)
            admission=receipt_path.with_name('00-consume.admission.json')
            admission.write_bytes(b'{"invented":true}');admission.chmod(0o600)
            with self.assertRaises(fixture.e.Rejected):C.historical(bundle,objects,fixture.e)
        finally:helper.doCleanups()

    def test_missing_history_never_accepted(self):
        helper=fixture.EntryTests(methodName='runTest');helper.setUp()
        try:
            request=helper.package();helper.advance(request)
            path=helper.state/'test-one/00-consume.receipt.json';raw=path.read_bytes()
            manifest,_=fixture.e.load_package(request,'test-one');mr=fixture.e.encode(manifest)
            bundle={'originals':{'durableReceipt':C.E.sha(raw),'durableManifest':C.E.sha(mr)}}
            path.unlink()
            with self.assertRaises(OSError):C.historical(bundle,{C.E.sha(raw):raw,C.E.sha(mr):mr},fixture.e)
        finally:helper.doCleanups()

    def test_dynamic_context_from_provider_list_retains_one_private_file(self):
        payload=self.payload();profile={'identity':payload['identity'],'productionCorrelation':'cn-mvp-test-production'}
        raw=(json.dumps(profile)+'\n').encode();policy=b'{"fixture":"provider-standin"}'
        approval={'identity':dict(sourceRevision='a'*40,controlRevision='b'*40,requestedAt=payload['requestedAt'],deadlineAt=payload['deadlineAt']),
            'mvp':dict(buildRunId=11,transferRunId=12,stageInputs={'profileSha256':C.E.sha(raw)}),
            'acquire':{'requests':{'consume':{'inputs':{'policy':C.E.sha(policy)}}}}}
        release='d'*64;inputs=Path('/var/lib/workspacex-cn/release-inputs')/release
        reads={inputs/'mvp-profile.json':raw,inputs/'policy.json':policy}
        record=self.record();record['status']='in_progress';record['conclusion']=None
        def provider(endpoint):
            return {'workflow_runs':[dict(record,jobs_url='listing-url')]}if '/workflows/'in endpoint else dict(record,jobs_url='attempt-url')
        with tempfile.TemporaryDirectory()as folder:
            path=Path(folder)/'context.json'
            def writer(fixed,content):
                self.assertEqual(fixed,Path('/var/lib/workspacex-cn/release-generated')/release/'mvp-production-run.json')
                with path.open('xb')as f:f.write(content)
                path.chmod(0o600)
            context=C.ensure_production_context(approval,release,profile,reader=reads.__getitem__,github=provider,writer=writer)
            self.assertEqual(context['productionRunId'],13);self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertFalse(json.loads(path.read_bytes())['authorityGranted'])
        with self.assertRaisesRegex(ValueError,'CONTEXT_UNIQUE_RUN_REQUIRED'):
            C.ensure_production_context(approval,release,profile,reader=reads.__getitem__,github=lambda _:{'workflow_runs':[record,record]},writer=lambda *_:None)

    def test_root_hook_original_closure_rejects_replacement(self):
        release='d'*64;payload=self.payload();approval={'identity':{'attemptId':'test-one'}};switch={'requestSha256':'e'*64}
        root=Path('/var/lib/workspacex-cn/release-generated')/release/'mvp-stages'
        names={'schema.json','schema-request.json','content/request.json','content/preflight.json','content/apply.json','content/readback.json','content/backup.json'}
        values={name:b'{}'for name in names};values['schema.json']=C.E.encode({'productionRunId':13})
        payload['identity']['contentManifestSha256']=C.E.sha(values['content/request.json'])
        switchraw=(json.dumps(switch)+'\n').encode();switchpath=Path('/var/lib/workspacex-cn/continuation/test-one/13-switch.receipt.json')
        receipt=dict(kind='cn-mvp-held-content-hook-v1',releaseSha256=release,switchReceiptSha256=C.E.sha(switchraw),
            originals={name:C.E.sha(value)for name,value in values.items()},schemaReadbackPassed=True,contentReadbackPassed=True,fullBusinessAcceptance=False)
        reads={root/name:value for name,value in values.items()};reads[root/'held-content.json']=C.E.encode(receipt);reads[switchpath]=switchraw
        reads[root/'intent.json']=C.E.encode(dict(releaseSha256=release,switchReceiptSha256=C.E.sha(switchraw),automaticRetry=False))
        C.verify_retained_hooks(approval,release,switch,payload,values['schema.json'],values['content/readback.json'],reader=reads.__getitem__)
        reads[root/'content/apply.json']=b'{"changed":true}'
        with self.assertRaisesRegex(ValueError,'HOOK_ORIGINAL_CHANGED'):
            C.verify_retained_hooks(approval,release,switch,payload,values['schema.json'],values['content/readback.json'],reader=reads.__getitem__)

if __name__=='__main__':unittest.main()
