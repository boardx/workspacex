#!/usr/bin/env python3
"""Produce fixed stage/runtime commands from root-derived binder output.

No cloud or host mutation. The driver must authenticate the once approval and
read immutable root-owned generated files; arbitrary workspace mappings are test
fixtures only. Live observers are deliberately not fabricated by this module.
"""
import ast
import base64
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import zlib

TEMPLATE=Path(__file__).resolve().parents[1]/'.harness/scripts/vm/cn-runtime-continuation/stage-phase.py'
SOURCE='f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
BASELINE='5285bef9a6c91bbb9857ede42779aafa64b98f32'
IDENTITY=('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt')
TARGET={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'}
RUNTIME_FILES={'binding.json':'binding.json','switch-images.json':'switch-images.json',
 'rollback-images.json':'rollback-images.json','sessions-after-stop.sh':'sessions-after-stop.sh',
 'sessions-check-pins.json':'sessions-check-pins.json','upgrade-draft.py':'upgrade-draft.py',
 'backup-host.py':'backup-host.DRAFT.py','sessions-after-stop.py':'sessions-after-stop.py'}
RECEIPT_PINS={'stop-receipt.json':'stopReceiptSha256','backup-result.json':'hostBackupReceiptSha256',
              'rds-backup-receipt.json':'rdsBackupReceiptSha256'}


def need(value,code):
    if not value:raise ValueError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def parse(raw):
    def pairs(xs):
        result={}
        for k,v in xs:need(k not in result,'DUPLICATE_JSON_KEY');result[k]=v
        return result
    return json.loads(raw,object_pairs_hook=pairs)


def stamp(v):
    result=dt.datetime.fromisoformat(v.replace('Z','+00:00'));need(result.tzinfo is not None,'TIMEZONE_REQUIRED');return result


def specialize(raw,source,baseline,config):
    tree=ast.parse(raw)
    for field,old,new in [('sourceRevision',SOURCE,source),('baselineRevision',BASELINE,baseline)]:
        # Source/baseline appear as separate Compare nodes in the original guard.
        expected=ast.dump(ast.parse("b["+repr(field)+"]=="+repr(old),mode='eval').body)
        found=[n for n in ast.walk(tree)if isinstance(n,ast.Compare)and ast.dump(n)==expected]
        need(len(found)==1,'TEMPLATE_IDENTITY_GUARD_CHANGED');found[0].comparators[0]=ast.Constant(new)
    assignments=[n for n in tree.body if isinstance(n,ast.Assign)and len(n.targets)==1
        and isinstance(n.targets[0],ast.Name)and n.targets[0].id=='CONFIG']
    need(len(assignments)==1 and isinstance(assignments[0].value,ast.Name)
         and assignments[0].value.id=='__CONFIG__','TEMPLATE_CONFIG_CHANGED')
    assignments[0].value=ast.Name(id='__BOUND_CONFIG__',ctx=ast.Load()) if config is None else ast.parse(repr(config),mode='eval').body
    return (ast.unparse(ast.fix_missing_locations(tree))+'\n').encode()


def parameters(command,name,timeout):
    need(len(command.encode())<=18000,'STAGE_COMMAND_TOO_LARGE_REQUIRES_REVIEWED_CHUNKS')
    return {'RegionId':'cn-shanghai','InstanceId.1':'i-uf6ga92ewloganobbln6','Type':'RunShellScript',
        'ContentEncoding':'PlainText','WorkingDir':'/','Username':'root','RepeatMode':'Once',
        'KeepCommand':'false','EnableParameter':'false','Name':name,'Timeout':str(timeout),'CommandContent':command}


def generate_phase_actions(approved_release,phase,binder_output,raw_prior_evidence,*,now=None):
    need(phase in ('hold','stop','backup','switch'),'FOUR_NORMAL_PHASES_ONLY')
    a=approved_release;need(a['kind']=='cn-fixed-release-approval-v1' and a['target']==TARGET,'APPROVED_RELEASE_SCOPE')
    identity=a['identity'];now=now or dt.datetime.now(dt.timezone.utc)
    need(stamp(identity['requestedAt'])<=now<stamp(a['expiresAt'])<=stamp(identity['deadlineAt'])
         and stamp(a['issuedAt'])<=now and dt.timedelta(0)<stamp(identity['deadlineAt'])-stamp(identity['requestedAt'])<=dt.timedelta(minutes=30),'RELEASE_BUDGET')
    root=a['runtimeStage']['remoteRoot']
    need(re.fullmatch('/var/lib/workspacex-cn/runtime/upgrade-f0eb-[a-z0-9-]{1,64}',root),'RUNTIME_SCOPE')
    template=TEMPLATE.read_bytes();need(sha(template)==a['runtimeStage']['templateSha256'],'TEMPLATE_PIN')
    provenance=parse(binder_output['provenance.json'])
    need(provenance['kind']=='cn-continuation-bound-phase-v1' and provenance['phase']==phase,'BINDER_PROVENANCE')
    for key in ('sourceRevision','controlRevision','attemptId','requestedAt','deadlineAt'):
        need(provenance[key]==identity[key],'PROVENANCE_IDENTITY')
    for name,expected in provenance['files'].items():need(name in binder_output and sha(binder_output[name])==expected,'BINDER_FILE_CHANGED')
    need(set(RUNTIME_FILES.values())<=set(provenance['files']),'RUNTIME_FILE_CLOSURE')
    braw=binder_output['binding.json'];b=parse(braw)
    for key in IDENTITY:need(b[key]==identity[key],'BINDING_IDENTITY')
    need(b['draft']is False and {k:b[k]for k in TARGET}==TARGET,'BINDING_TARGET')
    need(stamp(b['issuedAt'])<=now<stamp(b['expiresAt'])<=stamp(identity['deadlineAt']),'BINDING_EXPIRED')
    files={dest:binder_output[src]for dest,src in RUNTIME_FILES.items()}
    for name,pin in [('upgrade-draft.py','scriptSha256'),('backup-host.py','backupHelperSha256'),('sessions-after-stop.py','sessionsHelperSha256')]:
        need(sha(files[name])==b[pin],'RUNTIME_CODE_PIN')
    need(parse(files['sessions-check-pins.json'])=={'scriptSha256':sha(files['sessions-after-stop.sh']),'bindingSha256':sha(braw)},'SESSION_PINS')
    need(parse(files['switch-images.json'])=={'services':{s:{'image':v}for s,v in b['candidateImages'].items()}},'CANDIDATE_OVERRIDE')
    need(parse(files['rollback-images.json'])=={'services':{s:{'image':v}for s,v in b['rollbackImages'].items()}},'ROLLBACK_OVERRIDE')
    required=set()
    if phase!='hold':required.add('previous-binding.json')
    if phase in ('backup','switch'):required.add('stop-receipt.json')
    if phase=='switch':required|={'backup-result.json','rds-backup-receipt.json'}
    need(set(raw_prior_evidence)==required,'PRIOR_EVIDENCE_CLOSURE')
    previous=None
    if phase!='hold':
        previous=sha(raw_prior_evidence['previous-binding.json']);old=parse(raw_prior_evidence['previous-binding.json'])
        fixed=IDENTITY+('candidateImages','rollbackImages','expectedContainers','composeFiles','envFiles','workingDir',
            'migrationDiffEvidenceSha256','scriptSha256','backupHelperSha256','sessionsHelperSha256','holdHelperSha256')
        need(all(old[k]==b[k]for k in fixed),'IMMUTABLE_ATTEMPT_CHANGED')
        if old['hold']is not None:need(old['hold']==b['hold'],'HOLD_CHANGED')
    for name,pin in RECEIPT_PINS.items():
        if name in raw_prior_evidence:
            raw=raw_prior_evidence[name];need(sha(raw)==b[pin],'PRIOR_RECEIPT_HASH');files[name]=raw
    config={'root':root,'phase':phase,'expectedOldBindingSha256':previous,
        'files':{k:{'sha256':sha(v),'base64':base64.b64encode(v).decode()}for k,v in files.items()}}
    # Compress plain source/file text together, before base64 framing. Nesting
    # base64 files in a second compressed/base64 shell needlessly exceeds the
    # existing 18 KiB transport cap. All exact file bytes are UTF-8 source/JSON.
    source=specialize(template,identity['sourceRevision'],identity['baselineRevision'],None)
    payload={'stage':source.decode(),'stageSha256':sha(source),
             'config':{k:v for k,v in config.items()if k!='files'},
             'files':{k:v.decode('utf-8')for k,v in files.items()},
             'filesSha256':{k:sha(v)for k,v in files.items()}}
    payload_raw=(json.dumps(payload,sort_keys=True,separators=(',',':'))+'\n').encode()
    packed=base64.b64encode(zlib.compress(payload_raw,9)).decode()
    command="/usr/bin/python3.12 -I -S -B - <<'CN_RUNTIME_STAGE'\nimport base64,hashlib,json,zlib\nb=zlib.decompress(base64.b64decode("+repr(packed)+"))\nassert hashlib.sha256(b).hexdigest()=="+repr(sha(payload_raw))+"\np=json.loads(b);s=p['stage'].encode();assert hashlib.sha256(s).hexdigest()==p['stageSha256']\nc=p['config'];c['files']={}\nfor n,v in p['files'].items():\n r=v.encode();assert hashlib.sha256(r).hexdigest()==p['filesSha256'][n];c['files'][n]={'sha256':p['filesSha256'][n],'base64':base64.b64encode(r).decode()}\nexec(compile(s,'<reviewed-runtime-stage>','exec'),{'__name__':'__main__','__BOUND_CONFIG__':c})\nCN_RUNTIME_STAGE\n"
    remaining=int((min(stamp(b['expiresAt']),stamp(a['expiresAt']))-now).total_seconds());need(remaining>0,'BUDGET_EXHAUSTED')
    execute='/usr/bin/python3 -I -S -B '+root+'/upgrade-draft.py '+root+' '+sha(braw)+' '+phase+'\n'
    result={'stageParameters':parameters(command,'cn-stage-'+phase,min(120,remaining)),
        'actionParameters':parameters(execute,'cn-'+phase,min(650 if phase=='backup'else 300,remaining)),
        'bindingSha256':sha(braw),'expectedOldBindingSha256':previous,'stageSourceSha256':sha(source),
        'filesSha256':{k:sha(v)for k,v in files.items()},'cloudCalls':0,
        'observersProvided':False,'requiresAllStageObserverPreflightBeforeHold':True}
    if phase=='stop':
        result['sessionsParameters']=parameters('/usr/bin/python3 -I -S -B '+root+'/sessions-after-stop.py '+root+' '+sha(braw)+'\n','cn-sessions',min(120,remaining))
    return result
