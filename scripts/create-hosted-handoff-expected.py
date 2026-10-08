#!/usr/bin/env python3
"""Freeze an independently reviewed local control closure; never consumes receipts."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

spec = importlib.util.spec_from_file_location('local_handoff_validator', Path(__file__).with_name('verify-hosted-handoff.py'))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

def create(reviewed_input, source_checkout, runtime_node_modules, closure_directory, node_path, output, control_output=None, artifact_only=False):
    identity, identity_bytes = v.load(reviewed_input)
    v.require(isinstance(identity, dict) and set(identity) in (set(v.IDENTITY), set(v.IDENTITY) | {'acrEdition'}), 'REVIEWED_IDENTITY_FIELDS_REQUIRED')
    edition = identity.get('acrEdition', 'enterprise')
    v.require(edition in ('personal', 'enterprise'), 'INVALID_ACR_EDITION')
    v.require(edition != 'personal' or artifact_only, 'ACR_PERSONAL_PRODUCTION_HANDOFF_UNSUPPORTED')
    identity = {key: identity[key] for key in v.IDENTITY}
    v.require(all(isinstance(identity[key], str) for key in v.IDENTITY), 'INVALID_REVIEWED_IDENTITY')
    v.require(re.fullmatch('[a-f0-9]{40}', identity['sourceRevision']), 'INVALID_REVIEWED_SHA')
    v.require(re.fullmatch(r'v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?', identity['release']), 'INVALID_REVIEWED_RELEASE')
    v.require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', identity['attemptId']), 'INVALID_REVIEWED_ATTEMPT')
    v.require(identity['platform'] in ('linux/amd64','linux/arm64') and identity['acrRegion'] == 'cn-hongkong', 'INVALID_REVIEWED_TARGET')
    v.require(re.fullmatch(r'[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9]+(?:[._-][a-z0-9]+)*',identity['registryPrefix']) and ((edition == 'enterprise' and re.fullmatch(r'cri-[a-zA-Z0-9]+',identity['acrInstanceId'])) or (edition == 'personal' and identity['acrInstanceId'] == '')), 'INVALID_REVIEWED_REGISTRY')
    source = Path(source_checkout).resolve(strict=True)
    modules = Path(runtime_node_modules).resolve(strict=True)
    node = Path(node_path).resolve(strict=True)
    v.require(node.is_file(), 'NODE_EXECUTABLE_REQUIRED')
    result = subprocess.run([str(node), '--version'], env={'PATH':str(node.parent)}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15, check=False)
    v.require(result.returncode == 0 and re.fullmatch(rb'v22\.\d+\.\d+\s*', result.stdout), 'NODE_22_REQUIRED')
    # Resolve/copy dependency tree only after independent control input validation.
    v.modules_tree_sha256(modules)
    closure = Path(closure_directory).absolute()
    v.require(not closure.exists() and not closure.is_symlink(), 'NEW_CONTROL_DIRECTORY_REQUIRED')
    closure.mkdir(mode=0o700, parents=False)
    files = closure/'packages/cloud-deploy/src'
    files.mkdir(parents=True)
    for name in (*v.SOURCE_FILES,'release-manifest-cli.ts','release-manifest.ts'):
        original=source/'packages/cloud-deploy/src'/name
        v.require(original.is_file() and not original.is_symlink(), 'CANONICAL_SOURCE_REQUIRED')
        (files/name).write_bytes(original.read_bytes())
    (closure/'package.json').write_text('{"type":"module"}\n',encoding='utf8')
    nested_package=source/'packages/cloud-deploy/package.json'
    v.require(nested_package.is_file() and not nested_package.is_symlink(), 'CANONICAL_PACKAGE_REQUIRED')
    (closure/'packages/cloud-deploy/package.json').write_bytes(nested_package.read_bytes())
    shutil.copytree(modules,closure/'node_modules',symlinks=True)
    copied_node=closure/'tools/node/bin/node'
    copied_node.parent.mkdir(parents=True)
    copied_node.write_bytes(node.read_bytes())
    copied_node.chmod(0o700)
    flat_files={}
    for path in sorted(closure.rglob('*')):
        if path.is_file():
            flat_files[path.relative_to(closure).as_posix()]=v.sha(path.read_bytes())
    flat={'schemaVersion':1,'nodeExecutable':'tools/node/bin/node','nodeSha256':v.sha(node.read_bytes()),'checkoutDirectory':'.','fileSha256':flat_files}
    v.require(control_output is not None and Path(control_output).absolute().parent == closure, 'CONTROL_OUTPUT_MUST_BE_IN_CLOSURE_ROOT')
    with Path(control_output).open('x',encoding='utf8') as handle:
        handle.write(json.dumps(flat,indent=2,sort_keys=True)+'\n')
    config_sha=v.sha(Path(control_output).read_bytes())
    expected=identity|{'expectedPythonToolHash':v.sha(Path(__file__).with_name('hosted-release.py').read_bytes()),'expectedCanonicalControlSha256':config_sha,'expectedCanonicalVerifierHash':v.sha(Path(__file__).with_name('canonical_control.py').read_bytes())}
    if edition == 'personal':
        expected.update(acrEdition='personal', productionHandoffSupported=False)
    with Path(output).open('x',encoding='utf8') as handle:
        handle.write(json.dumps(expected,indent=2,sort_keys=True)+'\n')
    print('CANONICAL_CONTROL_SHA256='+config_sha)
    # Separate provenance is informative; it grants no production authority.
    provenance = {'schemaVersion':1,'stage':'offline-local-control-closure-generation','reviewedInputSha256':v.sha(identity_bytes),'generatorSha256':v.sha(Path(__file__).read_bytes()),'validatorSha256':v.sha(Path(__file__).with_name('verify-hosted-handoff.py').read_bytes()),'expectedSha256':v.sha(Path(output).read_bytes()),'trustScope':'local independently supplied reviewed input; no external attestation','prepared':False,'productionActivated':False,'cloudVerified':False}
    with (closure/'control-provenance.json').open('x',encoding='utf8') as handle:
        handle.write(json.dumps(provenance,indent=2,sort_keys=True)+'\n')
    return expected

def main():
    parser=argparse.ArgumentParser()
    for name in ('reviewed-input','source-checkout','runtime-node-modules','closure-dir','node','output'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--control-output',required=True)
    parser.add_argument('--artifact-only', action='store_true')
    args=parser.parse_args()
    create(args.reviewed_input,args.source_checkout,args.runtime_node_modules,args.closure_dir,args.node,args.output,args.control_output,args.artifact_only)
    print('HOSTED_HANDOFF_EXPECTED_GENERATED_LOCAL_ONLY')

if __name__ == '__main__':
    try:
        main()
    except (ValueError,OSError,TypeError,KeyError,subprocess.SubprocessError,AttributeError):
        print('HOSTED_HANDOFF_EXPECTED_GENERATION_FAILED',file=sys.stderr)
        sys.exit(1)
