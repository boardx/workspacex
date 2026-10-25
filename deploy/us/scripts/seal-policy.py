#!/usr/bin/env python3
"""Run only after baseline acceptance. Refuses to reseal changed installations."""
import hashlib,json,os
from pathlib import Path
assert os.geteuid()==0,'root required'
r=Path('/etc/workspacex-us'); s=json.loads((r/'settings.json').read_text())
def ref(p):
 p=Path(p);return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
policy={'environment':'us','registryPrefix':s['registryPrefix'],'docker':'/usr/bin/docker','dockerConfig':'/etc/workspacex-image-release/docker','stateDirectory':'/var/lib/workspacex-image-release/us','lockFile':'/run/workspacex-us-deploy.lock','project':'workspacex-us','composeFiles':[ref(r/'compose.json')],'envFile':ref(r/'compose.env'),'services':{'api':'api','web':'web','agent':'agent','sandbox':'sandbox','sandbox-sessions':'sandbox'},'health':{'url':'https://'+s['domain']+'/api/healthz','expected':{'trustworthy':True}},'verificationCommand':['/usr/local/bin/workspacex-us-business-probe'],'verificationFiles':[ref('/usr/local/bin/workspacex-us-business-probe'),ref('/etc/apparmor.d/workspacex-native-sessions'),ref('/etc/systemd/system/docker.service.d/workspacex-us-apparmor.conf'),*[ref(r/n) for n in ['probe.env','api.env','agent.env','web.env','docker-seccomp.json','docker-apparmor-sessions']]],'readinessTimeoutSeconds':120}
p=Path('/etc/workspacex-image-release/us.json')
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(policy,f,indent=2);f.write('\n')
print('Baseline pinned at '+str(p))
