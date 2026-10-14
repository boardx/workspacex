import copy
import importlib.util
import json
import sys
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('stage_evidence', Path(__file__).parents[1]/'scripts/cn-release-mvp-stage-evidence.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def raw(value): return json.dumps(value,sort_keys=True,separators=(',',':')).encode()


class OriginalClosure(unittest.TestCase):
    def setUp(self):
        self.request = dict(sourceRevision='a'*40,releaseId='mvp-1',targetOrgId='org-platform',
            acceptanceScope='mvp-non-model',skippedTests=['real-model','ai-output-quality'],
            officialRolePackDigest=None,packRefs=[],workflows=[{'key':'test','version':1}])
        self.payload = dict(identity=dict(sourceRevision='a'*40,controlRevision='b'*40,releaseId='mvp-1',
             contentManifestSha256=m.sha(raw(self.request))),buildRunId=42,transferRunId=43,productionRunId=44,
             requestedAt='2026-10-14T04:00:00Z',deadlineAt='2026-10-14T04:30:00Z')
        self.objects = {}

    def bundle(self, stage, originals):
        refs = {}
        for key,value in originals.items():
            value = value if type(value) is bytes else raw(value)
            refs[key] = m.sha(value); self.objects[refs[key]] = value
        return raw(dict(kind='cn-mvp-stage-evidence-v1',stage=stage,binding=self.payload,originals=refs))

    def content(self):
        readback = dict(kind='cn-platform-content-release-receipt-v1',mode='readback',sourceRevision='a'*40,
            requestSha256=self.payload['identity']['contentManifestSha256'],receipt=dict(skillVersions=0,roleVersions=0,
            workflows=1,pendingBindings=0,contentReadbackPassed=True,acceptanceScope='mvp-non-model',
            realModel='SKIPPED',aiOutputQuality='SKIPPED',skillVerificationPromotion='NOT_PERFORMED',fullBusinessAcceptance=False))
        return {'request':self.request,'readback':readback}

    def test_content_original_readback_never_admits_production(self):
        report = m.validate_stage(self.payload,'content',self.bundle('content',self.content()),self.objects)
        self.assertTrue(report['originalByteClosureVerified']);self.assertFalse(report['productionAccepted'])

    def test_content_failed_counts_or_scope_reject(self):
        for field,value in [('contentReadbackPassed',False),('fullBusinessAcceptance',True),('workflows',0),('roleVersions',7),('skillVersions',1),('realModel','PASSED')]:
            originals = self.content(); originals['readback']['receipt'][field] = value
            with self.subTest(field=field),self.assertRaises(ValueError):
                m.validate_stage(self.payload,'content',self.bundle('content',originals),self.objects)

    def test_content_actual_pack_bytes_and_skill_count(self):
        path = Path(__file__).parents[1]/'skills/starter-packs/standard-context/1.1.1.json'
        pack_raw=path.read_bytes();pack=json.loads(pack_raw)
        self.request['packRefs']=[dict(packId=pack['packId'],packVersion=pack['packVersion'],path=str(path),
            rawSha256=m.sha(pack_raw),packDigest=pack['packDigest'])]
        self.payload['identity']['contentManifestSha256']=m.sha(raw(self.request))
        originals=self.content();originals['skill-pack-0']=pack_raw
        originals['readback']['receipt']['skillVersions']=len(pack['skills'])
        m.validate_stage(self.payload,'content',self.bundle('content',originals),self.objects)
        originals['readback']['receipt']['skillVersions']=len(pack['skills'])-1
        with self.assertRaisesRegex(ValueError,'CONTENT_COUNTS'):m.validate_stage(self.payload,'content',self.bundle('content',originals),self.objects)
        originals['readback']['receipt']['skillVersions']=len(pack['skills'])
        changed=copy.deepcopy(pack);changed['skills'][0]['files'][0]['contentBase64']='dGFtcGVy'
        originals['skill-pack-0']=raw(changed)
        with self.assertRaisesRegex(ValueError,'CONTENT_PACK_IDENTITY'):m.validate_stage(self.payload,'content',self.bundle('content',originals),self.objects)

    def test_byte_replacement_reject(self):
        bundle=self.bundle('content',self.content()); pin=json.loads(bundle)['originals']['request']
        self.objects[pin]=raw({**self.request,'targetOrgId':'other'})
        with self.assertRaisesRegex(ValueError,'ORIGINAL_CHANGED'):m.validate_stage(self.payload,'content',bundle,self.objects)

    def test_old_round_binding_reject(self):
        bundle=json.loads(self.bundle('content',self.content()));bundle['binding']['productionRunId']=45
        with self.assertRaisesRegex(ValueError,'STAGE_BINDING'):m.validate_stage(self.payload,'content',raw(bundle),self.objects)

    def test_duplicate_original_key_reject(self):
        bad=b'{"kind":1,"kind":2}'
        with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_KEY'):m.validate_stage(self.payload,'content',self.bundle('content',{'request':bad}),self.objects)

    def durable(self):
        manifest=dict(stage='switch',sourceRevision='a'*40,baselineRevision='c'*40,controlRevision='b'*40,
            attemptId='test-attempt',scope='runtime-only-reviewed-continuation',requestedAt=self.payload['requestedAt'],
            deadlineAt=self.payload['deadlineAt'],previousReceiptSha256='1'*64,verifierSha256='2'*64,
            observerSha256='3'*64,authorizationEvidenceSha256='4'*64)
        evidence={'runtimeSwitched':True};observation={'actualContainersRead':True}
        receipt=dict(schemaVersion=1,**manifest,requestSha256=m.sha(raw(manifest)),mode='advance',
            finishedAt='2026-10-14T04:15:00Z',evidenceSha256=m.sha(raw(evidence)),terminalObservationSha256=m.sha(raw(observation)))
        admission=dict(kind='cn-entry-admission-v1',requestSha256=receipt['requestSha256'],verifierSha256=manifest['verifierSha256'],
            observerSha256=manifest['observerSha256'],authorizationEvidenceSha256=manifest['authorizationEvidenceSha256'],
            evidenceSha256=receipt['evidenceSha256'],terminalObservationSha256=receipt['terminalObservationSha256'])
        receipt['admissionSha256']=m.sha(raw(admission))
        return dict(durableManifest=manifest,durableReceipt=receipt,durableEvidence=evidence,durableObservation=observation,
            durableAdmission=admission,durableIntent={'requestSha256':receipt['requestSha256']},durableProcess={'requestSha256':receipt['requestSha256']})

    def test_durable_full_original_closure_is_structural_only(self):
        result=m.validate_stage(self.payload,'deploy',self.bundle('deploy',self.durable()),self.objects)
        self.assertFalse(result['liveProviderProvenanceVerified'])

    def test_durable_changed_process_or_admission_or_time_rejects(self):
        for role,key,value in [('durableProcess','requestSha256','0'*64),('durableAdmission','kind','invented'),
                               ('durableReceipt','finishedAt','2026-10-14T04:31:00Z'),('durableReceipt','mode','status')]:
            originals=self.durable(); originals[role][key]=value
            with self.subTest(role=role,key=key),self.assertRaises(ValueError):
                m.validate_stage(self.payload,'deploy',self.bundle('deploy',originals),self.objects)

    def test_bare_green_receipt_has_no_originals(self):
        with self.assertRaises(ValueError):m.validate_stage(self.payload,'deploy',raw({'status':'SUCCEEDED'}),self.objects)

    def test_build_uses_existing_authenticated_metadata_contract(self):
        run=dict(id=42,repository={'full_name':'boardx/workspacex'},path='.github/workflows/build-cn-image-candidates.yml',
            event='workflow_dispatch',head_branch='main',head_sha='b'*40,run_attempt=1,status='completed',conclusion='success')
        names=['cn-candidate-plan','cn-image-candidate-set']+['cn-image-candidate-'+s for s in m.B.SERVICES]
        artifacts=dict(total_count=7,artifacts=[dict(id=i+1,name=name+'-42-1',expired=False,size_in_bytes=10,
            digest='sha256:'+'d'*64,workflow_run={'id':42,'head_sha':'b'*40}) for i,name in enumerate(names)])
        originals=dict(run=run,artifacts=artifacts,candidatePlan={'sourceRevision':'a'*40,'controlRevision':'b'*40})
        m.validate_stage(self.payload,'build',self.bundle('build',originals),self.objects)
        run['run_attempt']=2
        with self.assertRaises(ValueError):m.validate_stage(self.payload,'build',self.bundle('build',originals),self.objects)

    def test_nonmodel_all_checks_and_exact_production_binding(self):
        observation=dict(kind='cn-mvp-nonmodel-receipt-v1',identity=self.payload['identity'],productionRunId=44,
            checks={k:'PASSED' for k in ('tenant_protection','login','permissions','fixed_api_behavior')},
            observations=[{'statusCode':200}],modelQuality='SKIPPED',futureV2Content='NOT_APPLICABLE')
        report=m.validate_stage(self.payload,'acceptance',self.bundle('acceptance',{'readback':observation}),self.objects)
        self.assertFalse(report['productionAccepted'])
        observation['checks'].pop('permissions')
        with self.assertRaises(ValueError):m.validate_stage(self.payload,'acceptance',self.bundle('acceptance',{'readback':observation}),self.objects)

    def test_schema_actual_ledger_readback_must_match(self):
        observation=dict(kind='cn-mvp-schema-readback-v1',identity=self.payload['identity'],productionRunId=44,
            schemaLedgerSha256='d'*64,expectedLedgerSha256='d'*64,schemaReadbackPassed=True,productionWrites=False)
        m.validate_stage(self.payload,'schema',self.bundle('schema',{'readback':observation}),self.objects)
        for key,value in [('expectedLedgerSha256','e'*64),('schemaReadbackPassed',False),('productionWrites',True),('productionRunId',45)]:
            changed={**observation,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_stage(self.payload,'schema',self.bundle('schema',{'readback':changed}),self.objects)

    def test_transfer_real_synthetic_zip_proof_and_tampering(self):
        # Reuse the real ZIP/tar producer fixture: authenticated provider is an
        # isolated stand-in, never a claim that GitHub or production was read.
        sys.path.insert(0,str(Path(__file__).parent))
        import test_cn_candidate_revalidation as fixture
        case=fixture.RevalidationTests();case.setUp();self.addCleanup(case.doCleanups)
        case.policy['verifierRevision']=case.plan['controlRevision']
        proof_raw=case.produce();proof=json.loads(proof_raw)
        self.payload['identity'].update(sourceRevision=case.plan['sourceRevision'],controlRevision=case.plan['controlRevision'])
        self.payload['buildRunId']=case.policy['runId']
        template={k:case.policy[k] for k in ('runId','runAttempt','controlRevision','verifierRevision','artifactIds')}
        artifacts={k:dict(id=v['artifactId'],bytes=v['zipBytes'],sha256=v['zipSha256']) for k,v in proof['github']['artifacts'].items()}
        plan=dict(kind='hk-original-artifact-transfer-v3',sourceRun=self.payload['buildRunId'],sourceRunAttempt=1,
            sourceRevision=self.payload['identity']['sourceRevision'],producerControl=self.payload['identity']['controlRevision'],
            candidatePlanRawSha256=proof['candidatePlanRawSha256'],revalidationTemplateSha256=m.sha(raw(template)),artifacts=artifacts)
        run=dict(id=43,repository={'full_name':'boardx/workspacex'},path='.github/workflows/transfer-cn-candidates-via-hongkong.yml',
            event='workflow_dispatch',head_branch='main',head_sha=self.payload['identity']['controlRevision'],run_attempt=1,status='completed',conclusion='success')
        originals=dict(run=run,plan=plan,template=template,proof=proof_raw,policy=case.policy_raw)
        result=m.validate_stage(self.payload,'transfer',self.bundle('transfer',originals),self.objects)
        self.assertFalse(result['productionAccepted'])
        changed=copy.deepcopy(proof);changed['github']['artifacts']['web']['providerDigest']='sha256:'+'0'*64
        originals['proof']=raw(changed)
        with self.assertRaises(Exception):m.validate_stage(self.payload,'transfer',self.bundle('transfer',originals),self.objects)

    def test_rds_original_provider_snapshot_and_incomplete_pages(self):
        originals=self.durable();originals['durableManifest']['stage']='rds-backup'
        # Rebuild durable hashes after selecting the actual RDS entry stage.
        manifest=originals['durableManifest'];receipt=originals['durableReceipt']
        receipt['stage']='rds-backup';receipt['requestSha256']=m.sha(raw(manifest))
        for key in ('durableIntent','durableProcess','durableAdmission'):originals[key]['requestSha256']=receipt['requestSha256']
        receipt['admissionSha256']=m.sha(raw(originals['durableAdmission']))
        snapshot=dict(DBInstanceId='pgm-uf6rg214cp381l49',BackupId='456',BackupMethod='Snapshot',BackupType='FullBackup',
            BackupMode='Manual',BackupStatus='Success',MetaStatus='OK',BackupStartTime='2026-10-14T04:05:00Z',BackupEndTime='2026-10-14T04:10:00Z')
        provider=dict(intent={'createdAt':'2026-10-14T04:04:00Z','attemptId':'test-attempt'},dispatch={'BackupJobId':'123','RequestId':'create-id'},
            stopReceiptSha256={'knownFiveStopped':True,'otherDatabaseClientSessions':0,'holdGeneration':'epoch-1'},
            holdReceiptSha256={'state':'held','generation':'epoch-1','identity':self.payload['identity']},
            task={'RequestId':'task-id','Items':{'BackupJob':[dict(BackupJobId='123',BackupStatus='Finished',JobMode='Manual',BackupId='456')]}},
            pages=[dict(RequestId='page-id',TotalRecordCount=1,PageNumber=1,PageRecordCount=1,Items={'Backup':[snapshot]})])
        refs={}
        for key,value in provider.items():
            if isinstance(value,list):
                refs[key]=[m.sha(raw(v)) for v in value]
                for index,v in enumerate(value):originals['rds-'+key+'-'+str(index)]=v
            else:refs[key]=m.sha(raw(value));originals['rds-'+key]=value
        originals['rdsReceipt']=dict(dbInstanceId=snapshot['DBInstanceId'],backupId='456',backupStatus='Success',metaStatus='OK',
            backupStartTime=snapshot['BackupStartTime'],backupEndTime=snapshot['BackupEndTime'],isolatedRestoreTested=False,
            requestedBackupJobId='123',providerRequestId='create-id',originalEvidenceSha256=refs,
            createIntentCreatedAt=provider['intent']['createdAt'],attemptId='test-attempt',holdGeneration='epoch-1')
        originals['durableEvidence']=originals['rdsReceipt']
        receipt['evidenceSha256']=m.sha(raw(originals['rdsReceipt']))
        originals['durableAdmission']['evidenceSha256']=receipt['evidenceSha256']
        receipt['admissionSha256']=m.sha(raw(originals['durableAdmission']))
        result=m.validate_stage(self.payload,'backup',self.bundle('backup',originals),self.objects)
        self.assertFalse(result['productionAccepted'])
        provider['pages'][0]['TotalRecordCount']=2
        originals['rdsReceipt']['originalEvidenceSha256']['pages'][0]=m.sha(raw(provider['pages'][0]))
        with self.assertRaisesRegex(ValueError,'RDS_ALL_PAGES'):m.validate_stage(self.payload,'backup',self.bundle('backup',originals),self.objects)


if __name__=='__main__':unittest.main()
