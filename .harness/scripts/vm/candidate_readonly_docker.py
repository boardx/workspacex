"""Profile/FD/socket pinned exact read-only candidate commands; import is inert."""
import pathlib,stat,json,re
from writer_fence import require
HEALTH_PROBE=r'''const http=require('node:http');
const probe=(options)=>new Promise((resolve,reject)=>{const r=http.get(options,res=>{let n=0,raw='';if(res.statusCode!==200){res.resume();reject(Error('HEALTH_HTTP'));return;}res.on('data',b=>{n+=b.length;if(n>65536){r.destroy();reject(Error('HEALTH_BOUND'));return;}raw+=b;});res.on('end',()=>{try{resolve(JSON.parse(raw));}catch(e){reject(e);}});});r.setTimeout(5000,()=>r.destroy(Error('HEALTH_TIMEOUT')));r.on('error',reject);});
Promise.all([probe({host:'web',port:3000,path:'/.well-known/workspacex-deployment'}),probe({host:'127.0.0.1',port:3200,path:'/healthz'}),probe({host:'agent',port:8000,path:'/healthz'}),probe({socketPath:'/run/sandbox/skill-sandbox.sock',path:'/healthz'})]).then(([web,api,agent,sandbox])=>process.stdout.write(JSON.stringify({web,api,agent,sandbox}))).catch(()=>process.exitCode=1);'''
def socket_authority(emitter):
    expected=emitter['dockerSocket']
    require(type(expected) is dict and set(expected)=={'device','inode','uid','gid','mode'},'CANDIDATE_CANONICAL_SOCKET_SCHEMA')
    path=pathlib.Path('/run/docker.sock')
    for parent in path.parents:
        value=parent.lstat();require(stat.S_ISDIR(value.st_mode) and value.st_uid==0 and not value.st_mode&0o022,'CANDIDATE_CANONICAL_SOCKET_PARENT')
    value=path.lstat();actual=dict(device=value.st_dev,inode=value.st_ino,uid=value.st_uid,gid=value.st_gid,mode=stat.S_IMODE(value.st_mode))
    require(stat.S_ISSOCK(value.st_mode) and actual==expected and value.st_uid==value.st_gid==0 and not value.st_mode&0o007,'CANDIDATE_CANONICAL_SOCKET_AUTHORITY')
    offline=pathlib.Path('/etc/workspacex-cn/docker-offline');value=offline.lstat()
    require(stat.S_ISDIR(value.st_mode) and value.st_uid==value.st_gid==0 and stat.S_IMODE(value.st_mode)==0o700 and list(offline.iterdir())==[],'CANDIDATE_CANONICAL_OFFLINE_CONFIG')
    return actual

def invoke_readonly_docker(source,profile_raw,operation,api_id=None,network_name=None):
    require(type(profile_raw) is bytes and source.private('/etc/workspacex-cn/trusted-tool-binding.json')==profile_raw,'CANDIDATE_READONLY_DOCKER_PROFILE')
    profile=json.loads(profile_raw);emitter=profile['candidateComposeEmitter']
    require(emitter.get('dockerPath')=='/usr/bin/docker' and re.fullmatch('[a-f0-9]{64}',emitter['dockerSha256']),'CANDIDATE_READONLY_DOCKER_BINARY')
    if operation=='network-inspect':
        require(type(network_name) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,127}',network_name),'CANDIDATE_READONLY_DOCKER_NETWORK')
        tail=['network','inspect',network_name]
    else:
        require(type(api_id) is str and re.fullmatch('[a-f0-9]{64}',api_id),'CANDIDATE_READONLY_DOCKER_CONTAINER')
        if operation=='service-health':tail=['exec',api_id,'node','-e',HEALTH_PROBE]
        else:
            scripts={'data-readiness':'scripts/data-readiness.ts','service-readiness':'scripts/cloud-service-readiness.ts'}
            require(operation in scripts,'CANDIDATE_READONLY_DOCKER_OPERATION')
            tail=['exec','--env','PROVISION_TIMEOUT_MS=10000',api_id,'node','--import','tsx',scripts[operation]]
    before=socket_authority(emitter)
    raw=source.invoke({'binaries':{'docker':{'path':'/usr/bin/docker','sha256':emitter['dockerSha256']}}},'docker',['--config','/etc/workspacex-cn/docker-offline','--host','unix:///run/docker.sock',*tail])
    require(socket_authority(emitter)==before and source.private('/etc/workspacex-cn/trusted-tool-binding.json')==profile_raw,'CANDIDATE_READONLY_DOCKER_AUTHORITY_CHANGED')
    return raw
