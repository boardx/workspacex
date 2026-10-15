"""Offline original-byte validation, deliberately separate from root provenance.

No JSON boolean grants admission. The production portal must additionally verify
root protected historical entry receipts and authenticated provider observations.
"""
import hashlib
import base64
import importlib.util
import json
import re
import sys
from datetime import datetime
from pathlib import Path


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


B = module('cn-release-mvp-chain')
E = module('cn-release-mvp-evidence')
need = B.need
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def parse(raw):
    need(type(raw) is bytes and 0 < len(raw) <= 262144, 'ORIGINAL_SIZE')
    def pairs(rows):
        out = {}
        for key, value in rows:
            need(key not in out, 'DUPLICATE_JSON_KEY'); out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=pairs)


def instant(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    need(parsed.tzinfo is not None, 'TIMEZONE_REQUIRED')
    return parsed


def provider_count(value):
    need(type(value) is int or type(value) is str and re.fullmatch('[0-9]{1,9}',value), 'PROVIDER_COUNT')
    value = int(value); need(0 <= value <= 10000, 'PROVIDER_COUNT_RANGE'); return value


def run(value, run_id, workflow, control):
    need(type(value.get('id')) is int and value['id'] == run_id, 'PROVIDER_RUN')
    need(value.get('repository', {}).get('full_name') == 'boardx/workspacex'
         and value.get('path') == workflow and value.get('event') == 'workflow_dispatch'
         and value.get('head_branch') == 'main' and value.get('head_sha') == control
         and type(value.get('run_attempt')) is int and value['run_attempt'] == 1
         and value.get('status') == 'completed' and value.get('conclusion') == 'success',
         'PROVIDER_RUN_SCOPE')


def durable(read, payload, allowed_stage):
    """Validate the same immutable closure as verify_historical_receipt offline.

    Root ownership, installed package and live admission remain the root reader's
    responsibility; this function never substitutes offline files for those.
    """
    m, r = read('durableManifest'), read('durableReceipt')
    need(m['stage'] in allowed_stage and r['stage'] == m['stage'], 'DURABLE_STAGE')
    need(r['requestSha256'] == read('durableManifest', raw=True, digest=True), 'DURABLE_REQUEST')
    for key in ('sourceRevision', 'controlRevision'):
        need(m[key] == payload['identity'][key], 'DURABLE_RELEASE')
    for key in ('sourceRevision', 'baselineRevision', 'controlRevision', 'attemptId', 'scope',
                'stage', 'requestedAt', 'deadlineAt', 'previousReceiptSha256'):
        need(r.get(key) == m.get(key), 'DURABLE_IDENTITY')
    need(m['requestedAt'] == payload['requestedAt'] and m['deadlineAt'] == payload['deadlineAt'], 'DURABLE_WINDOW')
    need(r['mode'] in ('advance', 'reconcile') and instant(m['requestedAt']) <= instant(r['finishedAt'])
         <= instant(m['deadlineAt']), 'DURABLE_COMPLETION')
    for role, field in (('durableEvidence','evidenceSha256'), ('durableObservation','terminalObservationSha256'),
                        ('durableAdmission','admissionSha256')):
        need(read(role, raw=True, digest=True) == r[field], 'DURABLE_BYTES')
    for role in ('durableIntent', 'durableProcess'):
        need(read(role)['requestSha256'] == r['requestSha256'], 'DURABLE_EXECUTION')
    need(read('durableAdmission') == dict(kind='cn-entry-admission-v1', requestSha256=r['requestSha256'],
         verifierSha256=m['verifierSha256'], observerSha256=m['observerSha256'],
         authorizationEvidenceSha256=m['authorizationEvidenceSha256'], evidenceSha256=r['evidenceSha256'],
         terminalObservationSha256=r['terminalObservationSha256']), 'DURABLE_ADMISSION')
    return r


def validate_stage(payload, stage, evidence_raw, objects):
    E.selector('terminal', payload)
    bundle = parse(evidence_raw)
    need(set(bundle) == {'kind','stage','binding','originals'} and bundle['kind'] == 'cn-mvp-stage-evidence-v1'
         and bundle['stage'] == stage and bundle['binding'] == payload, 'STAGE_BINDING')
    refs = bundle['originals']; need(type(refs) is dict and refs, 'ORIGINALS_REQUIRED')
    def read(role, raw=False, digest=False):
        pin = refs[role]; need(type(pin) is str and len(pin) == 64 and pin in objects, 'ORIGINAL_MISSING')
        value = objects[pin]; need(sha(value) == pin, 'ORIGINAL_CHANGED')
        parsed = parse(value)
        return pin if digest else value if raw else parsed
    # Verify every retained original, including indirect RDS provider objects.
    for role in refs: read(role)
    identity = payload['identity']
    if stage == 'build':
        bound = B.bind(identity, read('run'), read('artifacts'))
        need(bound['sourceRun'] == payload['buildRunId'], 'BUILD_RUN')
        plan = read('candidatePlan')
        need(all(plan[k] == identity[k] for k in ('sourceRevision','controlRevision')), 'BUILD_PLAN')
    elif stage == 'transfer':
        run(read('run'), payload['transferRunId'], '.github/workflows/transfer-cn-candidates-via-hongkong.yml', identity['controlRevision'])
        plan, template, proof = read('plan'), read('template'), read('proof')
        need(plan['kind'] == 'hk-original-artifact-transfer-v3' and plan['sourceRun'] == payload['buildRunId']
             and plan['sourceRunAttempt'] == 1 and plan['sourceRevision'] == identity['sourceRevision']
             and plan['producerControl'] == identity['controlRevision'], 'TRANSFER_PLAN')
        need(template['runId'] == payload['buildRunId'] and template['runAttempt'] == 1
             and template['controlRevision'] == template['verifierRevision'] == identity['controlRevision']
             and plan['revalidationTemplateSha256'] == read('template', raw=True, digest=True), 'TRANSFER_TEMPLATE')
        need(proof['kind'] == 'candidate-revalidation-v1' and proof['sourceRevision'] == identity['sourceRevision']
             and proof['controlRevision'] == proof['verifierRevision'] == identity['controlRevision']
             and proof['github']['runId'] == payload['buildRunId'] and proof['github']['runAttempt'] == 1
             and proof['candidatePlanRawSha256'] == plan['candidatePlanRawSha256']
             and proof['releaseReady'] is False and proof['productionReady'] is False, 'TRANSFER_PROOF')
        need(template['artifactIds'] == {k:v['id'] for k,v in plan['artifacts'].items()}
             and set(plan['artifacts']) == {'plan','set',*B.SERVICES}, 'TRANSFER_ARTIFACTS')
        # Reuse the canonical complete policy/proof validator, including genuine
        # provider artifact digests and freshness. These bytes still need root
        # approved provenance; this is not permission to publish.
        scripts = str(Path(__file__).parent)
        sys.path.insert(0, scripts)
        try:
            canonical = module('cn_candidate_revalidation')
            canonical.admit(read('proof',raw=True),read('proof',raw=True,digest=True),
                            read('policy',raw=True,digest=True),read('policy',raw=True))
        finally:
            sys.path.remove(scripts)
    elif stage == 'content':
        request, value = read('request'), read('readback')
        need(read('request', raw=True, digest=True) == identity['contentManifestSha256'], 'CONTENT_REQUEST')
        need(request['sourceRevision'] == identity['sourceRevision'] and request['releaseId'] == identity['releaseId']
             and request['targetOrgId'] == 'org-platform' and request['acceptanceScope'] == 'mvp-non-model'
             and request['skippedTests'] == ['real-model','ai-output-quality'], 'CONTENT_SCOPE')
        pack_refs = request.get('packRefs')
        need(type(pack_refs) is list and len(pack_refs) <= 50, 'CONTENT_PACK_REFS')
        packs_seen, skills = set(), {}
        for index, ref in enumerate(pack_refs):
            role = 'skill-pack-'+str(index); pack = read(role)
            need(read(role,raw=True,digest=True) == ref['rawSha256'] and pack['schemaVersion'] == 1
                 and pack['packId'] == ref['packId'] and pack['packVersion'] == ref['packVersion']
                 and pack['packDigest'] == ref['packDigest'], 'CONTENT_PACK_IDENTITY')
            coordinate = (pack['packId'],pack['packVersion'])
            need(coordinate not in packs_seen,'CONTENT_PACK_DUPLICATE');packs_seen.add(coordinate)
            # Matches verifySkillStarterPack's signed insertion order, not
            # arbitrary sorted-key serialization of the outer JSON file.
            unsigned = {key:pack[key] for key in ('schemaVersion','packId','packVersion','skills')}
            need(sha(json.dumps(unsigned,ensure_ascii=False,separators=(',',':')).encode()) == pack['packDigest'], 'CONTENT_PACK_DIGEST')
            need(type(pack['skills']) is list, 'CONTENT_PACK_SKILLS')
            within = set()
            for skill in pack['skills']:
                coordinate = (skill['stableName'],skill['semanticVersion'])
                need(skill['stableName'] not in within,'CONTENT_SKILL_DUPLICATE');within.add(skill['stableName'])
                files = skill['files']; need(type(files) is list and len([f for f in files if f['path']=='SKILL.md']) == 1,'CONTENT_SKILL_FILES')
                paths = set()
                for item in files:
                    path = item['path'];need(path not in paths and not path.startswith('/') and '\\' not in path
                        and '\0' not in path and all(part not in ('','.','..') for part in path.split('/')),'CONTENT_SKILL_PATH')
                    paths.add(path)
                    encoded = item['contentBase64']; decoded = base64.b64decode(encoded+'='*((-len(encoded))%4),validate=True)
                    need(base64.b64encode(decoded).decode().rstrip('=') == encoded.rstrip('=') and sha(decoded)==item['digest'],'CONTENT_SKILL_FILE_DIGEST')
                content = {'manifest':skill['manifest'],'files':[{k:f[k] for k in ('path','digest','mediaType')} for f in files]}
                digest = sha(json.dumps(content,ensure_ascii=False,separators=(',',':')).encode())
                need(coordinate not in skills or skills[coordinate] == digest,'CONTENT_SHARED_VERSION_CONFLICT')
                skills[coordinate] = digest
        need(value['kind'] == 'cn-platform-content-release-receipt-v1' and value['mode'] == 'readback'
             and value['sourceRevision'] == identity['sourceRevision']
             and value['requestSha256'] == identity['contentManifestSha256'], 'CONTENT_READBACK')
        r = value['receipt']
        need(r['contentReadbackPassed'] is True and r['acceptanceScope'] == 'mvp-non-model'
             and r['realModel'] == r['aiOutputQuality'] == 'SKIPPED'
             and r['skillVerificationPromotion'] == 'NOT_PERFORMED' and r['fullBusinessAcceptance'] is False,
             'CONTENT_RESULT')
        need(type(r['skillVersions']) is int and r['skillVersions'] == len(skills)
             and r['workflows'] == len(request['workflows']) and r['roleVersions'] == (7 if request['officialRolePackDigest'] else 0), 'CONTENT_COUNTS')
    elif stage == 'backup':
        r = read('rdsReceipt')
        need(r['dbInstanceId'] == 'pgm-uf6rg214cp381l49' and r['backupStatus'] == 'Success'
             and r['metaStatus'] == 'OK' and r['isolatedRestoreTested'] is False, 'RDS_RESULT')
        start, end = instant(r['backupStartTime']), instant(r['backupEndTime'])
        need(instant(payload['requestedAt']).replace(second=0,microsecond=0) <= start <= end <= instant(payload['deadlineAt']), 'RDS_CURRENT_EPOCH')
        originals = r['originalEvidenceSha256']
        need(set(originals) == {'intent','dispatch','task','pages','stopReceiptSha256','holdReceiptSha256'}, 'RDS_ORIGINAL_SCHEMA')
        for key, pin in originals.items():
            for index, item in enumerate(pin if isinstance(pin,list) else [pin]):
                need(read('rds-'+key+(('-'+str(index)) if isinstance(pin,list) else ''),raw=True,digest=True) == item, 'RDS_PROVIDER_BYTES')
        dispatch, task = read('rds-dispatch'), read('rds-task')
        intent, stop, hold = read('rds-intent'), read('rds-stopReceiptSha256'), read('rds-holdReceiptSha256')
        created = instant(intent['createdAt'])
        floor = created.replace(second=0,microsecond=0) if re.search(r'T[0-9]{2}:[0-9]{2}(?:Z|[+-])',r['backupStartTime']) else created.replace(microsecond=0)
        need(intent['createdAt'] == r['createIntentCreatedAt'] and intent['attemptId'] == r['attemptId']
             and instant(payload['requestedAt']) <= created and floor <= start, 'RDS_CREATE_EPOCH')
        need(hold['state'] == 'held' and hold['generation'] == r['holdGeneration'] == stop['holdGeneration']
             and stop['knownFiveStopped'] is True and stop['otherDatabaseClientSessions'] == 0
             and all(hold['identity'][k] == identity[k] for k in ('sourceRevision','controlRevision')), 'RDS_STOP_HOLD')
        need(dispatch['BackupJobId'] == r['requestedBackupJobId'] and dispatch['RequestId'] == r['providerRequestId'], 'RDS_DISPATCH')
        tasks = task['Items']; tasks = tasks['BackupJob'] if isinstance(tasks,dict) else tasks
        need(len(tasks) == 1 and task.get('RequestId') and str(tasks[0].get('BackupJobId')) == str(r['requestedBackupJobId'])
             and tasks[0].get('BackupStatus') == 'Finished' and tasks[0].get('JobMode') == 'Manual'
             and str(tasks[0].get('BackupId')) == str(r['backupId']), 'RDS_TASK')
        rows, total = [], None
        for index, _pin in enumerate(originals['pages']):
            page = read('rds-pages-'+str(index)); count = provider_count(page['TotalRecordCount'])
            need(total is None or total == count, 'RDS_PAGINATION_TOTAL')
            total = count; items = page['Items']; items = items['Backup'] if isinstance(items,dict) else items
            need(page.get('RequestId') and provider_count(page['PageNumber']) == index+1
                 and provider_count(page['PageRecordCount']) == len(items) and len(items) <= 100, 'RDS_PAGINATION')
            rows.extend(items)
        need(total is not None and len(rows) == total and len({str(v['BackupId']) for v in rows}) == total, 'RDS_ALL_PAGES')
        hits = [v for v in rows if str(v['BackupId']) == str(r['backupId'])]
        need(len(hits) == 1 and all(hits[0].get(k) == v for k,v in {
            'DBInstanceId':r['dbInstanceId'],'BackupMethod':'Snapshot','BackupType':'FullBackup','BackupMode':'Manual',
            'BackupStatus':'Success','MetaStatus':'OK','BackupStartTime':r['backupStartTime'],'BackupEndTime':r['backupEndTime']}.items()), 'RDS_SNAPSHOT')
        completed = durable(read, payload, {'rds-backup'})
        need(completed['evidenceSha256'] == read('rdsReceipt',raw=True,digest=True), 'RDS_DURABLE_RESULT')
    elif stage == 'deploy': durable(read, payload, {'switch'})
    elif stage in ('schema','acceptance'):
        # New adapters have no historical entry stage yet: require their original
        # typed readbacks; the pinned root verifier must independently admit them.
        value = read('readback')
        need(value.get('identity') == identity and value.get('productionRunId') == payload['productionRunId'], 'READBACK_IDENTITY')
        expected = 'cn-mvp-schema-readback-v1' if stage == 'schema' else 'cn-mvp-nonmodel-receipt-v1'
        need(value.get('kind') == expected, 'READBACK_KIND')
        if stage == 'acceptance':
            need(value.get('checks') == {key:'PASSED' for key in ('tenant_protection','login','permissions','fixed_api_behavior')}
                 and value.get('modelQuality') == 'SKIPPED' and value.get('futureV2Content') == 'NOT_APPLICABLE', 'NONMODEL_CHECKS')
            need(type(value.get('observations')) is list and value['observations'], 'NONMODEL_ORIGINAL_OBSERVATIONS')
        else:
            need(type(value.get('schemaLedgerSha256')) is str and re.fullmatch('[a-f0-9]{64}',value['schemaLedgerSha256'])
                 and value['schemaLedgerSha256'] == value.get('expectedLedgerSha256')
                 and value.get('schemaReadbackPassed') is True and value.get('productionWrites') is False,'SCHEMA_READBACK')
    else: raise ValueError('STAGE_UNKNOWN')
    return {'stage':stage,'originalByteClosureVerified':True,'liveProviderProvenanceVerified':False,'productionAccepted':False}


def validate(payload, receipts, bundles, objects):
    B.terminal(payload['identity'], receipts)
    need(set(bundles) == set(B.STAGES), 'BUNDLE_STAGES')
    reports = []
    for receipt in receipts:
        raw = bundles[receipt['stage']]
        need(sha(raw) == receipt['evidenceSha256'], 'STAGE_EVIDENCE_CHANGED')
        reports.append(validate_stage(payload, receipt['stage'], raw, objects))
    return {'kind':'cn-mvp-original-closure-report-v1','stages':reports,'productionAccepted':False,
            'rootHistoricalAdmissionRequired':True,'authenticatedProviderReadbackRequired':True}
