#!/usr/bin/env python3
"""Offline protected recovery artifact replay. No mutation/network/DB transport.
Admission stays blocked: production recovery executor is not implemented.
"""
import hashlib,json,os,re,stat,struct,sys,subprocess
from pathlib import Path
PRODUCTION='pgm-uf6rg214cp381l49'
DATABASES={'workspacex','workspacex_agent','workspacex_memory'}
class Rejected(ValueError):pass

def require(ok,code):
    if not ok:raise Rejected(code)

def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def hexhash(value):return type(value) is str and re.fullmatch('[a-f0-9]{64}',value) is not None

def exact_identity(value):
    require(type(value) is dict and set(value)=={'sourceRevision','baselineRevision','migrationPlanSha256','attemptId'},'IDENTITY_SCHEMA')
    for key,size in [('sourceRevision',40),('baselineRevision',40),('migrationPlanSha256',64)]:
        require(type(value[key]) is str and re.fullmatch('[a-f0-9]{%d}'%size,value[key]),'IDENTITY_SHAPE')
    require(type(value['attemptId']) is str and re.fullmatch('[A-Za-z0-9-]{1,128}',value['attemptId']),'IDENTITY_SHAPE')
    return value

class ProtectedArtifacts:
    """Owner overrides only for disposable local test API, never CLI flags."""
    def __init__(self,root,uid=0,gid=0,max_bytes=2*1024**3):
        self.root=Path(root);self.uid=uid;self.gid=gid;self.max_bytes=max_bytes;self.total=0;self.snapshots={}
        require(self.root.is_absolute(),'ARTIFACT_ROOT_ABSOLUTE')
        self._parents(self.root)
        st=self.root.lstat();require(stat.S_IMODE(st.st_mode)==0o700,'ARTIFACT_ROOT_PRIVATE')
    def _parents(self,path):
        for parent in (path,*path.parents):
            # Non-root uid overrides belong solely to the disposable test API.
            # Production uses uid=0 and still verifies every ancestor to '/'.
            if self.uid != 0 and parent == self.root.parent:break
            st=parent.lstat()
            require(stat.S_ISDIR(st.st_mode) and st.st_uid in (0,self.uid) and
                    (not st.st_mode&0o022 or st.st_mode&stat.S_ISVTX),'ARTIFACT_PARENT_TRUST')
    def identity(self,path):
        try:st=path.lstat()
        except FileNotFoundError:raise Rejected('ACTUAL_ARTIFACT_MISSING') from None
        require(stat.S_ISREG(st.st_mode) and st.st_uid==self.uid and st.st_gid==self.gid and
                stat.S_IMODE(st.st_mode)==0o600 and st.st_nlink==1,'ARTIFACT_FILE_TRUST')
        return (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_uid,st.st_gid,st.st_mode,st.st_nlink)
    def path(self,ref):
        require(type(ref) is dict and set(ref)=={'path','sha256','bytes'} and hexhash(ref['sha256']) and
                type(ref['bytes']) is int and 0<=ref['bytes']<=self.max_bytes,'ARTIFACT_REFERENCE_SCHEMA')
        p=Path(ref['path'])
        require(p.is_absolute() and '..' not in p.parts and p!=self.root and self.root in p.parents,'ARTIFACT_PATH_SCOPE')
        self._parents(p.parent)
        return p
    def blocks(self,ref):
        path=self.path(ref);before=self.identity(path);h=hashlib.sha256();size=0
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as stream:
            opened=os.fstat(stream.fileno());require((opened.st_dev,opened.st_ino)==before[:2],'ARTIFACT_CHANGED')
            while True:
                block=stream.read(65536)
                if not block:break
                h.update(block);size+=len(block);self.total+=len(block)
                require(size<=ref['bytes'] and self.total<=self.max_bytes,'ARTIFACT_BYTE_BOUND')
                yield block
        require(self.identity(path)==before and size==ref['bytes'] and h.hexdigest()==ref['sha256'],'ARTIFACT_HASH_OR_IDENTITY')
        existing=self.snapshots.get(path)
        require(existing is None or existing==(before,ref['sha256']),'ARTIFACT_REBIND')
        self.snapshots[path]=(before,ref['sha256'])
    def json(self,ref):
        require(ref.get('bytes',0)<=4*1024**2,'ARTIFACT_JSON_BOUND')
        try:return json.loads(b''.join(self.blocks(ref)))
        except (json.JSONDecodeError,UnicodeError):raise Rejected('ARTIFACT_JSON_INVALID') from None
    def reference(self,path):
        path=Path(path);require(self.root in path.parents,'ARTIFACT_PATH_SCOPE')
        self._parents(path.parent);before=self.identity(path)
        require(before[2]<=4*1024**2,'ARTIFACT_JSON_BOUND')
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as stream:
            opened=os.fstat(stream.fileno());require((opened.st_dev,opened.st_ino)==before[:2],'ARTIFACT_CHANGED')
            raw=stream.read(4*1024**2+1)
        require(self.identity(path)==before and len(raw)==before[2],'ARTIFACT_CHANGED')
        return {'path':str(path),'sha256':sha(raw),'bytes':len(raw)}
    def finish(self):
        for path,(expected,digest) in self.snapshots.items():
            require(self.identity(path)==expected,'ARTIFACT_CHANGED_AFTER_REPLAY')
            h=hashlib.sha256();fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            with os.fdopen(fd,'rb') as stream:
                for block in iter(lambda:stream.read(65536),b''):h.update(block)
            require(h.hexdigest()==digest and self.identity(path)==expected,'ARTIFACT_CHANGED_AFTER_REPLAY')


def multiset(reader,ref):
    require(ref['bytes']%32==0,'ROW_HASH_STREAM_TRUNCATED')
    h=hashlib.sha256(b'WSX-MULTISET-V1\0');previous=None;count=0
    for block in reader.blocks(ref):
        require(len(block)%32==0,'ROW_HASH_STREAM_TRUNCATED')
        for start in range(0,len(block),32):
            value=block[start:start+32]
            require(previous is None or previous<=value,'ROW_HASH_STREAM_UNSORTED')
            previous=value;h.update(value);count+=1
    h.update(struct.pack('>Q',count))
    return {'rows':count,'multisetSha256':h.hexdigest()}


def keyed(items,fields,code):
    require(type(items) is list,code)
    result={}
    for value in items:
        require(type(value) is dict and all(type(value.get(k)) is str for k in fields),code)
        key=tuple(value[k] for k in fields);require(key not in result,code);result[key]=value
    return result


def replay(evidence,manifest,reader,evidence_raw=None):
    require(type(evidence) is dict and set(evidence)=={'schemaVersion','identity','toolRevision','fidelityReceipts','productionRecoveryAdapterSha256','objectRecoveryEvidenceSha256'},'RECOVERY_EVIDENCE_SCHEMA')
    actual_raw=canonical(evidence) if evidence_raw is None else evidence_raw
    require(json.loads(actual_raw)==evidence and manifest.get('evidenceSha256')==sha(actual_raw),'EVIDENCE_RAW_BINDING')
    bound=exact_identity(evidence['identity'])
    require(evidence['schemaVersion']==1 and type(evidence['toolRevision']) is str and re.fullmatch('[a-f0-9]{40}',evidence['toolRevision']),'TOOL_IDENTITY')
    require(type(evidence['fidelityReceipts']) is dict and set(evidence['fidelityReceipts'])==DATABASES,'THREE_DATABASE_CLOSURE')
    require(manifest['schemaVersion']==1 and manifest['identity']==bound and manifest['toolRevision']==evidence['toolRevision'],'ARTIFACT_MANIFEST_IDENTITY')
    require(manifest['sourceInstanceId']==PRODUCTION and re.fullmatch('pgm-[a-z0-9]+',manifest['targetInstanceId']) and manifest['targetInstanceId']!=PRODUCTION,'PRODUCTION_TARGET_FORBIDDEN')
    require(type(manifest['databases']) is dict and set(manifest['databases'])==DATABASES,'THREE_DATABASE_CLOSURE')
    baseline=reader.json(manifest['baselineManifest'])
    require(baseline['baselineRevision']==bound['baselineRevision'] and baseline['sourceInstanceId']==PRODUCTION and
            type(baseline.get('snapshotId')) is str and baseline['snapshotId'] and set(baseline['databases'])==DATABASES,'EXACT_BASELINE_CLOSURE')
    total_tables=total_rows=total_sequences=0
    for db in sorted(DATABASES):
        refs=manifest['databases'][db];pins=baseline['databases'][db]
        require(all(refs[k]==pins[k] for k in ('backupReceipt','ciphertext','sourceCatalog','sourceRolesAcl','sourceSequences','sourceVersion')),'BASELINE_ARTIFACT_PIN')
        backup=reader.json(refs['backupReceipt'])
        require(backup.get('database')==db and backup.get('sourceRdsInstanceId')==PRODUCTION and backup.get('dumpExit')==0 and
                backup.get('encryptionExit')==0 and backup.get('cleanupVerified') is True and
                backup.get('ciphertextSha256')==refs['ciphertext']['sha256'] and backup.get('bytes')==refs['ciphertext']['bytes'] and
                hexhash(backup.get('recipientCertificateSha256')),'IMMUTABLE_BACKUP_ARTIFACT')
        for _ in reader.blocks(refs['ciphertext']):pass
        execution=reader.json(refs['restoreExecution'])
        require(execution.get('identity')==bound and execution.get('toolRevision')==evidence['toolRevision'] and execution.get('database')==db and
                execution.get('sourceInstanceId')==PRODUCTION and execution.get('targetInstanceId')==manifest['targetInstanceId'] and
                execution.get('ciphertextSha256')==refs['ciphertext']['sha256'] and execution.get('restoreExit')==0 and execution.get('decryptExit')==0 and
                execution.get('snapshotId')==baseline['snapshotId'],'RESTORE_EXECUTION_BINDING')
        source_catalog=reader.json(refs['sourceCatalog']);target_catalog=reader.json(refs['restoredCatalog'])
        require(type(source_catalog) is dict and set(source_catalog)=={'tables','sequences','aclObjects'} and canonical(source_catalog)==canonical(target_catalog),'RESTORED_CATALOG_MISMATCH')
        require(source_catalog['tables'],'FULL_TABLE_CATALOG_REQUIRED')
        tables=keyed(source_catalog['tables'],('schema','table'),'TABLE_CATALOG_CLOSURE');sequences=keyed(source_catalog['sequences'],('schema','sequence'),'SEQUENCE_CATALOG_CLOSURE')
        source_roles=reader.json(refs['sourceRolesAcl']);target_roles=reader.json(refs['restoredRolesAcl'])
        require(type(source_roles) is dict and set(source_roles)=={'roles','memberships','databaseAcl','objectAcl'} and
                all(type(v) is list for v in source_roles.values()) and source_roles['roles'] and canonical(source_roles)==canonical(target_roles),'ROLE_ACL_BASELINE_MISMATCH')
        role_map=keyed(source_roles['roles'],('name',),'ROLE_DEFINITION_CLOSURE')
        require(all(set(role)=={'name','superuser','inherit','createRole','createDb','canLogin','replication','bypassRls','connectionLimit','validUntil'} for role in role_map.values()),'FULL_ROLE_DEFINITION_REQUIRED')
        acl_map=keyed(source_roles['objectAcl'],('schema','name','kind'),'OBJECT_ACL_CLOSURE')
        expected_acl=set(keyed(source_catalog['aclObjects'],('schema','name','kind'),'FULL_ACL_CATALOG_CLOSURE'))
        minimum_acl={(schema,name,'table') for schema,name in tables} | {(schema,name,'sequence') for schema,name in sequences}
        require(minimum_acl<=expected_acl and all(key[2] in {'table','sequence','schema','function','procedure','type','database','default-privilege','language','foreign-data-wrapper','foreign-server','large-object'} for key in expected_acl),'FULL_ACL_CATALOG_CLOSURE')
        require(set(acl_map)==expected_acl and all(set(item)=={'schema','name','kind','owner','acl'} and type(item['acl']) is list for item in acl_map.values()),'OBJECT_ACL_CLOSURE')
        source_sequences=keyed(reader.json(refs['sourceSequences']),('schema','sequence'),'SEQUENCE_OBSERVATION_SCHEMA')
        restored_sequences=keyed(reader.json(refs['restoredSequences']),('schema','sequence'),'SEQUENCE_OBSERVATION_SCHEMA')
        require(set(source_sequences)==set(sequences)==set(restored_sequences) and canonical(source_sequences_to_list(source_sequences))==canonical(source_sequences_to_list(restored_sequences)),'SEQUENCE_BASELINE_MISMATCH')
        for observed in source_sequences.values():
            require(set(observed)=={'schema','sequence','relkind','type','seqstart','seqincrement','seqmax','seqmin','seqcache','seqcycle','last_value','is_called'} and observed['relkind']=='S' and
                    type(observed['is_called']) is bool and type(observed['seqcycle']) is bool,'SEQUENCE_FULL_DEFINITION_REQUIRED')
        source_version=reader.json(refs['sourceVersion']);target_version=reader.json(refs['targetVersion'])
        require(source_version['database']==db and target_version['database']==db and source_version['instanceId']==PRODUCTION and target_version['instanceId']==manifest['targetInstanceId'],'VERSION_TARGET_BINDING')
        for version in (source_version,target_version):
            require(type(version.get('serverVersionNum')) is int and type(version.get('clientVersionNum')) is int and version['clientVersionNum']//10000>=version['serverVersionNum']//10000,'POSTGRES_VERSION_COMPATIBILITY')
        require(source_version['serverVersionNum']//10000==target_version['serverVersionNum']//10000 and execution['clientVersionNum']==target_version['clientVersionNum'],'RESTORED_VERSION_BASELINE')
        receipt=reader.json(refs['fidelityReceipt'])
        require(receipt.get('schemaVersion')==1 and receipt.get('readOnly') is True and receipt.get('rollbackComplete') is True and receipt.get('dataFidelityVerified') is True and hexhash(receipt.get('targetPeerAddressSha256')) and receipt==evidence['fidelityReceipts'][db] and receipt.get('database')==db and receipt.get('targetRdsInstanceId')==manifest['targetInstanceId'] and
                receipt.get('backupReceiptSha256')==refs['backupReceipt']['sha256'] and receipt.get('ciphertextSha256')==refs['ciphertext']['sha256'],'FIDELITY_RECEIPT_ARTIFACT_BINDING')
        proofs=keyed(receipt['tables'],('schema','table'),'FIDELITY_TABLE_CLOSURE');streams=keyed(refs['tableRowHashStreams'],('schema','table'),'ROW_STREAM_TABLE_CLOSURE')
        require(set(tables)==set(proofs)==set(streams),'FULL_TABLE_STREAM_CLOSURE')
        require(keyed(receipt['sequences'],('schema','sequence'),'FIDELITY_SEQUENCE_CLOSURE')==source_sequences,'FIDELITY_SEQUENCE_MISMATCH')
        for key,metadata in tables.items():
            require(type(metadata.get('columns')) is list and metadata['columns'] and len(set(metadata['columns']))==len(metadata['columns']) and type(metadata.get('columnTypes')) is list and len(metadata['columnTypes'])==len(metadata['columns']) and type(metadata.get('owner')) is str and type(metadata.get('rls')) is bool and hexhash(metadata.get('ddlSha256')) and hexhash(metadata.get('policySha256')),'FULL_COLUMN_CLOSURE')
            require(proofs[key]['columns']==metadata['columns'],'FIDELITY_COLUMN_MISMATCH')
            expected=multiset(reader,streams[key]['source']);actual=multiset(reader,streams[key]['restored'])
            require(expected==actual and all(proofs[key].get(k)==v for k,v in expected.items()),'ACTUAL_TABLE_DATA_MISMATCH')
            total_rows+=expected['rows'];total_tables+=1
        total_sequences+=len(sequences)
    reader.finish()
    return {'schemaVersion':1,'scope':'offline-artifact-equivalence-only','databaseCount':3,'tables':total_tables,'rows':total_rows,'sequences':total_sequences,
            'ready':False,'productionRecoveryVerified':False,'remainingGapCodes':['PRODUCTION_RECOVERY_EXECUTOR_NOT_IMPLEMENTED','FULL_OBJECT_RECOVERY_PROOF_UNVERIFIED','ACTUAL_ARTIFACT_COLLECTION_PROVENANCE_REQUIRED','THREE_DB_CONSISTENT_SNAPSHOT_UNPROVEN']}


def source_sequences_to_list(values):return [values[k] for k in sorted(values)]

def admission_result(_audit):
    # Artifact equivalence is not a usable recovery executor. Never emit the
    # admission-compatible fact object until that separate capability exists.
    raise Rejected('PRODUCTION_RECOVERY_EXECUTOR_NOT_IMPLEMENTED')


def verify_exact_source(profile,installed_raw):
    tool=profile.get('toolRevision')
    require(type(tool) is str and re.fullmatch('[a-f0-9]{40}',tool),'TOOL_REVISION_REQUIRED')
    root=Path('/opt/workspacex-cn/release-tools')/tool
    for directory in (root,*root.parents):
        st=directory.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'TOOL_SOURCE_ROOT_TRUST')
    gitdir=root/'.git';require(gitdir.is_dir() and not gitdir.is_symlink(),'TOOL_GIT_DIRECTORY_REQUIRED')
    for relative in ('commondir','gitdir','objects/info/alternates'):
        require(not os.path.lexists(gitdir/relative),'TOOL_BORROWED_SOURCE')
    config=gitdir/'config';st=config.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022 and st.st_nlink==1,'TOOL_CONFIG_TRUST')
    fd=os.open(config,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:raw=stream.read(1024*1024+1)
    require(len(raw)<=1024*1024 and not re.search(rb'^\s*\[(?:include(?:if)?|filter)[\s\]]',raw,re.M|re.I),'TOOL_EXTERNAL_CONFIG')
    environment={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0'}
    source='.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py'
    try:actual=subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','gc.auto=0','-C',str(root),'show',tool+':'+source],env=environment,stderr=subprocess.DEVNULL,timeout=15)
    except Exception:raise Rejected('EXACT_TOOL_SOURCE_MISSING') from None
    require(actual==installed_raw and profile.get('filesSha256',{}).get(source)==sha(actual),'EXACT_TOOL_SOURCE_DRIFT')

def attempt_manifest(reader,root,identity,tool_revision):
    """Attempt inputs are private data, never synthesized by tool installation."""
    binding=reader.json(reader.reference(root/'recovery-binding.json'))
    require(type(binding) is dict and set(binding)=={'schemaVersion','identity','toolRevision','artifactManifest'},'ATTEMPT_BINDING_SCHEMA')
    require(binding['schemaVersion']==1 and binding['identity']==identity and binding['toolRevision']==tool_revision,'ATTEMPT_BINDING_IDENTITY')
    ref=binding['artifactManifest']
    require(type(ref) is dict and ref.get('path')==str(root/'recovery-artifacts.json'),'RESTORE_REPLAY_ARTIFACT_MANIFEST_MISSING')
    # json() checks exact path/hash/bytes and immutable root-private identity.
    return reader.json(ref)

def prehold_artifact_replay(evidence,manifest,reader,evidence_raw=None):
    audit=replay(evidence,manifest,reader,evidence_raw=evidence_raw)
    # The comparator has no authenticated common-snapshot/object collector.
    # A declaration in JSON (including passed=true) cannot supply either proof.
    if 'THREE_DB_CONSISTENT_SNAPSHOT_UNPROVEN' in audit['remainingGapCodes']:
        raise Rejected('PREHOLD_COMMON_SNAPSHOT_PROOF_UNVERIFIED')
    if 'FULL_OBJECT_RECOVERY_PROOF_UNVERIFIED' in audit['remainingGapCodes']:
        raise Rejected('PREHOLD_OBJECT_RECOVERY_PROOF_UNVERIFIED')
    raise Rejected('PREHOLD_ARTIFACT_PROVENANCE_UNVERIFIED')

def prehold_main(path):
    """Offline prerequisite audit: no hold, lock, mutation or executor import."""
    require(os.geteuid()==0 and os.getegid()==0,'ROOT_ONLY')
    base=Path('/etc/workspacex-cn/maintenance-evidence')
    requested=Path(path)
    require(requested.is_absolute() and '..' not in requested.parts and requested.name=='recovery.json' and len(requested.parts)==len(base.parts)+3 and base in requested.parents,'FIXED_EVIDENCE_PATH')
    root=requested.parent;reader=ProtectedArtifacts(root)
    ref=reader.reference(requested);raw=b''.join(reader.blocks(ref));evidence=json.loads(raw)
    bound=exact_identity(evidence.get('identity'))
    require(root==base/bound['sourceRevision']/bound['attemptId'],'FIXED_EVIDENCE_PATH')
    profile_path=Path('/etc/workspacex-cn/trusted-tool-binding.json')
    profile_reader=ProtectedArtifacts(profile_path.parent)
    profile=profile_reader.json(profile_reader.reference(profile_path))
    installed=Path('/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py')
    info=profile.get('maintenanceRecoveryVerifier',{})
    source='.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py'
    require(info.get('installedPath')==str(installed) and info.get('sourcePath')==source and hexhash(info.get('sha256')) and profile.get('filesSha256',{}).get(source)==info['sha256'],'INSTALLED_VERIFIER_PROFILE')
    for parent in installed.parents:
        st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'INSTALLED_VERIFIER_PARENT_TRUST')
    st=installed.lstat();require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_gid==0 and stat.S_IMODE(st.st_mode)==0o700 and st.st_nlink==1,'INSTALLED_VERIFIER_TRUST')
    before=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
    fd=os.open(installed,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        opened=os.fstat(stream.fileno());require((opened.st_dev,opened.st_ino)==before[:2],'INSTALLED_VERIFIER_CHANGED')
        installed_raw=stream.read(1024*1024+1)
    require(len(installed_raw)<=1024*1024 and sha(installed_raw)==info['sha256'],'INSTALLED_VERIFIER_PROFILE')
    verify_exact_source(profile,installed_raw)
    require(evidence.get('toolRevision')==profile.get('toolRevision'),'ROOT_PROFILE_BASELINE_BINDING')
    manifest=attempt_manifest(reader,root,bound,profile['toolRevision'])
    require(manifest.get('evidenceSha256')==sha(raw),'EVIDENCE_RAW_BINDING')
    # Check closure again even when the subsequent proof gate rejects.
    profile_reader.finish();verify_exact_source(profile,installed_raw)
    current=installed.lstat();require((current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns,current.st_ctime_ns)==before,'INSTALLED_VERIFIER_CHANGED')
    return prehold_artifact_replay(evidence,manifest,reader,evidence_raw=raw)

def main():
    require(os.geteuid()==0 and os.getegid()==0,'ROOT_ONLY')
    require(len(sys.argv)==3 and sys.argv[1] in ('--maintenance-evidence-replay','--prehold-artifact-audit'),'USAGE')
    if sys.argv[1]=='--prehold-artifact-audit':return prehold_main(sys.argv[2])
    from cn_maintenance_hold import require_canonical_lock,HoldStore,CANONICAL_DIRECTORY
    require_canonical_lock();held=HoldStore(CANONICAL_DIRECTORY).read()
    require(held is not None and held['state']=='held','MAINTENANCE_HOLD_REQUIRED')
    bound=exact_identity(held['identity']);root=Path('/etc/workspacex-cn/maintenance-evidence')/bound['sourceRevision']/bound['attemptId']
    require(sys.argv[2]==str(root/'recovery.json'),'FIXED_EVIDENCE_PATH')
    reader=ProtectedArtifacts(root)
    # Canonical caller hash-validates profile and this verifier against exact
    # tool Git object; standalone CLI also pins profile verifier installed bytes.
    profile_path=Path('/etc/workspacex-cn/trusted-tool-binding.json')
    profile_reader=ProtectedArtifacts(profile_path.parent)
    profile=profile_reader.json(profile_reader.reference(profile_path))
    installed=Path('/usr/local/lib/workspacex-cn/cn-maintenance-recovery-evidence-verifier.py')
    verifier_profile=profile.get('maintenanceRecoveryVerifier',{})
    require(verifier_profile.get('installedPath')==str(installed) and hexhash(verifier_profile.get('sha256')) and verifier_profile.get('sourcePath')=='.harness/scripts/vm/cn-maintenance-recovery-evidence-verifier.py' and profile.get('filesSha256',{}).get(verifier_profile.get('sourcePath'))==verifier_profile['sha256'],'INSTALLED_VERIFIER_PROFILE')
    for parent in installed.parents:
        parent_st=parent.lstat();require(stat.S_ISDIR(parent_st.st_mode) and parent_st.st_uid==0 and not parent_st.st_mode&0o022,'INSTALLED_VERIFIER_PARENT_TRUST')
    st=installed.lstat()
    installed_identity=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
    require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_gid==0 and stat.S_IMODE(st.st_mode)==0o700 and st.st_nlink==1,'INSTALLED_VERIFIER_TRUST')
    fd=os.open(installed,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        opened=os.fstat(stream.fileno());require((opened.st_dev,opened.st_ino)==(st.st_dev,st.st_ino),'INSTALLED_VERIFIER_CHANGED')
        verifier_raw=stream.read(1024*1024+1)
    require(len(verifier_raw)<=1024*1024 and sha(verifier_raw)==verifier_profile['sha256'],'INSTALLED_VERIFIER_PROFILE')
    verify_exact_source(profile,verifier_raw)
    manifest=attempt_manifest(reader,root,bound,profile['toolRevision']);evidence_ref=reader.reference(root/'recovery.json');evidence_raw=b''.join(reader.blocks(evidence_ref));evidence=json.loads(evidence_raw)
    require(manifest.get('evidenceSha256')==sha(evidence_raw) and evidence.get('identity')==bound and evidence.get('toolRevision')==profile.get('toolRevision'),'ROOT_PROFILE_BASELINE_BINDING')
    audit=replay(evidence,manifest,reader,evidence_raw=evidence_raw)
    profile_reader.finish();verify_exact_source(profile,verifier_raw)
    current=installed.lstat();require((current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns,current.st_ctime_ns)==installed_identity,'INSTALLED_VERIFIER_CHANGED')
    require_canonical_lock();require(HoldStore(CANONICAL_DIRECTORY).read()==held,'HOLD_CHANGED_DURING_REPLAY')
    admission_result(audit)

if __name__=='__main__':
    try:main()
    except Rejected as error:print('CN_MAINTENANCE_RECOVERY_REJECTED '+str(error),file=sys.stderr);sys.exit(1)
    except BaseException:print('CN_MAINTENANCE_RECOVERY_REJECTED ARTIFACT_REPLAY_FAILED',file=sys.stderr);sys.exit(1)
