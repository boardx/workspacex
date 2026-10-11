"""Local-only exact small-read/status/clear parameters; runtime and evidence are hash bound."""
import base64,datetime,hashlib,json,os,re,sys,zlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def generate(c):
 mode=c['mode'];assert mode in ('read-receipts','status','clear-hold')
 root=c['remoteRoot'];assert re.fullmatch('/var/lib/workspacex-cn/runtime/upgrade-f0eb-[a-z0-9-]{1,64}',root)
 raw=Path(c['binding']).read_bytes();b=json.loads(raw);assert b['draft']is False and b['sourceRevision']=='f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
 cfg=dict(mode=mode,root=root,bindingSha256=sha(raw),issuedAt=c['issuedAt'],expiresAt=c['expiresAt'])
 now=datetime.datetime.now(datetime.timezone.utc);start=datetime.datetime.fromisoformat(c['issuedAt']);end=datetime.datetime.fromisoformat(c['expiresAt']);assert start<=now<end and end-start<=datetime.timedelta(minutes=30),'REQUEST_EXPIRED'
 template=(HERE/'runtime.py').read_text();ns={'__name__':'finalize_validation'};exec(compile(template.replace('__CONFIG__','{}'),'finalize_validation','exec'),ns)
 if mode=='read-receipts':
  assert set(c['files'])<=ns['READABLE'];cfg['files']=c['files']
 else:
  hold=json.loads(Path(c['hold']).read_bytes());assert hold==b['hold'] and hold['state']=='held','HOLD_GENERATION_CHANGED';cfg['hold']=hold
  switch=Path(c['switchReceipt']).read_bytes();assert json.loads(switch)=={'exactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False};cfg['switchReceiptSha256']=sha(switch)
  if mode=='clear-hold':
   assert c['clearHoldAuthorized']is True;cfg['clearHoldAuthorized']=True
   status=Path(c['status']).read_bytes();cfg.update(statusSha256=sha(status),statusBase64=base64.b64encode(status).decode());ns['validate_clear'](cfg,b,json.loads(status),now)
 source=template.replace('__CONFIG__',repr(cfg));compile(source,'bound_finalize','exec');packed=base64.b64encode(zlib.compress(source.encode())).decode();command="/usr/bin/python3.12 -I -S -B - <<'F0EB_FINALIZE'\nimport base64,hashlib,zlib\nb=zlib.decompress(base64.b64decode("+repr(packed)+"))\nassert hashlib.sha256(b).hexdigest()=="+repr(sha(source.encode()))+"\nexec(compile(b,'<bound-finalize>','exec'))\nF0EB_FINALIZE\n";assert len(command.encode())<=18000
 params={'RegionId':'cn-shanghai','InstanceId.1':'i-uf6ga92ewloganobbln6','Type':'RunShellScript','Name':'f0eb-'+mode,'CommandContent':command,'ContentEncoding':'PlainText','Timeout':'120','WorkingDir':'/','Username':'root','RepeatMode':'Once','KeepCommand':'false','EnableParameter':'false'}
 return cfg,source,params
if __name__=='__main__':
 c=json.loads(Path(sys.argv[1]).read_bytes());cfg,source,params=generate(c);out=Path(c['output']);out.mkdir(mode=0o700)
 for name,v in [('bound.py',source),('parameters.json',json.dumps(params,sort_keys=True)+'\n'),('binding-summary.json',json.dumps(dict(cfg,cloudCalls=0),sort_keys=True)+'\n')]:
  with (out/name).open('x')as f:(out/name).chmod(0o600);f.write(v)
 print(json.dumps(dict(output=str(out),parametersSha256=sha((out/'parameters.json').read_bytes()),cloudCalls=0)))
