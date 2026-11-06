#!/bin/sh
# New reviewed probe; old probe approval does not authorize its execution.
# No Docker plan, locks, writes, containers, env/config contents or SQL queries.
set -eu
export PATH=/usr/bin:/bin
export LC_ALL=C
printf 'probe=fixed-cn-readonly-v1\n'
date -u '+observedAt=%Y-%m-%dT%H:%M:%SZ'
uname -sm
for tool in /usr/bin/node /usr/bin/docker /usr/bin/aliyun; do
  if [ -f "$tool" ]; then
    stat -c '%u:%g %a %s %n' "$tool"
    sha256sum "$tool"
  fi
done
df -Pk /var/lib/docker /var/lib/workspacex-cn
free -m
/usr/bin/timeout --signal=TERM --kill-after=2s 60s /usr/bin/python3 -I -S -B - <<'PY'
import hashlib,json,pathlib,subprocess,urllib.request

def docker(*args):
    p=subprocess.run(['/usr/bin/docker',*args],capture_output=True,timeout=15,
                     env={'PATH':'/usr/bin:/bin','LANG':'C'})
    if p.returncode or len(p.stdout)>262144:
        raise RuntimeError('DOCKER_READ_FAILED')
    return p.stdout.decode().strip()
ids=docker('ps','--quiet','--no-trunc').split()
if len(ids)>100:raise RuntimeError('CONTAINER_LIMIT')
compose=set()
for ident in ids:
    fields=docker('inspect','--format','{{json .Id}}|{{json .Image}}|{{json .State.Running}}|{{json (index .Config.Labels "com.docker.compose.project")}}|{{json (index .Config.Labels "com.docker.compose.service")}}|{{json (index .Config.Labels "com.docker.compose.project.config_files")}}',ident).split('|')
    row=[json.loads(v) for v in fields]
    print(json.dumps(dict(containerId=row[0],imageId=row[1],running=row[2],project=row[3],service=row[4])))
    if row[5]:compose.update(row[5].split(','))
for name in sorted(compose|{'/usr/local/lib/workspacex-cn/execute-cn-candidate-download.py','/usr/local/lib/workspacex-cn/import-cn-image-candidates.py'}):
    p=pathlib.Path(name)
    allowed=any(p.is_relative_to(root) for root in ('/opt/workspacex','/etc/workspacex-cn','/var/lib/workspacex-cn','/usr/local/lib/workspacex-cn'))
    if allowed and not p.is_symlink() and p.is_file() and p.stat().st_size<=4*1024*1024:
        print(json.dumps(dict(path=name,sha256=hashlib.sha256(p.read_bytes()).hexdigest())))
    else:print(json.dumps(dict(path=name,status='MISSING_OR_OUTSIDE_REVIEWED_ROOTS')))
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise RuntimeError('HEALTH_REDIRECT')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
# Fixed loopback API health only. No public probes or business operations.
with opener.open('http://127.0.0.1:3200/healthz',timeout=5) as response:
    raw=response.read(65537)
    if response.status!=200 or len(raw)>65536:raise RuntimeError('HEALTH_REJECTED')
    print(json.dumps(dict(healthUrl='http://127.0.0.1:3200/healthz',httpStatus=response.status,bodySha256=hashlib.sha256(raw).hexdigest(),businessAcceptance=False)))
PY
