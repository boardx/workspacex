"""Read-only provenance verification against installed authority and durable roots.

No caller path, verifier, credential or success flag is accepted. Library seams
are for isolated tests; the portal uses only the fixed production dependencies.
"""
import importlib.util
import io
import json
import sys
import time
import re
import stat
import tempfile
import zipfile
from pathlib import Path


def module(name, path=None):
    path = path or Path(__file__).with_name(name+'.py')
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


S=module('cn-release-mvp-stage-evidence')
E=S.E
TRANSFER_MEMBERS=frozenset(('upload-plan.json','hk-template.json','proof.json','policy.json','receipt.json'))


def transfer_metadata(payload,github):
    """Fetch only the exact small metadata artifact, never an image archive."""
    runid=payload['transferRunId'];control=payload['identity']['controlRevision']
    listing=github(f'/repos/boardx/workspacex/actions/runs/{runid}/artifacts?per_page=100')
    rows=listing.get('artifacts');E.need(type(rows)is list and listing.get('total_count')==len(rows),'TRANSFER_METADATA_PAGINATION')
    hits=[row for row in rows if row.get('name')==f'cn-hk-originals-{runid}-1']
    E.need(len(hits)==1,'TRANSFER_METADATA_ARTIFACT')
    row=hits[0]
    E.need(row.get('expired')is False and type(row.get('id'))is int and row['id']>0
        and type(row.get('size_in_bytes'))is int and 0<row['size_in_bytes']<=1024**2
        and re.fullmatch('sha256:[a-f0-9]{64}',row.get('digest',''))
        and row.get('workflow_run',{}).get('id')==runid
        and row['workflow_run'].get('head_sha')==control,'TRANSFER_METADATA_SCOPE')
    with tempfile.TemporaryDirectory(prefix='cn-mvp-transfer-originals-')as folder:
        path=Path(folder)/'metadata.zip';github(f'/repos/boardx/workspacex/actions/artifacts/{row["id"]}/zip',path,row['size_in_bytes'])
        E.need(path.stat().st_size==row['size_in_bytes'] and E.sha(path.read_bytes())==row['digest'][7:],'TRANSFER_METADATA_DIGEST')
        with zipfile.ZipFile(path)as archive:
            members=archive.infolist()
            E.need(len(members)==len(TRANSFER_MEMBERS) and {m.filename for m in members}==TRANSFER_MEMBERS,'TRANSFER_METADATA_MEMBERS')
            result={}
            for member in members:
                E.need(not member.is_dir()and not member.flag_bits&1 and stat.S_IFMT(member.external_attr>>16)in(0,stat.S_IFREG)
                    and 0<member.file_size<=262144,'TRANSFER_METADATA_ENTRY')
                raw=archive.read(member);E.need(len(raw)==member.file_size,'TRANSFER_METADATA_ENTRY_SIZE');S.parse(raw);result[member.filename]=raw
    # Stable identity fields, not mutable download counters/URLs.
    after=github(f'/repos/boardx/workspacex/actions/artifacts/{row["id"]}')
    E.need(all(after.get(key)==row.get(key)for key in ('id','name','expired','size_in_bytes','digest'))
        and after.get('workflow_run',{}).get('id')==runid
        and after['workflow_run'].get('head_sha')==control,'TRANSFER_METADATA_CHANGED')
    return result


def protected_github(policy):
    sys.path.insert(0,str(Path(__file__).parent))
    try: G=module('cn_candidate_github')
    finally: sys.path.pop(0)
    G.private_read(policy['ghExecutable'],128*1024**2,policy['ghSha256'],private=False)
    github=G.Github(policy['ghExecutable'],time.monotonic()+120)
    def read(endpoint, target=None, limit=None):
        if target is None:return github.json(endpoint)
        with target.open('xb') as stream:
            __import__('os').chmod(target,0o600)
            count=github.fetch(endpoint,stream,limit)
            E.need(count==limit,'PROVIDER_ARCHIVE_SIZE')
    return read


def validate_host_provider(value):
    E.need(type(value)is dict and set(value)=={'ghExecutable','ghSha256','authentication'}
        and value['authentication']=='existing-root-gh','HOST_PROVIDER_PROFILE')
    path=Path(value['ghExecutable'])
    E.need(path.is_absolute() and '..'not in path.parts and re.fullmatch('[a-f0-9]{64}',value['ghSha256']),'HOST_PROVIDER_BINARY_PIN')
    return value


def provider_for(approval,release,reader=E.private):
    """Use the approved host profile, never the HK runner's proof executable."""
    E.need(type(release)is str and re.fullmatch('[a-f0-9]{64}',release),'HOST_PROVIDER_RELEASE')
    raw=reader(Path('/var/lib/workspacex-cn/release-inputs')/release/'mvp-profile.json')
    E.need(E.sha(raw)==approval['mvp']['stageInputs']['profileSha256'],'HOST_PROVIDER_PROFILE_PIN')
    profile=S.parse(raw);host=validate_host_provider(profile.get('githubProvider'))
    E.need(all(profile['identity'][key]==approval['identity'][key]for key in ('sourceRevision','controlRevision')),'HOST_PROVIDER_IDENTITY')
    return protected_github(host)


def historical(bundle,objects,advance):
    refs=bundle['originals']
    receipt=S.parse(objects[refs['durableReceipt']]);manifest=S.parse(objects[refs['durableManifest']])
    stage=manifest['stage'];E.need(stage in advance.STAGES,'HISTORICAL_STAGE')
    attempt=manifest['attemptId'];E.need(advance.ATTEMPT.fullmatch(attempt),'HISTORICAL_ATTEMPT')
    path=advance.STATE/attempt/('%02d-%s.receipt.json'%(advance.STAGES.index(stage),stage))
    E.need(advance.read(path)==objects[refs['durableReceipt']],'RETAINED_RECEIPT_CHANGED')
    advance.verify_historical_receipt(path,receipt,manifest)
    return receipt


def production_context(approval,release,payload,github,*,completed=False):
    """Authenticate a run number as context only; never as release authority."""
    E.selector('terminal',payload)
    E.need(__import__('re').fullmatch('[a-f0-9]{64}',release),'CONTEXT_APPROVAL_HASH')
    E.need(all(approval['identity'][k]==payload['identity'][k]for k in ('sourceRevision','controlRevision'))
        and all(approval['identity'][k]==payload[k]for k in ('requestedAt','deadlineAt')),'CONTEXT_AUTHORITY_BINDING')
    runid=payload['productionRunId']
    record=github(f'/repos/boardx/workspacex/actions/runs/{runid}/attempts/1')
    E.need(record.get('id')==runid and type(record.get('id'))is int
        and record.get('repository',{}).get('full_name')=='boardx/workspacex'
        and record.get('path')=='.github/workflows/release-cn-fixed.yml'
        and record.get('head_sha')==payload['identity']['controlRevision']
        and record.get('head_branch')=='main' and record.get('event')=='workflow_dispatch'
        and record.get('run_attempt')==1
        and record.get('display_title')=='cn-mvp-'+payload['identity']['releaseId']+'-production', 'PRODUCTION_RUN_BINDING')
    E.need(S.instant(payload['requestedAt'])<=S.instant(record['created_at'])<=S.instant(payload['deadlineAt']),'PRODUCTION_RUN_WINDOW')
    if completed:E.need(record.get('status')=='completed' and record.get('conclusion')=='success','PRODUCTION_RUN_RESULT')
    return {'kind':'cn-mvp-authenticated-production-context-v1','binding':payload,
        'releaseSha256':release,'providerRun':record,'authorityGranted':False}


def ensure_production_context(approval,release,profile,*,reader=E.private,github=None,writer=None):
    """Resolve the one authenticated run; retain it once under a fixed root path.

    Missing existing gh authentication is an explicit boundary. No token is
    exported and no provider mutation is performed.
    """
    identity=E.module().identity(profile['identity'])
    E.need(profile['productionCorrelation']=='cn-mvp-'+identity['releaseId']+'-production','CONTEXT_CORRELATION')
    profile_raw=reader(Path('/var/lib/workspacex-cn/release-inputs')/release/'mvp-profile.json')
    E.need(S.parse(profile_raw)==profile and E.sha(profile_raw)==approval['mvp']['stageInputs']['profileSha256'],'CONTEXT_PROFILE_PIN')
    policy_raw=reader(Path('/var/lib/workspacex-cn/release-inputs')/release/'policy.json')
    E.need(E.sha(policy_raw)==approval['acquire']['requests']['consume']['inputs']['policy'],'CONTEXT_POLICY_PIN')
    github=github or provider_for(approval,release,reader)
    listing=github('/repos/boardx/workspacex/actions/workflows/release-cn-fixed.yml/runs?event=workflow_dispatch&branch=main&per_page=100')
    E.need(type(listing.get('workflow_runs'))is list,'CONTEXT_PROVIDER_LIST')
    hits=[r for r in listing['workflow_runs']if r.get('display_title')==profile['productionCorrelation']
        and S.instant(approval['identity']['requestedAt'])<=S.instant(r['created_at'])<=S.instant(approval['identity']['deadlineAt'])]
    E.need(len(hits)==1,'CONTEXT_UNIQUE_RUN_REQUIRED')
    payload=dict(identity=identity,buildRunId=approval['mvp']['buildRunId'],transferRunId=approval['mvp']['transferRunId'],
        productionRunId=hits[0]['id'],requestedAt=approval['identity']['requestedAt'],deadlineAt=approval['identity']['deadlineAt'])
    context=production_context(approval,release,payload,github)
    E.need(context['providerRun']['id']==hits[0]['id'],'CONTEXT_PROVIDER_RACE')
    context['productionRunId']=payload['productionRunId']
    path=Path('/var/lib/workspacex-cn/release-generated')/release/'mvp-production-run.json'
    raw=E.encode(context)
    if writer is None:
        advance=module('context_advance',Path(__file__).parents[1]/'.harness/scripts/vm/cn-release-advance.py')
        advance.directory(path.parent)
        try:retained=advance.read(path)
        except FileNotFoundError:advance.create(path,raw);advance.fsync_dir(path.parent)
        else:
            # The provider run may move from in_progress to completed; retain
            # initial identity rather than require identical mutable metadata.
            old=S.parse(retained);E.need(old['binding']==payload and old['releaseSha256']==release,'CONTEXT_REBIND_FORBIDDEN')
    else:writer(path,raw)
    return context


def materialize_content_backup(approval,release,template,*,advance=None):
    """Derive content backup proof from the actual admitted current A2 result."""
    advance=advance or module('backup_advance',Path(__file__).parents[1]/'.harness/scripts/vm/cn-release-advance.py')
    attempt=approval['identity']['attemptId'];E.need(advance.ATTEMPT.fullmatch(attempt),'BACKUP_ATTEMPT')
    path=advance.STATE/attempt/'11-rds-backup.receipt.json'
    receipt=S.parse(advance.read(path));manifest,_=advance.load_package(receipt['requestSha256'],attempt)
    advance.verify_historical_receipt(path,receipt,manifest)
    E.need(manifest['stage']=='rds-backup' and all(manifest[k]==approval['identity'][k]
        for k in ('sourceRevision','controlRevision','requestedAt','deadlineAt')),'BACKUP_RELEASE')
    raw=advance.read(path.with_name('11-rds-backup.evidence.json'))
    value=S.parse(raw)
    E.need(set(template)=={'sourceRevision','requestSha256','beforeStateSha256','dbInstanceId','database'}
        and template['database']=='workspacex_a1cb_20261006','BACKUP_TEMPLATE_FIELDS')
    E.need(value['dbInstanceId']=='pgm-uf6rg214cp381l49' and value['backupStatus']=='Success'
        and value['metaStatus']=='OK' and value['isolatedRestoreTested']is False,'BACKUP_CURRENT_RESULT')
    E.need(S.instant(approval['identity']['requestedAt'])<=S.instant(value['backupEndTime'])
        <=S.instant(approval['identity']['deadlineAt']),'BACKUP_CURRENT_WINDOW')
    E.need(template['sourceRevision']==approval['identity']['sourceRevision']
        and template['requestSha256']==approval['mvp']['contentManifestSha256']
        and template['dbInstanceId']==value['dbInstanceId'],'BACKUP_TEMPLATE_BINDING')
    return E.encode(dict(template,kind='cn-content-backup-observation-v1',status='Success',
        snapshotId=str(value['backupId']),completedAt=value['backupEndTime'],independentlyObserved=True))


def verify_retained_hooks(approval,release,switch,payload,schema_raw,content_raw,*,reader=E.private):
    root=Path('/var/lib/workspacex-cn/release-generated')/release/'mvp-stages'
    receipt=S.parse(reader(root/'held-content.json'))
    switch_path=Path('/var/lib/workspacex-cn/continuation')/approval['identity']['attemptId']/'13-switch.receipt.json'
    E.need(S.parse(reader(switch_path))==switch,'HOOK_SWITCH_BYTES')
    E.need(receipt['kind']=='cn-mvp-held-content-hook-v1' and receipt['releaseSha256']==release
        and receipt['switchReceiptSha256']==E.sha(reader(switch_path)),'HOOK_RELEASE')
    E.need(S.parse(reader(root/'intent.json'))==dict(releaseSha256=release,
        switchReceiptSha256=receipt['switchReceiptSha256'],automaticRetry=False),'HOOK_INTENT')
    required={'schema.json','schema-request.json','content/request.json','content/preflight.json','content/apply.json','content/readback.json','content/backup.json'}
    E.need(set(receipt['originals'])==required,'HOOK_ORIGINALS')
    originals={name:reader(root/name)for name in required}
    E.need(all(E.sha(raw)==receipt['originals'][name]for name,raw in originals.items()),'HOOK_ORIGINAL_CHANGED')
    E.need(originals['schema.json']==schema_raw and originals['content/readback.json']==content_raw,'HOOK_READBACK_CHANGED')
    E.need(E.sha(originals['content/request.json'])==payload['identity']['contentManifestSha256'],'HOOK_CONTENT_REQUEST')
    E.need(S.parse(originals['schema.json'])['productionRunId']==payload['productionRunId'],'HOOK_PRODUCTION_RUN')
    E.need(receipt['schemaReadbackPassed']is True and receipt['contentReadbackPassed']is True
        and receipt['fullBusinessAcceptance']is False,'HOOK_RESULT')


def verify(payload,bundles,objects,*,reader=E.private,advance=None,github=None,completed=True):
    """Verify authenticated metadata and actual admitted root execution history."""
    advance=advance or module('trusted_advance',Path(__file__).parents[1]/'.harness/scripts/vm/cn-release-advance.py')
    parsed={stage:S.parse(raw)for stage,raw in bundles.items()}
    def original(stage,role):return objects[parsed[stage]['originals'][role]]
    def value(stage,role):return S.parse(original(stage,role))
    # Authorization is retained in a successful root-admitted switch package.
    switch=historical(parsed['deploy'],objects,advance)
    manifest,files=advance.load_package(switch['requestSha256'],switch['attemptId'])
    authorization=files['authorization.json'];approval=S.parse(authorization)
    E.need(reader(Path('/etc/workspacex-cn/release-approvals')/(E.sha(authorization)+'.json'))==authorization,'APPROVAL_NOT_INSTALLED')
    E.need(approval['target']=={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'},'TRUSTED_TARGET')
    code=approval['codeFiles'];repo=Path(__file__).parents[1]
    E.need(code.get('scripts/cn-release-mvp-trusted-collector.py')==E.sha(Path(__file__).read_bytes()),'COLLECTOR_CODE_PIN')
    for name,pin in code.items():
        E.need(type(name)is str and not name.startswith('/') and all(part not in ('','.','..')for part in name.split('/')),'COLLECTOR_CODE_PATH')
        # advance.read authenticates root ownership and immutable file bytes.
        E.need(E.sha(advance.read(repo/name))==pin,'COLLECTOR_CODE_CHANGED')
    E.need(all(approval['identity'][key]==payload['identity'][key]for key in ('sourceRevision','controlRevision'))
        and all(approval['identity'][key]==payload[key]for key in ('requestedAt','deadlineAt')),'TRUSTED_RELEASE')
    contract=module('cn-release-mvp-contract');contract.validate_metadata(approval['mvp'])
    E.need(all(approval['mvp'][key]==expected for key,expected in {
        'acceptanceScope':'mvp-non-model','contentManifestSha256':payload['identity']['contentManifestSha256'],
        'buildRunId':payload['buildRunId'],'transferRunId':payload['transferRunId']}.items()),'TRUSTED_MVP_BINDING')
    pins=approval['acquire']['requests']['consume']['inputs']
    for role in ('proof','policy','plan'):
        actual=original('build','candidatePlan')if role=='plan'else original('transfer',role)
        E.need(E.sha(actual)==pins[role],'TRUSTED_ACQUIRE_ORIGINAL')
    policy=value('transfer','policy');github=github or provider_for(approval,E.sha(authorization),reader)
    # Raw approval hashing is checked above; canonical JSON re-serialization is
    # not used here because the installed authority may retain a final newline.
    production_context(approval,E.sha(authorization),payload,github,completed=completed)
    # Re-fetch actual provider run and artifact metadata; do not trust retained
    # JSON's success fields merely because its content address is consistent.
    for stage,runid in (('build',payload['buildRunId']),('transfer',payload['transferRunId'])):
        actual=github(f'/repos/boardx/workspacex/actions/runs/{runid}')
        expected=value(stage,'run')
        fields=('id','head_sha','head_branch','event','run_attempt','status','conclusion','path','created_at')
        E.need(all(actual.get(key)==expected.get(key)for key in fields)
            and actual.get('repository',{}).get('full_name')==expected.get('repository',{}).get('full_name')
            and actual.get('run_attempt')==1,'AUTHENTICATED_RUN_CHANGED')
    actual_listing=github(f'/repos/boardx/workspacex/actions/runs/{payload["buildRunId"]}/artifacts?per_page=100')
    E.need(actual_listing==value('build','artifacts'),'AUTHENTICATED_ARTIFACTS_CHANGED')
    bound=E.module().bind(payload['identity'],value('build','run'),actual_listing)
    transfer=module('cn-release-mvp-transfer-input')
    candidate=transfer.metadata_zip(bound['artifacts']['plan'],{'cn-candidate-plan.json'},github)['cn-candidate-plan.json']
    E.need(candidate==original('build','candidatePlan'),'AUTHENTICATED_PLAN_CHANGED')
    metadata=transfer_metadata(payload,github)
    for member,role in (('upload-plan.json','plan'),('hk-template.json','template'),('proof.json','proof'),('policy.json','policy')):
        E.need(metadata[member]==original('transfer',role),'AUTHENTICATED_TRANSFER_ORIGINAL_CHANGED')
    # RDS originals are authenticated by the existing protected SDK execution
    # admission, including immutable provider response/evidence files.
    backup=historical(parsed['backup'],objects,advance)
    E.need(backup['stage']=='rds-backup' and backup['evidenceSha256']==E.sha(original('backup','rdsReceipt')),'TRUSTED_RDS_RESULT')
    observe=historical(parsed['acceptance'],objects,advance)
    E.need(observe['stage']=='observe','TRUSTED_NONMODEL_STAGE')
    E.need(observe['evidenceSha256']==E.sha(original('acceptance','readback')),'TRUSTED_NONMODEL_RESULT')
    verify_retained_hooks(approval,E.sha(authorization),switch,payload,original('schema','readback'),original('content','readback'),reader=reader)
    return {'kind':'cn-mvp-trusted-provenance-report-v1','releaseSha256':E.sha(authorization),'authenticatedProviderReadbackVerified':True,
        'historicalRootAdmissionVerified':True,'productionAccepted':completed}
