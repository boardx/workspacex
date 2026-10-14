#!/usr/bin/env python3
"""Invoke protected evidence workflow; verify its bounded actual artifact bytes."""
import hashlib,importlib.util,json,stat,tempfile,zipfile
from pathlib import Path
def module(name,file):
    s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
D=module('bridge_dispatch','cn-release-mvp-dispatch.py');U=module('bridge_artifact','cn-hk-original-artifact-upload.py');B=module('bridge_terminal','cn-release-mvp-chain.py')
AUTH=module('bridge_metadata','cn-release-mvp-contract.py')
def raw_result(run,stage,reader=U.gh):
    listing=reader(f'/repos/boardx/workspacex/actions/runs/{run}/artifacts?per_page=100')
    rows=listing['artifacts'];D.need(listing['total_count']==len(rows),'ARTIFACT_LIST_INCOMPLETE')
    hits=[r for r in rows if r['name']==f'cn-mvp-{stage}-{run}-1' and not r.get('expired')]
    D.need(len(hits)==1,'BRIDGE_ARTIFACT_MISSING');row=hits[0]
    D.need(0<row['size_in_bytes']<=131072 and row['workflow_run']['id']==run,'BRIDGE_ARTIFACT_IDENTITY')
    expected=row.get('digest','');D.need(expected.startswith('sha256:') and len(expected)==71,'BRIDGE_ARTIFACT_DIGEST')
    with tempfile.TemporaryDirectory(prefix='cn-mvp-bridge-') as folder:
        path=Path(folder)/'result.zip';reader(f'/repos/boardx/workspacex/actions/artifacts/{row["id"]}/zip',path,row['size_in_bytes'])
        D.need(hashlib.sha256(path.read_bytes()).hexdigest()==expected[7:],'BRIDGE_ZIP_CHANGED')
        with zipfile.ZipFile(path) as z:
            entries=z.infolist();D.need(len(entries)==1 and entries[0].filename=='result.json','BRIDGE_ZIP_MEMBERS')
            e=entries[0];D.need(not e.is_dir() and not e.flag_bits&1 and stat.S_IFMT(e.external_attr>>16)in(0,stat.S_IFREG) and 0<e.file_size<=65536,'BRIDGE_ZIP_UNSAFE')
            return json.loads(z.read(e))
def obtain(stage,payload,base,root,dispatch=D.coordinate,reader=U.gh):
    D.need(stage in ('approval','terminal'),'BRIDGE_STAGE')
    pin=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    request={**base,'stage':stage,'inputs':{'operation':stage,'selector_sha256':pin}}
    run=dispatch(request,Path(root)/(stage+'-intent.json'))
    result=raw_result(run['runId'],stage,reader)
    D.need(result['selectorSha256']==pin and result['identity']==B.identity(payload['identity']),'BRIDGE_RESULT_BINDING')
    if stage=='approval':
        D.need(result['kind']=='cn-mvp-installed-approval-v1' and result['buildRunId']==payload['buildRunId'] and result['transferRunId']==payload['transferRunId'],'APPROVAL_RUNS')
        raw=result['rawJson'].encode();D.need(hashlib.sha256(raw).hexdigest()==result['releaseSha256'],'APPROVAL_RAW_HASH')
        a=json.loads(raw);D.need(a['identity']['sourceRevision']==payload['identity']['sourceRevision'] and a['identity']['controlRevision']==payload['identity']['controlRevision'],'APPROVAL_SOURCE')
        D.need(a.get('kind')=='cn-fixed-release-approval-v1' and a.get('target')=={'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'},'APPROVAL_TARGET')
        metadata=AUTH.validate_metadata(a.get('mvp'))
        D.need({k:metadata[k]for k in AUTH.BASE_FIELDS}=={'acceptanceScope':'mvp-non-model','contentManifestSha256':payload['identity']['contentManifestSha256'],'buildRunId':payload['buildRunId'],'transferRunId':payload['transferRunId']},'APPROVAL_CONTENT_AND_RUNS')
        D.need(all(a['acquire']['requests'][phase]['runId']==payload['buildRunId'] and a['acquire']['requests'][phase]['runAttempt']==1 for phase in ('consume','publication')),'MVP_ACQUIRE_BUILD_BINDING')
        D.need(a['identity']['requestedAt']==payload['requestedAt'] and a['identity']['deadlineAt']==payload['deadlineAt'],'APPROVAL_WINDOW')
    else:
        D.need(result['kind']=='cn-mvp-verified-terminal-v1' and result['productionRunId']==payload['productionRunId'] and result['originalEvidenceBytesVerified']is True,'TERMINAL_PRODUCTION_RUN')
        D.need(B.terminal(payload['identity'],result['receipts'])==result['terminal'],'TERMINAL_RECHECK')
    return result
