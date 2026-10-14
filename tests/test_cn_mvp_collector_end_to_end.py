"""Seven-stage isolated collection: real files/ZIP/processes, provider stand-in.

No production credentials, database, API or host is used. A successful fixture
means the plumbing is exercised, never production acceptance.
"""
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(Path(__file__).parent))
import test_cn_candidate_revalidation as zipfixture
import test_cn_release_entry as entryfixture

def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
C=load('cn-release-mvp-trusted-collector');P=load('cn-release-mvp-original-producer')
raw=C.E.encode

class SevenStageCollection(unittest.TestCase):
    def setUp(self):
        self.build_id=getattr(self,'build_id',456);self.transfer_id=getattr(self,'transfer_id',457)
        self.production_id=getattr(self,'production_id',458);self.release_id=getattr(self,'release_id','isolated-all')
        self.artifact_offset=getattr(self,'artifact_offset',0);self.metadata_id=99+self.artifact_offset
        self.entries=entryfixture.EntryTests(methodName='runTest');self.entries.setUp();self.addCleanup(self.entries.doCleanups)
        self.zip=zipfixture.RevalidationTests(methodName='runTest')
        source=getattr(self,'source_revision',zipfixture.c.SOURCE)
        original_plan=zipfixture.plan;original_archive=zipfixture.archive
        def source_plan():return dict(original_plan(),sourceRevision=source)
        def source_archive(path,plan,service):
            return original_archive(path,plan,service,labels={'org.opencontainers.image.revision':source,zipfixture.c.LABEL:zipfixture.c.identity(plan)})
        with patch.object(zipfixture,'plan',source_plan),patch.object(zipfixture,'archive',source_archive):self.zip.setUp()
        self.addCleanup(self.zip.doCleanups)
        self.zip.policy['runId']=self.build_id
        self.zip.policy['artifactIds']={name:ident+self.artifact_offset for name,ident in self.zip.policy['artifactIds'].items()}
        self.zip.provider=zipfixture.Provider(self.zip.policy,self.zip.files)
        self.zip.policy['verifierRevision']=self.zip.plan['controlRevision']
        proof=self.zip.produce();self.proof=proof
        start=dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=10)
        self.start=start.isoformat();self.end=(start+dt.timedelta(minutes=25)).isoformat()
        self.request=dict(sourceRevision=self.zip.plan['sourceRevision'],releaseId=self.release_id,targetOrgId='org-platform',
            acceptanceScope='mvp-non-model',skippedTests=['real-model','ai-output-quality'],officialRolePackDigest=None,packRefs=[],workflows=[])
        identity=dict(sourceRevision=self.zip.plan['sourceRevision'],controlRevision=self.zip.plan['controlRevision'],releaseId=self.release_id,contentManifestSha256=C.E.sha(raw(self.request)))
        self.payload=dict(identity=identity,buildRunId=self.build_id,transferRunId=self.transfer_id,productionRunId=self.production_id,requestedAt=self.start,deadlineAt=self.end)
        self.objects={};self.bundles={};self.virtual=self.entries.root/'virtual';self.virtual.mkdir(mode=0o700)
        self.real_read=entryfixture.e.read
        self.codecopy=self.entries.root/'code';self.codecopy.mkdir(mode=0o700)
        rel='scripts/cn-release-mvp-trusted-collector.py';path=self.codecopy/rel;path.parent.mkdir();path.write_bytes((ROOT/rel).read_bytes());path.chmod(0o600)
        self.approval=dict(kind='cn-fixed-release-approval-v1',identity=dict(sourceRevision=identity['sourceRevision'],controlRevision=identity['controlRevision'],
            baselineRevision='c'*40,attemptId='test-all',requestedAt=self.start,deadlineAt=self.end),target=dict(accountId='1177216024653153',region='cn-shanghai',ecsInstanceId='i-uf6ga92ewloganobbln6'),
            codeFiles={rel:C.E.sha(path.read_bytes())},mvp=dict(acceptanceScope='mvp-non-model',contentManifestSha256=identity['contentManifestSha256'],buildRunId=self.build_id,transferRunId=self.transfer_id),
            acquire={'requests':{'consume':{'inputs':{'plan':C.E.sha(self.zip.plan_raw),'proof':C.E.sha(proof),'policy':C.E.sha(self.zip.policy_raw)}}}})
        self.authorization=raw(self.approval);self.release=C.E.sha(self.authorization)
        self.write(Path('/etc/workspacex-cn/release-approvals')/(self.release+'.json'),self.authorization)
        self.rds=self.rds_originals(start,identity)
        self.schema=dict(kind='cn-mvp-schema-readback-v1',identity=identity,productionRunId=self.production_id,schemaLedgerSha256='d'*64,expectedLedgerSha256='d'*64,schemaReadbackPassed=True,productionWrites=False)
        self.content=dict(kind='cn-platform-content-release-receipt-v1',mode='readback',sourceRevision=identity['sourceRevision'],requestSha256=identity['contentManifestSha256'],
            receipt=dict(skillVersions=0,roleVersions=0,workflows=0,pendingBindings=0,contentReadbackPassed=True,acceptanceScope='mvp-non-model',realModel='SKIPPED',aiOutputQuality='SKIPPED',skillVerificationPromotion='NOT_PERFORMED',fullBusinessAcceptance=False))
        self.acceptance=dict(kind='cn-mvp-nonmodel-receipt-v1',identity=identity,productionRunId=self.production_id,checks={k:'PASSED'for k in ('tenant_protection','login','permissions','fixed_api_behavior')},observations=[{'statusCode':200,'provider':'isolated-standin'}],modelQuality='SKIPPED',futureV2Content='NOT_APPLICABLE')
        self.emit_history()
        self.emit_bundles()
        self.emit_hooks()
        self.emit_manifest()
        self.provider_calls=[]

    def mapped(self,path):
        path=Path(path)
        if str(path).startswith('/var/lib/workspacex-cn/continuation/'):
            return self.entries.state/Path(str(path).removeprefix('/var/lib/workspacex-cn/continuation/'))
        return self.virtual/str(path).lstrip('/')

    def write(self,path,value):
        target=self.mapped(path);target.parent.mkdir(mode=0o700,parents=True,exist_ok=True);target.write_bytes(value);target.chmod(0o600)

    def reader(self,path):return self.real_read(self.mapped(path))

    def entry_read(self,path,limit=entryfixture.e.MAX):
        path=Path(path)
        if path==ROOT/'scripts/cn-release-mvp-trusted-collector.py':path=self.codecopy/'scripts/cn-release-mvp-trusted-collector.py'
        return self.real_read(path,limit)

    def put(self,value):
        value=value if isinstance(value,bytes)else raw(value);pin=C.E.sha(value);self.objects[pin]=value;return pin

    def bundle(self,stage,originals):
        self.bundles[stage]=raw(dict(kind='cn-mvp-stage-evidence-v1',stage=stage,binding=self.payload,originals={role:self.put(value)for role,value in originals.items()}))

    def runrecord(self,ident,path):
        return dict(id=ident,repository={'full_name':'boardx/workspacex'},path=path,event='workflow_dispatch',head_branch='main',head_sha=self.payload['identity']['controlRevision'],run_attempt=1,status='completed',conclusion='success',created_at=self.start)

    def rds_originals(self,start,identity):
        create=(start+dt.timedelta(seconds=1)).isoformat();begin=(start+dt.timedelta(seconds=2)).isoformat();end=(start+dt.timedelta(seconds=3)).isoformat()
        snapshot=dict(DBInstanceId='pgm-uf6rg214cp381l49',BackupId='456',BackupMethod='Snapshot',BackupType='FullBackup',BackupMode='Manual',BackupStatus='Success',MetaStatus='OK',BackupStartTime=begin,BackupEndTime=end)
        providers=dict(intent={'createdAt':create,'attemptId':'test-all'},dispatch={'BackupJobId':'123','RequestId':'create-standin'},
            stopReceiptSha256={'knownFiveStopped':True,'otherDatabaseClientSessions':0,'holdGeneration':'isolated-epoch'},holdReceiptSha256={'state':'held','generation':'isolated-epoch','identity':identity},
            task={'RequestId':'task-standin','Items':{'BackupJob':[dict(BackupJobId='123',BackupStatus='Finished',JobMode='Manual',BackupId='456')]}},pages=[dict(RequestId='page-standin',TotalRecordCount=1,PageNumber=1,PageRecordCount=1,Items={'Backup':[snapshot]})])
        originals={};refs={}
        for key,value in providers.items():
            if isinstance(value,list):
                refs[key]=[C.E.sha(raw(v))for v in value]
                for i,v in enumerate(value):originals['rds-'+key+'-'+str(i)]=v
            else:refs[key]=C.E.sha(raw(value));originals['rds-'+key]=value
        originals['rdsReceipt']=dict(dbInstanceId=snapshot['DBInstanceId'],backupId='456',backupStatus='Success',metaStatus='OK',backupStartTime=begin,backupEndTime=end,isolatedRestoreTested=False,requestedBackupJobId='123',providerRequestId='create-standin',originalEvidenceSha256=refs,createIntentCreatedAt=create,attemptId='test-all',holdGeneration='isolated-epoch')
        return originals

    def emit_history(self):
        e=entryfixture.e;self.history={};previous=None
        verifier=b"import json\ndef verify(raw,manifest,previous,mode):\n json.loads(raw)\n return {'externalWritesTerminal':True} if mode=='terminal' else True\n"
        for stage in e.STAGES:
            evidence=self.rds['rdsReceipt']if stage=='rds-backup'else self.acceptance if stage=='observe'else {'isolatedFixture':stage}
            action=('printf %s '+shlex.quote(raw(evidence).decode())+'\n').encode()
            manifest=dict(schemaVersion=1,sourceRevision=self.payload['identity']['sourceRevision'],baselineRevision='c'*40,controlRevision=self.payload['identity']['controlRevision'],attemptId='test-all',scope='runtime-only-reviewed-continuation',stage=stage,
                previousReceiptSha256=previous,issuedAt=self.start,expiresAt=self.end,requestedAt=self.start,deadlineAt=self.end,timeoutSeconds=3,actionSha256=e.digest(action),observerSha256=e.digest(action),verifierSha256=e.digest(verifier),authorizationEvidenceSha256=e.digest(self.authorization))
            manifest_raw=e.encode(manifest);request=e.digest(manifest_raw);folder=self.entries.requests/request;folder.mkdir(mode=0o700)
            for name,value in [('manifest.json',manifest_raw),('action.sh',action),('observe.sh',action),('verify.py',verifier),('authorization.json',self.authorization)]:e.create(folder/name,value)
            e.entry('advance',request,'test-all')
            prefix=self.entries.state/'test-all'/('%02d-%s'%(e.STAGES.index(stage),stage))
            originals={'durableManifest':manifest_raw}
            for role,suffix in [('durableReceipt','.receipt.json'),('durableEvidence','.evidence.json'),('durableObservation','.terminal-observation.json'),('durableIntent','.intent.json'),('durableProcess','.process.json'),('durableAdmission','.admission.json')]:originals[role]=Path(str(prefix)+suffix).read_bytes()
            self.history[stage]=originals;previous=C.E.sha(originals['durableReceipt'])

    def emit_bundles(self):
        listing={'total_count':7,'artifacts':list(self.zip.provider.metadata.values())}
        buildrun=self.runrecord(self.build_id,'.github/workflows/build-cn-image-candidates.yml')
        self.bundle('build',dict(run=buildrun,artifacts=listing,candidatePlan=self.zip.plan_raw))
        template={k:self.zip.policy[k]for k in ('runId','runAttempt','controlRevision','verifierRevision','artifactIds')}
        proof=json.loads(self.proof)
        plan=dict(kind='hk-original-artifact-transfer-v3',sourceRun=self.build_id,sourceRunAttempt=1,sourceRevision=self.payload['identity']['sourceRevision'],producerControl=self.payload['identity']['controlRevision'],candidatePlanRawSha256=proof['candidatePlanRawSha256'],revalidationTemplateSha256=C.E.sha(raw(template)),artifacts={k:dict(id=v['artifactId'],bytes=v['zipBytes'],sha256=v['zipSha256'])for k,v in proof['github']['artifacts'].items()})
        transfer=dict(run=self.runrecord(self.transfer_id,'.github/workflows/transfer-cn-candidates-via-hongkong.yml'),plan=plan,template=template,proof=self.proof,policy=self.zip.policy_raw)
        self.bundle('transfer',transfer)
        self.metadata_members={'upload-plan.json':raw(plan),'hk-template.json':raw(template),'proof.json':self.proof,'policy.json':self.zip.policy_raw,'receipt.json':raw({'isolatedProviderStandin':True})}
        self.metadata_zip=zipfixture.zipped(self.metadata_members)
        self.metadata_record=dict(id=self.metadata_id,name=f'cn-hk-originals-{self.transfer_id}-1',expired=False,digest='sha256:'+C.E.sha(self.metadata_zip),size_in_bytes=len(self.metadata_zip),workflow_run={'id':self.transfer_id,'head_sha':self.payload['identity']['controlRevision']})
        self.bundle('backup',dict(self.rds,**self.history['rds-backup']))
        self.bundle('deploy',self.history['switch'])
        self.bundle('schema',{'readback':self.schema})
        self.bundle('content',{'request':self.request,'readback':self.content})
        self.bundle('acceptance',dict(readback=self.acceptance,**self.history['observe']))

    def emit_hooks(self):
        root=Path('/var/lib/workspacex-cn/release-generated')/self.release/'mvp-stages'
        values={'schema.json':raw(self.schema),'schema-request.json':raw({'productionRunId':self.production_id}),'content/request.json':raw(self.request),'content/preflight.json':raw({'isolated':'preflight'}),'content/apply.json':raw({'isolated':'apply'}),'content/readback.json':raw(self.content),'content/backup.json':raw({'isolated':'backup'})}
        for name,value in values.items():self.write(root/name,value)
        switch=C.E.sha(self.history['switch']['durableReceipt'])
        receipt=dict(kind='cn-mvp-held-content-hook-v1',releaseSha256=self.release,switchReceiptSha256=switch,originals={name:C.E.sha(value)for name,value in values.items()},schemaReadbackPassed=True,contentReadbackPassed=True,fullBusinessAcceptance=False)
        self.write(root/'held-content.json',raw(receipt));self.write(root/'intent.json',raw(dict(releaseSha256=self.release,switchReceiptSha256=switch,automaticRetry=False)))

    def emit_manifest(self):
        root=Path('/var/lib/workspacex-cn/release-generated')/self.release/'mvp-originals'
        for value in list(self.objects.values())+list(self.bundles.values()):self.write(root/'objects'/(C.E.sha(value)+'.json'),value)
        manifest=dict(kind='cn-mvp-admitted-original-manifest-v1',releaseSha256=self.release,binding=self.payload,bundles={stage:C.E.sha(value)for stage,value in self.bundles.items()},objects=list(self.objects))
        self.write(root/'manifest.json',raw(manifest))

    def provider(self,endpoint,target=None,limit=None):
        self.provider_calls.append(endpoint)
        if target is not None:
            ident=int(endpoint.split('/')[-2]);value=self.metadata_zip if ident==self.metadata_id else self.zip.provider.blobs[ident]
            self.assertEqual(len(value),limit);target.write_bytes(value);target.chmod(0o600);return
        if endpoint.endswith('/artifacts/'+str(self.metadata_id)):return copy.deepcopy(self.metadata_record)
        if f'/runs/{self.transfer_id}/artifacts' in endpoint:return {'total_count':1,'artifacts':[copy.deepcopy(self.metadata_record)]}
        if f'/runs/{self.build_id}/artifacts' in endpoint:return copy.deepcopy({'total_count':7,'artifacts':list(self.zip.provider.metadata.values())})
        if f'/runs/{self.production_id}/'in endpoint:
            value=self.runrecord(self.production_id,'.github/workflows/release-cn-fixed.yml');value['display_title']='cn-mvp-'+self.release_id+'-production';return value
        ident=int(endpoint.split('/runs/')[1].split('/')[0]);stage='build'if ident==self.build_id else 'transfer'
        return json.loads(self.objects[json.loads(self.bundles[stage])['originals']['run']])

    def test_all_seven_stages_real_history_zip_collection_and_proposal(self):
        with patch.object(entryfixture.e,'read',self.entry_read):
            payload,bundles,objects=P.collect(self.release,reader=self.reader)
            report=C.verify(payload,bundles,objects,reader=self.reader,advance=entryfixture.e,github=self.provider)
            self.assertEqual(report['releaseSha256'],self.release)
            self.assertEqual(set(bundles),set(C.E.module().STAGES))
            def actual_verify(*args,**kwargs):return C.verify(*args,**kwargs,advance=entryfixture.e,github=self.provider)
            with patch.object(P.C,'verify',actual_verify):files,proposal=P.prepare(self.release,reader=self.reader)
            self.assertFalse(proposal['productionAccepted']);self.assertTrue(proposal['portalInstallationRequired'])
            self.assertEqual(proposal['provenance']['releaseSha256'],self.release)
            with tempfile.TemporaryDirectory()as folder:
                output=Path(folder)/'proposal';P.M.write_proposal(output,files,proposal)
                self.assertEqual(json.loads((output/'proposal.json').read_bytes())['releaseSha256'],self.release)
            self.assertTrue(any('/artifacts/99/zip'in path for path in self.provider_calls))
            self.assertTrue(any('/artifacts/1/zip'in path for path in self.provider_calls))
            artifact=os.environ.get('CN_MVP_COLLECTOR_TEST_RECEIPT')
            if artifact:
                receipt=dict(kind='cn-mvp-isolated-seven-stage-test-v1',stages=list(C.E.module().STAGES),
                    provider='authenticated-provider-standin',historicalStagesExecuted=len(entryfixture.e.STAGES),
                    actualZipBytesVerified=True,terminalProposalWritten=True,productionAccepted=False)
                Path(artifact).write_bytes(raw(receipt));Path(artifact).chmod(0o600)

    def test_seven_stage_collection_rejects_replaced_provider_archive(self):
        self.metadata_zip+=b'replaced';self.metadata_record['size_in_bytes']=len(self.metadata_zip)
        with patch.object(entryfixture.e,'read',self.entry_read):
            with self.assertRaisesRegex(ValueError,'TRANSFER_METADATA_DIGEST'):
                C.verify(self.payload,self.bundles,self.objects,reader=self.reader,advance=entryfixture.e,github=self.provider)

    def test_seven_stage_collection_rejects_wrong_metadata_member_even_with_valid_hash(self):
        members={**self.metadata_members,'unexpected.json':b'{}'}
        self.metadata_zip=zipfixture.zipped(members);self.metadata_record.update(size_in_bytes=len(self.metadata_zip),digest='sha256:'+C.E.sha(self.metadata_zip))
        with patch.object(entryfixture.e,'read',self.entry_read):
            with self.assertRaisesRegex(ValueError,'TRANSFER_METADATA_MEMBERS'):
                C.verify(self.payload,self.bundles,self.objects,reader=self.reader,advance=entryfixture.e,github=self.provider)

    def test_seven_stage_collection_rejects_root_admission_tamper(self):
        path=self.entries.state/'test-all/13-switch.admission.json';path.write_bytes(b'{"invented":true}')
        with patch.object(entryfixture.e,'read',self.entry_read):
            with self.assertRaises(entryfixture.e.Rejected):
                C.verify(self.payload,self.bundles,self.objects,reader=self.reader,advance=entryfixture.e,github=self.provider)

    def test_producer_rejects_missing_original_before_provider_fetch(self):
        manifest_path=Path('/var/lib/workspacex-cn/release-generated')/self.release/'mvp-originals/manifest.json'
        self.mapped(manifest_path).unlink()
        with self.assertRaises(FileNotFoundError):P.collect(self.release,reader=self.reader)
        self.assertEqual(self.provider_calls,[])

    def verify_round(self):
        with patch.object(entryfixture.e,'read',self.entry_read):
            payload,bundles,objects=P.collect(self.release,reader=self.reader)
            verified=C.verify(payload,bundles,objects,reader=self.reader,advance=entryfixture.e,github=self.provider)
            def actual_verify(*args,**kwargs):
                return C.verify(*args,**kwargs,advance=entryfixture.e,github=self.provider)
            with patch.object(P.C,'verify',actual_verify):
                files,proposal=P.prepare(self.release,reader=self.reader)
            self.assertFalse(proposal['productionAccepted'])
            self.assertEqual(verified['releaseSha256'],self.release)
            return payload,bundles,objects,files

    def second_round(self,source):
        second=SevenStageCollection(methodName='runTest')
        second.build_id=956;second.transfer_id=957;second.production_id=958
        second.release_id='isolated-hotfix';second.source_revision=source;second.artifact_offset=1000
        second.setUp();self.addCleanup(second.doCleanups)
        return second

    def test_two_round_hotfix_reuses_pipeline_without_database_schema_change(self):
        first_payload,first_bundles,first_objects,first_files=self.verify_round()
        second=self.second_round('f0eb9d07398a66fdd5646a9e6b855fa1b940e571')
        second_payload,second_bundles,second_objects,second_files=second.verify_round()
        self.assertNotEqual(first_payload['buildRunId'],second_payload['buildRunId'])
        self.assertNotEqual(self.release,second.release)
        self.assertEqual(self.schema['schemaLedgerSha256'],second.schema['schemaLedgerSha256'])
        self.assertEqual(self.schema['expectedLedgerSha256'],second.schema['expectedLedgerSha256'])
        self.assertEqual(set(first_bundles),set(second_bundles))
        first_set=json.loads(self.zip.raw);second_set=json.loads(second.zip.raw)
        self.assertEqual(set(first_set['images']),set(second_set['images']))
        for service in first_set['images']:
            self.assertNotEqual(first_set['images'][service]['imageId'],second_set['images'][service]['imageId'])
        self.assertTrue(first_files);self.assertTrue(second_files)

    def test_two_round_rejects_stale_transfer_originals(self):
        _,first_bundles,first_objects,_=self.verify_round()
        second=self.second_round('f0eb9d07398a66fdd5646a9e6b855fa1b940e571')
        second.verify_round()
        bundles={**second.bundles,'transfer':first_bundles['transfer']}
        objects={**second.objects,**first_objects}
        with patch.object(entryfixture.e,'read',second.entry_read):
            with self.assertRaises(ValueError):
                C.verify(second.payload,bundles,objects,reader=second.reader,advance=entryfixture.e,github=second.provider)

    def test_same_source_new_build_requires_fresh_run_and_artifact_binding(self):
        first_payload,_,_,_=self.verify_round()
        second=self.second_round(self.payload['identity']['sourceRevision'])
        second_payload,_,_,_=second.verify_round()
        self.assertEqual(first_payload['identity']['sourceRevision'],second_payload['identity']['sourceRevision'])
        self.assertEqual(self.schema['schemaLedgerSha256'],second.schema['schemaLedgerSha256'])
        self.assertNotEqual(first_payload['buildRunId'],second_payload['buildRunId'])
        self.assertNotEqual(self.zip.policy['artifactIds'],second.zip.policy['artifactIds'])
        self.assertNotEqual(first_payload['transferRunId'],second_payload['transferRunId'])

    def test_fixed_retention_reads_real_admitted_sources_then_producer_collects(self):
        retention=load('cn-release-mvp-original-retention')
        generated=Path('/var/lib/workspacex-cn/release-generated')/self.release
        self.write(generated/'mvp-production-run.json',raw(dict(binding=self.payload,releaseSha256=self.release)))
        self.write(Path('/var/lib/workspacex-cn/release-inputs')/self.release/'policy.json',self.zip.policy_raw)
        root=generated/'rds-backup'
        for role,value in self.rds.items():
            if role=='rdsReceipt':continue
            if role=='rds-intent':path=root/'intent.json'
            elif role=='rds-dispatch':path=root/'dispatch.json'
            elif role=='rds-stopReceiptSha256':path=root/'inputs/stop.json'
            elif role=='rds-holdReceiptSha256':path=root/'inputs/hold.json'
            else:path=root/(('page-'if role.startswith('rds-pages-')else 'task-')+C.E.sha(raw(value))+'.json')
            self.write(path,raw(value))
        # Start with no fabricated source manifest. The real retention module
        # must gather each admitted/source/provider original and write it.
        shutil.rmtree(self.mapped(generated/'mvp-originals'))
        writer=retention.P.M.write_proposal
        with patch.object(entryfixture.e,'read',self.entry_read),patch.object(retention.P.M,'write_proposal',lambda folder,files,report:writer(self.mapped(folder),files,report)):
            retained=retention.retain(self.release,reader=self.reader,advance=entryfixture.e,github=self.provider)
            self.assertEqual(set(retained['bundles']),set(C.E.module().STAGES))
            payload,bundles,objects=P.collect(self.release,reader=self.reader)
            self.assertEqual(payload,self.payload)
            verified=C.verify(payload,bundles,objects,reader=self.reader,advance=entryfixture.e,github=self.provider)
            self.assertEqual(verified['releaseSha256'],self.release)
