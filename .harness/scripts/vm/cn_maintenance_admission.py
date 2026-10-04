"""Maintenance-only dynamic preactivate seam. No deploy/migrate/clear capability.
Trusted recovery replay implementation is required, never substituted by a receipt flag.
"""
import hashlib,json,re,subprocess,os
from cn_maintenance_hold import HoldStore,identity,require_canonical_lock,CANONICAL_DIRECTORY
OPT_IN='stop-all-writes-and-require-database-recovery'
PROFILE='/etc/workspacex-cn/trusted-tool-binding.json'
VERIFIER='/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py'
VERIFIER_SOURCE='.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py'
DATABASES={'workspacex','workspacex_agent','workspacex_memory'}

def require(condition,code):
    if not condition: raise ValueError(code)

def digest(raw):return hashlib.sha256(raw).hexdigest()

def validate_binding(value,app,attempt):
    require(value.get('mode')=='maintenance-operational-preactivate','MAINTENANCE_MODE_REQUIRED')
    require(value.get('maintenanceOptIn')==OPT_IN,'MAINTENANCE_OPT_IN_REQUIRED')
    bound=identity({'sourceRevision':app,'baselineRevision':value.get('baselineRevision'),
                    'migrationPlanSha256':value.get('migrationPlanSha256'),'attemptId':attempt})
    require(value.get('applicationRevision')==app and value.get('attemptId')==attempt,'MAINTENANCE_IDENTITY')
    require(isinstance(value.get('toolRevision'),str) and re.fullmatch('[a-f0-9]{40}',value['toolRevision']),'MAINTENANCE_TOOL_REVISION')
    for field,length in [('holdGeneration',32),('holdSha256',64),('recoveryEvidenceSha256',64)]:
        require(isinstance(value.get(field),str) and re.fullmatch('[a-f0-9]{%d}'%length,value[field]),'MAINTENANCE_BINDING_INVALID')
    return bound

def verify_replay_output(raw,expected):
    require(len(raw)<=65536,'RECOVERY_REPLAY_OUTPUT_BOUND')
    proof=json.loads(raw)
    require(type(proof) is dict and set(proof)==set(expected),'RECOVERY_REPLAY_SCHEMA')
    # Exact independently replayed facts, not truthiness/accepted/ready fields.
    require(proof==expected,'RECOVERY_REPLAY_FACT_MISMATCH')


def admit(value,*,private_read,source_read,store=None,lock_check=require_canonical_lock,replay=None,file_identity=None):
    """Injection arguments are fixture-only APIs; source-helper CLI has no overrides.
    Real default invokes fixed verifier, never evals callback code from evidence.
    FD9 is inherited by subprocess and remains owned by maintenance controller.
    """
    bound=validate_binding(value,value.get('applicationRevision'),value.get('attemptId'))
    lock_check()
    store=store or HoldStore(CANONICAL_DIRECTORY)
    before=store.read()
    require(before is not None and before['state']=='held' and before['identity']==bound and
            before['generation']==value['holdGeneration'] and before['sha256']==value['holdSha256'],'MAINTENANCE_HOLD_BINDING')
    def current_identity(path):
        st=os.lstat(path)
        return (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_uid,st.st_gid,st.st_mode,st.st_nlink)
    identify=file_identity or current_identity
    snapshots={}
    def capture(path,mode):
        before=identify(path);raw=private_read(path,mode);after=identify(path)
        require(before==after,'MAINTENANCE_PROTECTED_INPUT_CHANGED')
        snapshots[path]=(mode,raw,before)
        return raw
    binding_path='/etc/workspacex-cn/maintenance-bindings/'+bound['sourceRevision']+'/'+bound['attemptId']+'/preactivate.json'
    require(json.loads(capture(binding_path,0o600))==value,'MAINTENANCE_SOURCE_BINDING_CHANGED')
    profile_raw=capture(PROFILE,0o600)
    profile=json.loads(profile_raw)
    require(profile.get('toolRevision')==value['toolRevision'] and profile.get('filesSha256')==value['filesSha256'],'MAINTENANCE_PROFILE_IDENTITY')
    verifier_raw=capture(VERIFIER,0o700)
    source_raw=source_read(VERIFIER_SOURCE)
    expected_verifier=profile.get('maintenanceRecoveryVerifier',{})
    require(type(expected_verifier) is dict and set(expected_verifier)=={'sourcePath','installedPath','sha256'},'RECOVERY_VERIFIER_PROFILE')
    require(expected_verifier['sourcePath']==VERIFIER_SOURCE and expected_verifier['installedPath']==VERIFIER and
            re.fullmatch('[a-f0-9]{64}',expected_verifier.get('sha256','')) and digest(verifier_raw)==expected_verifier['sha256'] and
            verifier_raw==source_raw,'RECOVERY_VERIFIER_SOURCE_BINDING')
    evidence_path='/etc/workspacex-cn/maintenance-evidence/'+bound['sourceRevision']+'/'+bound['attemptId']+'/recovery.json'
    raw=capture(evidence_path,0o600)
    require(len(raw)<=4*1024*1024 and digest(raw)==value['recoveryEvidenceSha256'],'RECOVERY_EVIDENCE_HASH')
    evidence=json.loads(raw)
    require(type(evidence) is dict and set(evidence)=={'schemaVersion','identity','toolRevision','fidelityReceipts','productionRecoveryAdapterSha256','objectRecoveryEvidenceSha256'},'RECOVERY_EVIDENCE_SCHEMA')
    require(evidence['schemaVersion']==1 and evidence['identity']==bound and evidence['toolRevision']==value['toolRevision'],'RECOVERY_EVIDENCE_IDENTITY')
    for field in ('productionRecoveryAdapterSha256','objectRecoveryEvidenceSha256'):
        require(type(evidence[field]) is str and re.fullmatch('[a-f0-9]{64}',evidence[field]),'RECOVERY_EVIDENCE_HASH')
    receipts=evidence['fidelityReceipts']
    require(type(receipts) is dict and set(receipts)==DATABASES,'RECOVERY_DATABASE_CLOSURE')
    receipt_hashes={}
    for db,receipt in receipts.items():
        # An actual fidelity receipt is a structured table/sequence readback,
        # never the aggregate independentThreeDbFidelityReceiptVerification flag.
        require(type(receipt) is dict and receipt.get('schemaVersion')==1 and receipt.get('database')==db and
                receipt.get('readOnly') is True and receipt.get('rollbackComplete') is True and receipt.get('dataFidelityVerified') is True and
                type(receipt.get('tables')) is list and type(receipt.get('sequences')) is list and
                type(receipt.get('targetRdsInstanceId')) is str and re.fullmatch('pgm-[a-z0-9]+',receipt['targetRdsInstanceId']) and
                receipt['targetRdsInstanceId']!='pgm-uf6rg214cp381l49','RECOVERY_FIDELITY_RECEIPT_SCHEMA')
        for field in ('backupReceiptSha256','ciphertextSha256','targetPeerAddressSha256'):
            require(type(receipt.get(field)) is str and re.fullmatch('[a-f0-9]{64}',receipt[field]),'RECOVERY_FIDELITY_RECEIPT_HASH')
        receipt_hashes[db]=digest(json.dumps(receipt,sort_keys=True,separators=(',',':')).encode())
    expected={'schemaVersion':1,'mode':'maintenance-recovery-evidence-replayed','identity':bound,
              'toolRevision':value['toolRevision'],'recoveryEvidenceSha256':digest(raw),
              'fidelityReceiptSha256':receipt_hashes,'productionRecoveryAdapterSha256':evidence['productionRecoveryAdapterSha256'],
              'objectRecoveryEvidenceSha256':evidence['objectRecoveryEvidenceSha256']}
    command=['python3',VERIFIER,'--maintenance-evidence-replay',evidence_path]
    if replay is None:
        try: output=subprocess.check_output(command,pass_fds=(9,),stderr=subprocess.DEVNULL,timeout=60)
        except Exception: raise ValueError('RECOVERY_EVIDENCE_REPLAY_FAILED') from None
    else:output=replay(command,(9,))
    verify_replay_output(output,expected)
    for path,(mode,original_raw,original_identity) in snapshots.items():
        pre=identify(path);actual_raw=private_read(path,mode);post=identify(path)
        require(pre==original_identity==post and actual_raw==original_raw,'MAINTENANCE_PROTECTED_INPUT_CHANGED')
    require(source_read(VERIFIER_SOURCE)==source_raw,'RECOVERY_VERIFIER_SOURCE_CHANGED')
    require(store.read()==before,'MAINTENANCE_HOLD_CHANGED_DURING_REPLAY')
    lock_check()
    return {'schemaVersion':1,'mode':'maintenance-preactivate-only','identity':bound,
            'toolRevision':value['toolRevision'],'holdGeneration':before['generation'],
            'holdSha256':before['sha256'],'recoveryEvidenceSha256':digest(raw),
            'dynamicPreactivateAdmitted':True,'productionMutationAuthorized':False,
            'productionActivated':False,'ready':False}
