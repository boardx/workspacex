"""Retain originals from fixed admitted roots and authenticated provider reads."""
import importlib.util
from pathlib import Path


def module(name,path=None):
    spec=importlib.util.spec_from_file_location(name,path or Path(__file__).with_name(name+'.py'))
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


P=module('cn-release-mvp-original-producer');E=P.E;S=P.S;C=P.C


def retain(release,*,reader=E.private,advance=None,github=None,installed_reader=None):
    E.need(type(release)is str and __import__('re').fullmatch('[a-f0-9]{64}',release),'RELEASE_HASH')
    raw=reader(Path('/etc/workspacex-cn/release-approvals')/(release+'.json'))
    E.need(E.sha(raw)==release,'APPROVAL_HASH');a=S.parse(raw)
    advance=advance or module('retention_advance',Path(__file__).parents[1]/'.harness/scripts/vm/cn-release-advance.py')
    attempt=a['identity']['attemptId'];E.need(advance.ATTEMPT.fullmatch(attempt),'RETENTION_ATTEMPT')
    generated=P.INPUT/release
    context=S.parse(reader(generated/'mvp-production-run.json'));payload=context['binding']
    E.selector('terminal',payload);E.need(context['releaseSha256']==release,'RETENTION_CONTEXT')
    policy_raw=reader(Path('/var/lib/workspacex-cn/release-inputs')/release/'policy.json')
    E.need(E.sha(policy_raw)==a['acquire']['requests']['consume']['inputs']['policy'],'RETENTION_POLICY')
    github=github or C.protected_github(S.parse(policy_raw))
    C.production_context(a,release,payload,github,completed=False)
    objects={};bundles={}
    def bundle(stage,roles):
        refs={}
        for role,raw in roles.items():
            S.parse(raw);pin=E.sha(raw);objects[pin]=raw;refs[role]=pin
        bundles[stage]=E.encode(dict(kind='cn-mvp-stage-evidence-v1',stage=stage,binding=payload,originals=refs))
    run=github(f'/repos/boardx/workspacex/actions/runs/{payload["buildRunId"]}')
    artifacts=github(f'/repos/boardx/workspacex/actions/runs/{payload["buildRunId"]}/artifacts?per_page=100')
    bound=E.module().bind(payload['identity'],run,artifacts)
    transfer=module('cn-release-mvp-transfer-input')
    candidate=transfer.metadata_zip(bound['artifacts']['plan'],{'cn-candidate-plan.json'},github)['cn-candidate-plan.json']
    bundle('build',dict(run=E.encode(run),artifacts=E.encode(artifacts),candidatePlan=candidate))
    metadata=C.transfer_metadata(payload,github)
    bundle('transfer',dict(run=E.encode(github(f'/repos/boardx/workspacex/actions/runs/{payload["transferRunId"]}')),
        plan=metadata['upload-plan.json'],template=metadata['hk-template.json'],proof=metadata['proof.json'],policy=metadata['policy.json']))
    def durable(stage):
        path=advance.STATE/attempt/('%02d-%s.receipt.json'%(advance.STAGES.index(stage),stage))
        receipt_raw=advance.read(path);receipt=S.parse(receipt_raw)
        manifest,_=advance.load_package(receipt['requestSha256'],attempt)
        advance.verify_historical_receipt(path,receipt,manifest)
        prefix=str(path).removesuffix('.receipt.json')
        roles={'durableReceipt':receipt_raw,'durableManifest':advance.read(advance.REQUESTS/receipt['requestSha256']/'manifest.json')}
        # Use exact raw admitted manifest; never reconstruct newline-sensitive hashes.
        E.need(E.sha(roles['durableManifest'])==receipt['requestSha256'],'RETENTION_MANIFEST_HASH')
        for role,suffix in [('durableEvidence','evidence'),('durableObservation','terminal-observation'),('durableAdmission','admission'),('durableIntent','intent'),('durableProcess','process')]:
            roles[role]=advance.read(Path(prefix+'.'+suffix+'.json'))
        return roles
    backup=durable('rds-backup');backup['rdsReceipt']=backup['durableEvidence'];r=S.parse(backup['rdsReceipt'])
    root=generated/'rds-backup'
    paths={'intent':root/'intent.json','dispatch':root/'dispatch.json','stopReceiptSha256':root/'inputs/stop.json','holdReceiptSha256':root/'inputs/hold.json'}
    for role,pins in r['originalEvidenceSha256'].items():
        for i,pin in enumerate(pins if type(pins)is list else [pins]):
            path=(root/('page-'+pin+'.json'))if role=='pages'else root/('task-'+pin+'.json')if role=='task'else paths[role]
            value=reader(path);E.need(E.sha(value)==pin,'RETENTION_RDS_ORIGINAL')
            backup['rds-'+role+('-'+str(i)if type(pins)is list else '')]=value
    bundle('backup',backup);bundle('deploy',durable('switch'))
    hooks=generated/'mvp-stages'
    bundle('schema',dict(readback=reader(hooks/'schema.json')))
    request=reader(hooks/'content/request.json');roles=dict(request=request,readback=reader(hooks/'content/readback.json'))
    installed_reader=installed_reader or module('cn-release-mvp-driver-stages').installed
    source=Path('/usr/local/lib/workspacex-cn/release-source')/a['identity']['sourceRevision']
    for i,ref in enumerate(S.parse(request)['packRefs']):
        path=Path(ref['path']);E.need(not path.is_absolute() and all(p not in ('','.','..')for p in path.parts),'RETENTION_PACK_PATH')
        value=installed_reader(source/path);E.need(E.sha(value)==ref['rawSha256'],'RETENTION_PACK_PIN');roles['skill-pack-'+str(i)]=value
    bundle('content',roles)
    acceptance=durable('observe');acceptance['readback']=acceptance['durableEvidence'];bundle('acceptance',acceptance)
    for stage,value in bundles.items():S.validate_stage(payload,stage,value,objects)
    report=C.verify(payload,bundles,objects,reader=reader,advance=advance,github=github,completed=False)
    E.need(report['releaseSha256']==release,'RETENTION_RELEASE')
    files={}
    for value in list(objects.values())+list(bundles.values()):
        E.need(len(value)<=65536,'RETENTION_OBJECT_LIMIT');files['objects/'+E.sha(value)+'.json']=value
    manifest=dict(kind='cn-mvp-admitted-original-manifest-v1',releaseSha256=release,binding=payload,
        bundles={k:E.sha(v)for k,v in bundles.items()},objects=sorted(objects))
    files['manifest.json']=E.encode(manifest)
    folder=generated/'mvp-originals'
    if folder.exists():
        E.need(all(reader(folder/name)==value for name,value in files.items()),'RETENTION_REBIND');return manifest
    P.M.write_proposal(folder,files,dict(kind='cn-mvp-original-retention-v1',installed=False,authorityGranted=False))
    return manifest
