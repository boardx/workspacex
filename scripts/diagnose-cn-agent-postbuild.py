#!/usr/bin/env python3
"""Single-agent build/save/normalize diagnostic; temporary local images only."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('agent_build_diagnostic', ROOT/'scripts/diagnose-cn-image-candidate.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
a, b, c = d.a, d.b, d.c
d.PHASES |= {'POSTBUILD_CONTROL', 'DOCKER_SAVE', 'ARCHIVE_NORMALIZE', 'ARCHIVE_INSPECT'}


def execute(raw, source, output, env, command=d.run, save_command=d.run):
    d.HINTS = {}; d.LINE_LIMIT = 0
    d.phase('EVENT_REF'); d.event_guard(env)
    d.phase('PLAN'); a.require(len(raw)<=16384, 'DIAGNOSTIC_PLAN_SIZE')
    p = c.validate_diagnostic_plan(a.decode(raw))
    a.require(p['controlRevision']==env.get('GITHUB_SHA'), 'DIAGNOSTIC_CONTROL_BINDING')
    d.phase('POSTBUILD_CONTROL')
    for name in ('scripts/diagnose-cn-agent-postbuild.py', '.github/workflows/diagnose-cn-agent-postbuild.yml'):
        a.require((ROOT/name).read_bytes()==command(['git','show',p['controlRevision']+':'+name],ROOT), 'DIAGNOSTIC_SCRIPT_BYTES')
    completed = {}

    def invoke(argv, cwd=None):
        result = command(argv, cwd)
        if argv[:3] != ['docker','buildx','build']:
            return result
        # Same trusted build as the existing diagnostic, then a single bounded save.
        d.phase('EVENT_REF'); d.event_guard(env)
        a.require(p['controlRevision']==env.get('GITHUB_SHA'), 'DIAGNOSTIC_CONTROL_BINDING')
        with tempfile.TemporaryDirectory(prefix='wsx-agent-postbuild-',dir=Path(output).parent) as td:
            root = Path(td); saved = root/'save.tar'; target = root/'agent.tar'
            d.phase('DOCKER_SAVE')
            with saved.open('xb') as stream:
                save_command(['docker','image','save',c.tag(p,'agent')],stdout_file=stream,stdout_limit=p['maxArchiveBytes'])
            save_size = saved.stat().st_size
            a.require(0<save_size<=p['maxArchiveBytes'], 'CANDIDATE_SAVE_LIMIT')
            d.phase('ARCHIVE_NORMALIZE')
            meta = b.normalize(saved,target,p,'agent')
            d.phase('ARCHIVE_INSPECT')
            a.require(c.inspect(target,p,'agent')==meta, 'CANDIDATE_CONFIG_BINDING')
            completed.update(rawSaveBytes=save_size,normalizedArchiveBytes=target.stat().st_size,
                             configSha256=meta['configSha256'],layerCount=len(meta['layers']))
        return result

    result = d.execute(raw, source, output, env, invoke)
    a.require(bool(completed), 'DIAGNOSTIC_OUTPUT')
    return dict(result, status='POSTBUILD_COMPLETED', **completed)


def validate_metadata(raw):
    a.require(type(raw) is bytes and len(raw)<=16384, 'DIAGNOSTIC_OUTPUT')
    v = a.decode(raw)
    a.require(type(v) is dict, 'DIAGNOSTIC_OUTPUT')
    if v.get('status') != 'POSTBUILD_COMPLETED':
        return d.validate_metadata(raw)
    base = {k:val for k,val in v.items() if k not in {'rawSaveBytes','normalizedArchiveBytes','configSha256','layerCount'}}
    base['status'] = 'BUILD_COMPLETED'; d.validate_metadata(a.json_bytes(base))
    a.require(set(v)==set(base)|{'rawSaveBytes','normalizedArchiveBytes','configSha256','layerCount'}, 'DIAGNOSTIC_OUTPUT')
    for name in ('rawSaveBytes','normalizedArchiveBytes'):
        a.require(type(v[name]) is int and 0<v[name]<=2*1024**3, 'DIAGNOSTIC_OUTPUT')
    a.require(a.hex_string(v['configSha256'],64) and type(v['layerCount']) is int and 1<=v['layerCount']<=128,'DIAGNOSTIC_OUTPUT')
    return v


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--source',required=True); parser.add_argument('--output',required=True)
    args=parser.parse_args(); output=Path(args.output); rc=0
    try: result=execute(os.environ.get('BUILD_PLAN','').encode(),args.source,output,dict(os.environ))
    except Exception as error:
        result=d.failure(error)
        rc=error.returncode if isinstance(error,d.CommandFailure) and type(error.returncode) is int and 1<=error.returncode<=255 else 1
    data=a.json_bytes(result)+b'\n'; validate_metadata(data)
    a.require(output.parent.is_dir() and not output.exists() and not output.is_symlink(),'DIAGNOSTIC_OUTPUT')
    with output.open('xb') as stream: stream.write(data)
    print(data.decode(),end=''); return rc


if __name__=='__main__':
    try: sys.exit(main())
    except Exception:
        print(json.dumps({'status':'DIAGNOSTIC_FAILED','phase':'INPUT','checkCode':'DIAGNOSTIC_METADATA_WRITE_FAILED','productionReady':False,'releaseReady':False}),file=sys.stderr)
        sys.exit(1)
