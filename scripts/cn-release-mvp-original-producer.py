#!/usr/bin/env python3
"""Collect immutable admitted originals into an exclusive terminal proposal.

This does not mint or install approval. The fixed root source manifest must be
retained by the admitted driver; public run identifiers are not authority.
"""
import argparse
import importlib.util
import os
import re
from pathlib import Path


def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


S=module('cn-release-mvp-stage-evidence');E=S.E
M=module('cn-release-mvp-evidence-materializer')
C=module('cn-release-mvp-trusted-collector')
INPUT=Path('/var/lib/workspacex-cn/release-generated')


def collect(release, *, reader=E.private):
    """Read only a release-addressed root manifest and content-addressed files."""
    E.need(type(release)is str and re.fullmatch('[a-f0-9]{64}',release),'RELEASE_HASH')
    approval=reader(Path('/etc/workspacex-cn/release-approvals')/(release+'.json'))
    E.need(E.sha(approval)==release,'APPROVAL_HASH')
    root=INPUT/release/'mvp-originals'
    manifest=S.parse(reader(root/'manifest.json'))
    E.need(set(manifest)=={'kind','releaseSha256','binding','bundles','objects'}
        and manifest['kind']=='cn-mvp-admitted-original-manifest-v1'
        and manifest['releaseSha256']==release,'ORIGINAL_MANIFEST')
    payload=manifest['binding'];E.selector('terminal',payload)
    a=S.parse(approval)
    E.need(all(a['identity'][k]==payload['identity'][k]for k in ('sourceRevision','controlRevision'))
        and all(a['identity'][k]==payload[k]for k in ('requestedAt','deadlineAt')),'APPROVAL_BINDING')
    E.need(all(a['mvp'][k]==payload[k]for k in ('buildRunId','transferRunId'))
        and a['mvp']['contentManifestSha256']==payload['identity']['contentManifestSha256'],'APPROVAL_MVP_BINDING')
    E.need(set(manifest['bundles'])==set(E.module().STAGES),'BUNDLE_STAGES')
    pins=manifest['objects'];E.need(type(pins)is list and len(pins)<=512 and len(set(pins))==len(pins),'OBJECT_COUNT')
    def read(pin):
        E.need(type(pin)is str and re.fullmatch('[a-f0-9]{64}',pin),'ORIGINAL_PIN')
        raw=reader(root/'objects'/(pin+'.json'));E.need(E.sha(raw)==pin,'ORIGINAL_BYTES_CHANGED');return raw
    bundles={stage:read(pin)for stage,pin in manifest['bundles'].items()}
    objects={pin:read(pin)for pin in pins}
    for stage,raw in bundles.items():S.validate_stage(payload,stage,raw,objects)
    return payload,bundles,objects


def prepare(release, *, reader=E.private):
    payload,bundles,objects=collect(release,reader=reader)
    # No supplied callback may assert provenance. The actual collector re-fetches
    # provider metadata and checks historical root admission before receipts.
    provenance=C.verify(payload,bundles,objects,reader=reader)
    E.need(provenance.get('authenticatedProviderReadbackVerified')is True
        and provenance.get('historicalRootAdmissionVerified')is True,'TRUSTED_PROVENANCE_REQUIRED')
    E.need(provenance.get('releaseSha256')==release,'TRUSTED_APPROVAL_REBIND')
    b=E.module();receipts=[];previous=None
    for stage in b.STAGES:
        row=dict(stage=stage,identity=payload['identity'],status='SUCCEEDED',
            previousReceiptSha256=previous,evidenceSha256=E.sha(bundles[stage]))
        if stage=='acceptance':row.update(checks={key:'PASSED'for key in b.CHECKS},
            modelQuality='SKIPPED',futureV2Content='NOT_APPLICABLE')
        receipts.append(row);previous=E.sha(E.encode(row))
    originals=dict(binding=E.encode(payload),receipts=E.encode(receipts))
    originals.update({'evidence-'+stage:raw for stage,raw in bundles.items()})
    originals.update({'original-'+pin:raw for pin,raw in objects.items()})
    files,report=M.prepare('terminal',payload,originals)
    report.update(provenance=provenance,releaseSha256=release,
        liveProviderProvenanceVerified=True,productionAccepted=False,
        portalInstallationRequired=True)
    return files,report


def main():
    p=argparse.ArgumentParser();p.add_argument('release_sha256');args=p.parse_args()
    try:
        E.need(os.geteuid()==0,'ROOT_REQUIRED')
        files,report=prepare(args.release_sha256)
        # Only a durable proposal; this command does not write /etc or grant
        # approval. Existing portal installation remains a separate boundary.
        M.write_proposal(INPUT/args.release_sha256/'mvp-terminal-proposal',files,report)
        print(E.encode(report).decode());return 0
    except (ValueError,KeyError,TypeError,OSError):
        print('{"status":"NOT_READY","authorityGranted":false,"installed":false}');return 20


if __name__=='__main__':raise SystemExit(main())
