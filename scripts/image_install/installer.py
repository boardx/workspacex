#!/usr/bin/env python3
"""One entry for consumers of official images. No source build, GitHub or Runner required."""
import argparse,hashlib,importlib.util,json,os,platform,re,shutil,subprocess,sys,tarfile,tempfile
from pathlib import Path
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('renderer',P/'scripts/renderer.py');renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
render=renderer.render
PREFIX='workspacex-cn-prod-registry.cn-shanghai.cr.aliyuncs.com/workspacex-prod'
ROLES={'api':'api','web':'web','agent':'deep-agent','sandbox':'skill-sandbox','postgres':'postgres-age'}
RUNTIME=Path('/etc/workspacex-selfhost');STATE=Path('/var/lib/workspacex-selfhost-state')
def settings_from_values(v):
 required=['IMAGE_TAG','PUBLIC_DOMAIN','ADMIN_EMAIL','MODEL_BASE_URL','MODEL_ID','MODEL_API_KEY']
 for k in required:
  if not v.get(k) or 'REPLACE_' in v[k]:raise ValueError('Fill '+k+' in your private .env')
 c={'domain':v['PUBLIC_DOMAIN'],'registryPrefix':v.get('REGISTRY_PREFIX',PREFIX),'releaseTag':v['IMAGE_TAG'],'sourceRevision':'0'*40,'redisImage':v.get('REDIS_IMAGE','redis:7-alpine'),'adminEmail':v['ADMIN_EMAIL'],'adminName':v.get('ADMIN_NAME','Administrator'),'orgName':v.get('ORG_NAME','Workspace'),'modelBaseUrl':v['MODEL_BASE_URL'],'modelId':v['MODEL_ID'],'modelApiKey':v['MODEL_API_KEY']}
 # The Redis tag is resolved to a digest before rendering; validate other fields now.
 check=dict(c,redisImage='redis@sha256:'+'0'*64);renderer.validate(check)
 return c
def load_settings(path):
 values={}
 for line in Path(path).read_text().splitlines():
  line=line.strip()
  if not line or line.startswith('#'):continue
  if '=' not in line:raise ValueError('Use KEY=value lines in .env')
  k,v=line.split('=',1)
  if k in values:raise ValueError('Duplicate key: '+k)
  values[k]=v[1:-1] if len(v)>1 and v[0]==v[-1] and v[0] in "\"'" else v
 allowed={'IMAGE_TAG','PUBLIC_DOMAIN','ADMIN_EMAIL','MODEL_BASE_URL','MODEL_ID','MODEL_API_KEY','REGISTRY_PREFIX','REDIS_IMAGE','ADMIN_NAME','ORG_NAME'}
 if set(values)-allowed:raise ValueError('Unknown configuration key')
 return settings_from_values(values)
def resolve_source(c,inspect):
 rows=[inspect(c['registryPrefix']+'/'+repo+':'+c['releaseTag']) for repo in ROLES.values()]
 if any(r.get('Os')!='linux' or r.get('Architecture')!='amd64' for r in rows):raise ValueError('Images must be linux/amd64')
 sources={r.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision','') for r in rows}
 if len(sources)!=1 or not re.fullmatch('[a-f0-9]{40}',next(iter(sources))):raise ValueError('All five images must have the same source revision')
 return sources.pop()
def prepare_runtime(c,input_digest,path):
 path=Path(path)
 if path.exists():
  if not(path/'input-config.sha256').is_file() or (path/'input-config.sha256').read_text().strip()!=input_digest:raise ValueError('Private staging differs from input; inspect unused staging before retry')
  if json.loads((path/'settings.json').read_text())!=c:raise ValueError('Staged image identity/config differs; do not rotate stable secrets')
  return path
 render(c,path);renderer.private(path/'input-config.sha256',input_digest+'\n');return path
def step_names(acme=False):return ['10-install.sh','20-bootstrap.sh']+(['25-certificate.sh'] if acme else [])+['30-ingress.sh']+(['35-renewal.sh'] if acme else [])+['40-accept.sh']
def command(args,**kw):
 r=subprocess.run(args,check=True,**kw);return r
def inspect(image):
 r=subprocess.run(['docker','image','inspect',image],capture_output=True,text=True)
 if r.returncode:
  command(['docker','pull','--platform','linux/amd64',image]);r=subprocess.run(['docker','image','inspect',image],capture_output=True,text=True,check=True)
 return json.loads(r.stdout)[0]
def package(output):
 output.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory() as t:
  kit=Path(t)/'workspacex-install';kit.mkdir();shutil.copytree(P,kit/'.runtime',ignore=shutil.ignore_patterns('__pycache__','*.pyc','.local','dist'))
  deploy=P.parents[1]/'deploy/us'
  for name in ['README.md','.env.example','compose.yaml']:shutil.copy2(deploy/name,kit/name)
  for name in ['docker-seccomp.json','docker-apparmor-sessions']:shutil.copy2(P.parents[1]/'apps/skill-sandbox/security'/name,kit/'.runtime/templates'/name)
  (kit/'install.py').write_text("#!/usr/bin/env python3\nimport runpy\nfrom pathlib import Path\nrunpy.run_path(str(Path(__file__).resolve().parent/'.runtime/installer.py'),run_name='__main__')\n")
  source=kit/'.runtime'
  hashes={str(f.relative_to(source)):hashlib.sha256(f.read_bytes()).hexdigest() for f in source.rglob('*') if f.is_file() and f.name not in ('source-hashes.json','SHA256SUMS')}
  (source/'source-hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')
  for base in [kit/'.runtime',kit]:
   entries=[p for p in sorted(base.rglob('*')) if p.is_file() and p!=base/'SHA256SUMS']
   (base/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(base))+'\n' for p in entries))
  archive=output/'workspacex-install.tar.gz'
  with tarfile.open(archive,'w:gz') as tar:tar.add(kit,arcname=kit.name)
  (output/'workspacex-install.tar.gz.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
 return archive
def plan(c):
 print('Five official images:')
 for repo in ROLES.values():print('  '+c['registryPrefix']+'/'+repo+':'+c['releaseTag'])
 print('Redis: '+c['redisImage']);print('URL: https://'+c['domain'])
 print('Install: private config → databases → roles/schema/admin → applications → TLS → real business acceptance')
def install(c,args):
 if os.geteuid()!=0:raise ValueError('Run install as root on the target server')
 if platform.system()!='Linux' or platform.machine()!='x86_64':raise ValueError('Requires Ubuntu 24.04 x86_64')
 osinfo=Path('/etc/os-release').read_text()
 if 'ID=ubuntu' not in osinfo or 'VERSION_ID="24.04"' not in osinfo:raise ValueError('Requires Ubuntu 24.04 x86_64')
 if not(P/'source-hashes.json').exists():raise ValueError('Use install.py from the packaged release, not the source module')
 if not args.acme and not(args.cert and args.key):raise ValueError('Provide --cert/--key or --acme')
 if not args.acme and not all(Path(p).is_file() for p in [args.cert,args.key]):raise ValueError('Certificate/key file missing; no installation was started')
 # Preflight all host programs before writing runtime directories.
 for prog in ['curl','docker','nginx','apparmor_parser','aa-enabled','openssl','flock','systemctl','sha256sum']:
  if not shutil.which(prog):raise ValueError('Missing '+prog+'; follow README host prerequisites')
 expected=json.loads((P/'source-hashes.json').read_text())
 for name,digest in expected.items():
  if hashlib.sha256((P/name).read_bytes()).hexdigest()!=digest:raise ValueError('Installation code hash mismatch: '+name)
 requested_digest=hashlib.sha256(json.dumps(c,sort_keys=True).encode()).hexdigest()
 if RUNTIME.exists():
  if not(STATE/'bootstrap-complete').exists():raise ValueError('Partial installation exists; inspect state before retry. Do not delete database directories.')
  if (RUNTIME/'input-config.sha256').read_text().strip()!=requested_digest:raise ValueError('Existing instance differs from .env; this command does not update installations')
  c=json.loads((RUNTIME/'settings.json').read_text())
 else:
  c['sourceRevision']=resolve_source(c,inspect)
  redis=inspect(c['redisImage'])
  if redis.get('Os')!='linux' or redis.get('Architecture')!='amd64' or not redis.get('RepoDigests'):raise ValueError('Redis image platform/digest invalid')
  c['redisImage']=redis['RepoDigests'][0]
  private=prepare_runtime(c,requested_digest,P/'.local/runtime')
  command(['bash',str(P/'scripts/10-install.sh'),str(private),'--new-install'])
  command(['bash',str(P/'scripts/20-bootstrap.sh'),'--initialize-empty-instance'])
 if not Path('/etc/nginx/conf.d/workspacex-selfhost.conf').exists():
  if args.acme:
   command(['bash',str(P/'scripts/25-certificate.sh'),'--issue-public-certificate'])
   cert='/etc/letsencrypt/live/'+c['domain']+'/fullchain.pem';key='/etc/letsencrypt/live/'+c['domain']+'/privkey.pem'
  else:cert=args.cert;key=args.key
  command(['bash',str(P/'scripts/30-ingress.sh'),cert,key])
 if args.acme and not Path('/etc/letsencrypt/renewal-hooks/deploy/workspacex-selfhost').exists():command(['bash',str(P/'scripts/35-renewal.sh'),'--standalone-hooks'])
 command(['bash',str(P/'scripts/40-accept.sh')])
 print('Installed: https://'+c['domain']+' ; initial admin password: '+str(RUNTIME/'stable-secrets.json')+' (admin field)')
def main():
 a=argparse.ArgumentParser(description=__doc__);sub=a.add_subparsers(dest='action',required=True)
 for name in ['plan','install']:
  p=sub.add_parser(name);p.add_argument('--config',type=Path,default=Path('.env'))
  if name=='install':p.add_argument('--cert');p.add_argument('--key');p.add_argument('--acme',action='store_true')
 p=sub.add_parser('package');p.add_argument('--output',type=Path,default=Path('deploy/us/dist'))
 for name in ['status','logs','start','stop','verify','backup']:sub.add_parser(name)
 args=a.parse_args()
 if args.action=='package':print(package(args.output));return
 if args.action in ('plan','install'):
  c=load_settings(args.config)
  if args.action=='plan':plan(c)
  else:install(c,args)
 elif args.action in ['verify','backup']:
  command(['bash',str(P/'scripts'/('40-accept.sh' if args.action=='verify' else 'backup.sh'))]+(['--brief-downtime'] if args.action=='backup' else []))
 else:
  tail={'status':['ps'],'logs':['logs','--tail','100'],'start':['start'],'stop':['stop']}[args.action]
  command(['docker','compose','-p','workspacex-selfhost','--env-file',str(RUNTIME/'compose.env'),'-f',str(RUNTIME/'compose.json'),*tail])
if __name__=='__main__':
 try:main()
 except (ValueError,OSError,subprocess.SubprocessError) as e:print('INSTALL_FAILED: '+str(e),file=sys.stderr);sys.exit(1)
