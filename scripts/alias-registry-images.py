#!/usr/bin/env python3
"""Publish a verified short alias for a complete historical immutable image set."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess

spec=importlib.util.spec_from_file_location('registry',Path(__file__).with_name('registry-images.py'))
registry=importlib.util.module_from_spec(spec);spec.loader.exec_module(registry)

def alias(prefix,legacy,output):
    registry.coordinates(prefix,legacy)
    registry.need(registry.LEGACY_TAG.fullmatch(legacy),'LEGACY_TAG_REQUIRED')
    short=legacy[41:]
    images={role:registry.resolve('docker',prefix,legacy,role) for role in registry.SERVICES}
    missing=[]
    # Preflight every destination before publishing any alias. Existing aliases
    # are accepted only if identical, making interrupted operation resumable.
    for role,row in images.items():
        reference=prefix+'/'+registry.SERVICES[role][0]+':'+short
        probe=subprocess.run(['docker','manifest','inspect',reference],capture_output=True,text=True,timeout=60)
        if probe.returncode==0:
            existing=registry.resolve('docker',prefix,short,role)
            registry.need(existing['image']==row['image'] and existing['imageId']==row['imageId'],'ALIAS_ALREADY_EXISTS_DIFFERENT_IMAGE')
        else:
            registry.need(re.search(r'manifest unknown|no such manifest|MANIFEST_UNKNOWN',probe.stderr,re.I),'ALIAS_EXISTENCE_UNVERIFIED')
            missing.append(role)
    for role in missing:
        reference=prefix+'/'+registry.SERVICES[role][0]+':'+short
        registry.run(['docker','buildx','imagetools','create','--prefer-index=false','--tag',reference,images[role]['image']])
    verified={role:registry.resolve('docker',prefix,short,role) for role in registry.SERVICES}
    for role,row in verified.items():
        registry.need(row['image']==images[role]['image'] and row['imageId']==images[role]['imageId'],'ALIAS_POST_PUBLISH_MISMATCH')
    registry.write(output,{'legacyTag':legacy,'tag':short,'sourceRevision':legacy[:40],'images':verified})
    print(json.dumps({'tag':short,'sourceRevision':legacy[:40],'services':list(verified)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--prefix',required=True);parser.add_argument('--legacy-tag',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();alias(args.prefix,args.legacy_tag,args.output)
