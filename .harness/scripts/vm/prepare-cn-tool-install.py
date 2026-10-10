#!/usr/bin/env python3
"""Local review-package producer; deliberately has no installation executor."""
import ast,hashlib,json,os,pathlib,re,stat,subprocess,sys,shutil,datetime

def require(value,code):
 if not value:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def safe_file(path):
 p=pathlib.Path(path)
 for parent in p.parents:require(parent.is_dir() and not parent.is_symlink(),'INPUT_PARENT')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_nlink==1,'INPUT_FILE');raw=f.read();after=os.fstat(f.fileno());named=p.lstat()
  require((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns) and (named.st_dev,named.st_ino)==(s.st_dev,s.st_ino),'INPUT_CHANGED')
  return raw
def trusted_local_git(repo):
 # Reject external metadata and executable Git configuration before invoking Git.
 root=pathlib.Path(repo).absolute();uid=os.getuid()
 for parent in (root,*root.parents):
  st=parent.lstat()
  require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode),'GIT_PARENT_DIRECTORY')
  require(not st.st_mode&0o022 or bool(st.st_mode&stat.S_ISVTX),'GIT_PARENT_WRITABLE')
 gd=root/'.git';st=gd.lstat()
 require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and st.st_uid==uid and not st.st_mode&0o022,'GIT_DIRECTORY_REQUIRED')
 for name in ('commondir','gitdir','objects/info/alternates','objects/info/http-alternates','shallow'):
  require(not os.path.lexists(gd/name),'GIT_EXTERNAL_OR_PARTIAL')
 for name in ('objects','refs'):
  require((gd/name).is_dir() and not (gd/name).is_symlink(),'GIT_CLOSURE_DIRECTORY')
 inventory=[]
 for directory,dirs,files in os.walk(gd,followlinks=False):
  for name in sorted(dirs+files):
   p=pathlib.Path(directory)/name;st=p.lstat()
   require(st.st_uid==uid and not st.st_mode&0o022 and (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)),'GIT_MEMBER_TRUST')
   require(not name.endswith('.promisor'),'GIT_PROMISOR')
   if stat.S_ISREG(st.st_mode):
    require(st.st_nlink==1,'GIT_MEMBER_HARDLINK')
    raw=safe_file(p);inventory.append({'path':str(p.relative_to(gd)),'sha256':sha(raw)})
 config=safe_file(gd/'config')
 require(not re.search(rb'^\s*\[(?:include(?:if)?|filter)[\s\]]',config,re.M|re.I),'GIT_CONFIG_EXECUTION')
 require(not re.search(rb'^\s*(?:promisor|partialclone)\s*=',config,re.M|re.I),'GIT_PARTIAL_CONFIG')
 return sha(json.dumps(sorted(inventory,key=lambda x:x['path']),sort_keys=True).encode())
def git(repo,*args):
 trusted_local_git(repo)
 return execute_git(repo,*args)
def git_command(repo,*args):
 return ['git','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',str(repo),*args]
def git_environment():
 return {'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0'}
def execute_git(repo,*args):
 # Only called inside produce's single prechecked session (or git wrapper above).
 return subprocess.check_output(git_command(repo,*args),env=git_environment(),stderr=subprocess.DEVNULL)
def tool_root_contract(raw,tool):
 # Derive the existing runtime target convention from its exact source AST.
 prefixes=[]
 for node in ast.walk(ast.parse(raw)):
  if isinstance(node,ast.Compare) and isinstance(node.left,ast.Call) and isinstance(node.left.func,ast.Attribute) and node.left.func.attr=='get' and node.left.args and isinstance(node.left.args[0],ast.Constant) and node.left.args[0].value=='toolRoot':
   for right in node.comparators:
    if isinstance(right,ast.BinOp) and isinstance(right.op,ast.Add) and isinstance(right.left,ast.Constant) and isinstance(right.left.value,str) and isinstance(right.right,ast.Name) and right.right.id=='tool':prefixes.append(right.left.value)
 require(len(set(prefixes))==1,'TOOL_ROOT_CONTRACT_REQUIRED')
 prefix=prefixes[0];require(prefix.startswith('/') and '..' not in pathlib.PurePosixPath(prefix).parts,'TOOL_ROOT_CONTRACT_PATH')
 return prefix+tool
def tree_closure(repo,tool,metadata_hash,source_paths=None):
 fsck=execute_git(repo,'fsck','--full','--no-reflogs')
 raw=execute_git(repo,'ls-tree','-r','-z',tool);entries=[]
 for record in raw.split(b'\0'):
  if not record:continue
  meta,name=record.split(b'\t',1);mode,kind,blob=meta.decode().split();path=name.decode()
  require(mode in ('100644','100755','120000') and kind=='blob','TOOL_TREE_REGULAR_ONLY')
  require(not pathlib.PurePosixPath(path).is_absolute() and '..' not in pathlib.PurePosixPath(path).parts,'TOOL_TREE_PATH')
  entries.append({'path':path,'mode':mode,'blobSha':blob})
 links={entry['path'] for entry in entries if entry['mode']=='120000'}
 tracked={entry['path'] for entry in entries}
 directories={''}
 for entry in entries:
  directories.update(str(parent) for parent in pathlib.PurePosixPath(entry['path']).parents if str(parent)!='.')
 tracked.update(directories)
 # The exact installation allowlist is the authority. Never permit executable
 # payload sources, or their ancestors, to be represented by symbolic links.
 if source_paths is None:
  source_paths=allowlist(execute_git(repo,'show',tool+':.harness/scripts/vm/cn-build-tool-identity.py')) if links else ()
 for source in source_paths:
  require(not any(source==link or source.startswith(link+'/') for link in links),'TOOL_INSTALL_SOURCE_SYMLINK')
 # One persistent process, bounded reads: process count and metadata scans do not scale with blobs.
 child=subprocess.Popen(git_command(repo,'cat-file','--batch'),env=git_environment(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 try:
  for entry in entries:
   blob=entry['blobSha'];child.stdin.write((blob+'\n').encode());child.stdin.flush()
   header=child.stdout.readline(256).decode().strip().split()
   require(len(header)==3 and header[0]==blob and header[1]=='blob' and header[2].isdigit(),'TOOL_BATCH_HEADER')
   size=int(header[2]);git_hash=hashlib.sha1(('blob '+str(size)+'\0').encode());content_hash=hashlib.sha256();remaining=size;link_raw=[]
   if entry['mode']=='120000':require(0<size<=4096,'TOOL_SYMLINK_SIZE')
   while remaining:
    chunk=child.stdout.read(min(remaining,1024*1024));require(chunk,'TOOL_BATCH_TRUNCATED')
    git_hash.update(chunk);content_hash.update(chunk);remaining-=len(chunk)
    if entry['mode']=='120000':link_raw.append(chunk)
   require(child.stdout.read(1)==b'\n' and git_hash.hexdigest()==blob,'TOOL_BLOB_HASH')
   entry.update(sha256=content_hash.hexdigest(),bytes=size)
   if entry['mode']=='120000':
    # Interpret only the already-hashed Git blob. Do not resolve or open the
    # corresponding filesystem link, including links to tracked directories.
    target=b''.join(link_raw).decode('utf-8')
    require(target and '\0' not in target and '\n' not in target and '\r' not in target and not target.startswith('/'),'TOOL_SYMLINK_RELATIVE')
    parts=list(pathlib.PurePosixPath(entry['path']).parent.parts)
    for component in target.split('/'):
     # Each remaining lexical component requires an actual tracked directory.
     # In particular, regular-file/../dir must not be normalized past ENOTDIR.
     require('/'.join(parts) in directories,'TOOL_SYMLINK_NON_DIRECTORY')
     if component in ('','.'):continue
     if component=='..':
      require(parts,'TOOL_SYMLINK_ESCAPE');parts.pop()
     else:parts.append(component)
     # Reject even a transient traversal through a link followed by '..'.
     require('/'.join(parts) not in links,'TOOL_SYMLINK_CHAIN')
    resolved='/'.join(parts)
    require(resolved and not entry['path'].startswith(resolved+'/'),'TOOL_SYMLINK_DIRECTORY_CYCLE')
    require(resolved in tracked,'TOOL_SYMLINK_UNTRACKED')
    require(not any(resolved==link or resolved.startswith(link+'/') for link in links),'TOOL_SYMLINK_CHAIN')
    entry.update(linkTarget=target,resolvedTrackedPath=resolved)
  child.stdin.close();require(child.wait()==0,'TOOL_BATCH_FAILED')
 finally:
  if child.poll() is None:child.kill();child.wait()
  child.stdout.close()
  if not child.stdin.closed:child.stdin.close()
 return {'toolRevision':tool,'treeSha':execute_git(repo,'rev-parse',tool+'^{tree}').decode().strip(),'inventorySha256':sha(raw),'fsckStdoutSha256':sha(fsck),'fsckExitCode':0,'gitMetadataInventorySha256':metadata_hash,'entries':entries,'localOnly':True,'deploymentVerified':False}
def allowlist(raw):
 tree=ast.parse(raw)
 assignments=[n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FILES' for t in n.targets)]
 require(len(assignments)==1,'ALLOWLIST_SINGLE_SOURCE');value=ast.literal_eval(assignments[0].value)
 require(isinstance(value,dict) and value,'ALLOWLIST')
 for source,target in value.items():
  require(isinstance(source,str) and not source.startswith('/') and '..' not in pathlib.PurePosixPath(source).parts,'SOURCE_PATH')
  require(target is None or (isinstance(target,str) and target.startswith('/usr/local/') and '..' not in pathlib.PurePosixPath(target).parts),'TARGET_PATH')
 require(len([v for v in value.values() if v])==len(set(v for v in value.values() if v)),'TARGET_DUPLICATE')
 return value
# Keep this pure verifier byte-identical in producer and installer (parity-tested).
def inventory_json(raw):
 def pairs(items):
  result={}
  for key,value in items:
   require(key not in result,'INVENTORY_DUPLICATE_KEY');result[key]=value
  return result
 def constant(value):raise ValueError('INVENTORY_NONFINITE_JSON')
 def floating(value):
  import math
  result=float(value);require(math.isfinite(result),'INVENTORY_NONFINITE_JSON');return result
 return json.loads(raw,object_pairs_hook=pairs,parse_constant=constant,parse_float=floating)

def verify_inventory_output(receipt,decoded,legacy_error):
 import base64,zlib
 encoding=receipt.get('outputEncoding','raw-json-v1')
 if encoding=='raw-json-v1':
  require('outputBase64' not in receipt and 'decodedInventorySha256' not in receipt,'PROVIDER_ENCODING_AMBIGUOUS')
  require(receipt.get('outputSha256')==sha(decoded),legacy_error)
  return receipt['outputSha256']
 require(encoding=='gzip-base64-inventory-v1','PROVIDER_OUTPUT_ENCODING')
 encoded=receipt.get('outputBase64');require(type(encoded)is str and len(encoded)<=32000,'PROVIDER_WIRE_BOUND')
 try:wire=base64.b64decode(encoded,validate=True)
 except Exception as e:raise ValueError('PROVIDER_WIRE_BASE64')from e
 require(0<len(wire)<=24000 and base64.b64encode(wire).decode()==encoded,'PROVIDER_WIRE_BOUND')
 require(sha(wire)==receipt.get('outputSha256'),'PROVIDER_WIRE_HASH')
 envelope=inventory_json(wire)
 require(type(envelope)is dict and set(envelope)=={'schemaVersion','kind','decodedBytes','decodedSha256','gzipBase64'},'PROVIDER_ENVELOPE_SCHEMA')
 require(type(envelope['schemaVersion'])is int and envelope['schemaVersion']==1 and envelope['kind']=='cn-tool-inventory-gzip-base64-v1','PROVIDER_ENVELOPE_KIND')
 require((json.dumps(envelope,sort_keys=True)+'\n').encode()==wire,'PROVIDER_ENVELOPE_CANONICAL')
 size=envelope['decodedBytes'];require(type(size)is int and 0<size<=1024*1024,'PROVIDER_DECODED_BOUND')
 compressed64=envelope['gzipBase64'];require(type(compressed64)is str and len(compressed64)<=24000,'PROVIDER_GZIP_BOUND')
 try:compressed=base64.b64decode(compressed64,validate=True)
 except Exception as e:raise ValueError('PROVIDER_GZIP_BASE64')from e
 require(0<len(compressed)<=18000 and base64.b64encode(compressed).decode()==compressed64 and size<=len(compressed)*128,'PROVIDER_COMPRESSION_RATIO')
 try:
  inflater=zlib.decompressobj(16+zlib.MAX_WBITS);raw=inflater.decompress(compressed,size+1)
 except zlib.error as e:raise ValueError('PROVIDER_GZIP_INVALID')from e
 require(len(raw)==size and inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail,'PROVIDER_GZIP_COMPLETE')
 inventory_json(raw) # Reject nested duplicate keys independently of local normalization.
 require(raw==decoded and sha(raw)==envelope['decodedSha256']==receipt.get('decodedInventorySha256'),'PROVIDER_DECODED_HASH')
 return receipt['outputSha256']

def verify_inventory_receipt(inventory_raw,receipt_raw,expected,now=None):
 inventory=inventory_json(inventory_raw);receipt=inventory_json(receipt_raw)
 require(isinstance(expected,dict) and set(expected)=={'region','instanceId','sourceInvocation','commandId'},'PROVIDER_EXPECTED_BINDING')
 require(receipt.get('schemaVersion')==1 and inventory.get('schemaVersion')==1,'PROVIDER_SCHEMA')
 for key,value in expected.items():require(isinstance(value,str) and value and receipt.get(key)==value,'PROVIDER_TARGET_BINDING')
 require(receipt.get('invocationStatus')=='Success' and type(receipt.get('exitCode')) is int and receipt['exitCode']==0 and type(receipt.get('dropped')) is int and receipt['dropped']==0,'PROVIDER_TERMINAL_SUCCESS')
 require(receipt.get('readOnly') is True and receipt.get('productionModified') is False and receipt.get('ready') is False and inventory.get('readOnly') is True and inventory.get('ready') is False,'PROVIDER_READ_ONLY')
 require(inventory.get('sourceInvocation')==expected['sourceInvocation'] and receipt.get('inventoryObservedAt')==inventory.get('observedAt'),'PROVIDER_OBSERVATION_BINDING')
 require(receipt.get('localInventorySha256')==sha(inventory_raw),'PROVIDER_LOCAL_BYTES')
 # Actual capture protocol adds sourceInvocation locally after provider stdout.
 remote=dict(inventory);remote.pop('sourceInvocation')
 output_raw=(json.dumps(remote,sort_keys=True)+'\n').encode()
 wire_sha=verify_inventory_output(receipt,output_raw,'PROVIDER_OUTPUT_BYTES')
 def time(value):
  require(isinstance(value,str),'PROVIDER_TIME_REQUIRED')
  parsed=datetime.datetime.fromisoformat(value.replace('Z','+00:00'));require(parsed.tzinfo is not None,'PROVIDER_TIME_ZONE');return parsed
 current=now or datetime.datetime.now(datetime.timezone.utc);require(current.tzinfo is not None,'PROVIDER_CURRENT_TIME_ZONE')
 start=time(receipt.get('startTime'));observed=time(inventory.get('observedAt'))
 require(0<=(current-start).total_seconds()<3600 and 0<=(current-observed).total_seconds()<3600,'PROVIDER_NOT_FRESH')
 require(0<=(observed-start).total_seconds()<=300,'PROVIDER_CAPTURE_WINDOW')
 finish=receipt.get('finishTime')
 if finish is not None:require(start<=time(finish)<=current and (current-time(finish)).total_seconds()<3600,'PROVIDER_FINISH_TIME')
 return {'schemaVersion':1,'receiptSha256':sha(receipt_raw),'localInventorySha256':sha(inventory_raw),'outputSha256':wire_sha,'outputEncoding':receipt.get('outputEncoding','raw-json-v1'),'decodedInventorySha256':sha(output_raw),'expected':expected,'startTime':receipt['startTime'],'finishTime':finish,'inventoryObservedAt':inventory['observedAt'],'freshnessSeconds':3600,'receiptAuthenticity':'externally pinned root-captured receipt required; local byte verification only'}
PROFILE_SCHEMA_SOURCE='.harness/scripts/vm/cn_tool_profile.py'
def profile_content(tool,rows,schema_raw=None,runtime=None,extension=None,expected_extension=None):
 if PROFILE_SCHEMA_SOURCE not in rows:
  require(extension is None and expected_extension is None,'COMPOSE_EXTENSION_SCHEMA_REQUIRED')
  return {'toolRevision':tool,'filesSha256':{name:row['newSha256'] for name,row in rows.items()}}
 require(schema_raw is not None and sha(schema_raw)==rows[PROFILE_SCHEMA_SOURCE]['newSha256'],'PROFILE_SCHEMA_SOURCE_BINDING')
 namespace={'__name__':'exact_git_bound_profile_schema'}
 exec(compile(schema_raw,PROFILE_SCHEMA_SOURCE,'exec'),namespace)
 if extension is None and expected_extension is None:return namespace['build_profile'](tool,rows,runtime)
 return namespace['build_profile'](tool,rows,runtime,extension,expected_extension)

def extension_evidence(tool,rows,schema_raw,extension,expected,app=None,git_blob=None,old_projection=False):
 if extension is None:
  require(expected is None,'COMPOSE_EXTENSION_UNSOLICITED_PIN');return None
 require(PROFILE_SCHEMA_SOURCE in rows and sha(schema_raw)==rows[PROFILE_SCHEMA_SOURCE]['newSha256'],'PROFILE_SCHEMA_SOURCE_BINDING')
 namespace={'__name__':'exact_git_bound_profile_schema'}
 exec(compile(schema_raw,PROFILE_SCHEMA_SOURCE,'exec'),namespace)
 require('validate_compose_extension' in namespace,'COMPOSE_EXTENSION_SCHEMA_REQUIRED')
 if old_projection:return namespace['validate_compose_projection'](extension,tool,app,git_blob)
 return namespace['validate_compose_extension'](extension,expected,tool,app,git_blob)

def rebuild_old_profile(tool,rows,schema_raw,runtime,projection):
 if projection is None:return profile_content(tool,rows,schema_raw,runtime)
 require(PROFILE_SCHEMA_SOURCE in rows and sha(schema_raw)==rows[PROFILE_SCHEMA_SOURCE]['newSha256'],'PROFILE_SCHEMA_SOURCE_BINDING')
 namespace={'__name__':'exact_git_bound_profile_schema'}
 exec(compile(schema_raw,PROFILE_SCHEMA_SOURCE,'exec'),namespace)
 require('rebuild_profile' in namespace,'COMPOSE_EXTENSION_SCHEMA_REQUIRED')
 return namespace['rebuild_profile'](tool,rows,runtime,projection)

def old_profile_allowlist(content,old_files,inventory):
 require(isinstance(old_files,dict) and old_files,'PROFILE_OLD_ALLOWLIST_CLOSURE')
 if 'composeExtensionV1' in content:
  # Exact old Git FILES is preserved separately; extras are reconstructed by
  # old_profile_binding from the root-inventory-pinned old schema/container.
  require(set(content.get('composeBaseFilesSha256',{}))==set(old_files),'PROFILE_OLD_ALLOWLIST_CLOSURE')
 else:require(set(content['filesSha256'])==set(old_files),'PROFILE_OLD_ALLOWLIST_CLOSURE')
 require(all(inventory.get('files',{}).get(source,{}).get('target')==target for source,target in old_files.items()),'PROFILE_OLD_TARGET_AUTHORITY')

def old_profile_binding(old,previous,old_schema_raw=None):
 import base64,re
 require(old.get('present') is True and old.get('regular') is True and old.get('symlink') is False and old.get('mode')=='0600' and all(type(old.get(k)) is int for k in ('uid','gid','links')) and (old['uid'],old['gid'],old['links'])==(0,0,1) and re.fullmatch('[a-f0-9]{64}',old.get('sha256','') or ''),'PROFILE_OLD_PRESENT_TRUST')
 try:raw=base64.b64decode(old['rawBase64'],validate=True);content=json.loads(raw)
 except Exception:require(False,'PROFILE_OLD_RAW')
 require(len(raw)<=8000000 and sha(raw)==old['sha256'] and raw==(json.dumps(content,sort_keys=True)+'\n').encode(),'PROFILE_OLD_RAW_BINDING')
 tool=content.get('toolRevision');require(re.fullmatch('[a-f0-9]{40}',tool or ''),'PROFILE_OLD_TOOL')
 hashes=content.get('filesSha256');require(isinstance(hashes,dict) and hashes,'PROFILE_OLD_CLOSURE')
 extension=content.get('composeExtensionV1')
 base_hashes=content.get('composeBaseFilesSha256') if extension is not None else hashes
 require(isinstance(base_hashes,dict) and base_hashes,'PROFILE_OLD_BASE_CLOSURE')
 rows={}
 for source,digest in base_hashes.items():
  before=previous.get('files',{}).get(source);require(isinstance(before,dict),'PROFILE_OLD_SOURCE_INVENTORY')
  target=before.get('target')
  if target is not None:require(before.get('present') is True and before.get('regular') is True and before.get('symlink') is False and before.get('sha256')==digest and before.get('uid')==0 and before.get('gid')==0 and before.get('links')==1,'PROFILE_OLD_INSTALLED_BINDING')
  rows[source]={'target':target,'newSha256':digest}
 require(content==rebuild_old_profile(tool,rows,old_schema_raw,previous.get('runtimes',{}).get('node'),extension),'PROFILE_OLD_CONTENT_AUTHORITY')
 return tool,rows

def profile_transaction(tool,rows,payload,previous,previous_raw,receipt_binding=None,old_schema_raw=None,extension=None,expected_extension=None):
 # Existing hold consumer is the authority for the profile location and mode.
 hold=[source for source in rows if pathlib.PurePosixPath(source).name=='cn_maintenance_hold.py']
 if len(hold)!=1:return None
 source=hold[0];raw=payload[source];tree=ast.parse(raw);paths=[];modes=[]
 for node in ast.walk(tree):
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='profile' for t in node.targets) and isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id=='Path' and len(node.value.args)==1 and isinstance(node.value.args[0],ast.Constant):paths.append(node.value.args[0].value)
  if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='read' and len(node.args)==2 and isinstance(node.args[0],ast.Name) and node.args[0].id=='profile' and isinstance(node.args[1],ast.Constant):modes.append(node.args[1].value)
 require(len(set(paths))==1 and len(set(modes))==1,'PROFILE_CONSUMER_CONTRACT')
 target=paths[0];mode=modes[0]
 require(isinstance(target,str) and pathlib.PurePosixPath(target).is_absolute() and '..' not in pathlib.PurePosixPath(target).parts and mode==0o600,'PROFILE_CONSUMER_MODE')
 old=previous.get('profiles',{}).get(target)
 if old is None:return None
 require(previous.get('readOnly') is True and previous.get('ready') is False,'PROFILE_INVENTORY_READ_ONLY')
 if old.get('present') is True:
  old_profile_binding(old,previous,old_schema_raw)
  import base64
  require('composeExtensionV1' not in json.loads(base64.b64decode(old['rawBase64'],validate=True)) or extension is not None,'COMPOSE_EXTENSION_REMOVAL_NOT_AUTHORIZED')
 else:require(old.get('present') is False and old.get('regular') is False and old.get('symlink') is False and all(old.get(k) is None for k in ('sha256','mode','uid','gid','links')),'PROFILE_OLD_ABSENCE_REQUIRED')
 content=profile_content(tool,rows,payload.get(PROFILE_SCHEMA_SOURCE),previous.get('runtimes',{}).get('node'),extension,expected_extension)
 content_raw=(json.dumps(content,sort_keys=True)+'\n').encode()
 return {'schemaVersion':1,'kind':'reviewed-profile-replace-proposal' if old['present'] else 'reviewed-profile-create-proposal','target':target,'mode':format(mode,'04o'),'uid':0,'gid':0,'links':1,'oldPresent':old['present'],'oldIdentity':old,'previousInventorySha256':sha(previous_raw),'inventoryObservedAt':previous['observedAt'],'inventorySourceInvocation':previous['sourceInvocation'],'consumerSource':source,'consumerSha256':sha(raw),'consumerContract':'Python AST profile=Path(...) and read(profile,mode)','content':content,'newSha256':sha(content_raw),'bytes':len(content_raw),'inventoryEvidenceRef':'inventoryEvidenceV1' if receipt_binding else None,'providerSuccessIndependentlyVerified':False,'installationAuthorized':False,'ready':False}
def produce(repo,tool,app,main,inventory,output,provider_receipt=None,expected_provider=None,now=None,compose_extension=None,expected_extension=None):
 for value in (tool,app,main):require(re.fullmatch('[a-f0-9]{40}',value),'EXACT_REVISION')
 metadata_hash=trusted_local_git(repo)
 # This local name scopes unchecked execution to a fully prechecked, finally rechecked session.
 git=execute_git
 # Caller supplies a local verified main commit; no network or moving-ref resolution.
 require(git(repo,'rev-parse',main+'^{commit}').decode().strip()==main,'MAIN_OBJECT')
 git(repo,'merge-base','--is-ancestor',tool,main)
 require(git(repo,'rev-parse',app+'^{commit}').decode().strip()==app,'APP_OBJECT')
 identity_raw=git(repo,'show',tool+':.harness/scripts/vm/cn-build-tool-identity.py')
 files=allowlist(identity_raw)
 tool_root=tool_root_contract(identity_raw,tool)
 closure=tree_closure(repo,tool,metadata_hash,files)
 previous_raw=safe_file(inventory);previous=json.loads(previous_raw)
 require(previous.get('schemaVersion')==1 and previous.get('observedAt') and previous.get('sourceInvocation'),'OLD_INVENTORY_REQUIRED')
 old=previous.get('files',{});require(set(old)==set(files),'OLD_INVENTORY_CLOSURE')
 payload={};rows={}
 for source,target in files.items():
  mode='0700' if target else '0600';row=old[source]
  require(row.get('target')==target and isinstance(row.get('present'),bool),'OLD_INVENTORY_IDENTITY')
  if row['present']:require(row.get('mode') in ('0400','0500','0600','0644','0700','0755') and re.fullmatch('[a-f0-9]{64}',row.get('sha256','')) and isinstance(row.get('uid'),int) and isinstance(row.get('gid'),int) and row.get('links')==1 and row.get('regular') is True and row.get('symlink') is False,'OLD_INVENTORY_IDENTITY')
  else:require(all(row.get(k) is None for k in ('sha256','mode','uid','gid','links')),'ABSENT_INVENTORY_VALUES')
  entry=git(repo,'ls-tree',tool,'--',source).decode().split()
  require(len(entry)==4 and entry[0] in ('100644','100755') and entry[1]=='blob' and entry[3]==source,'SOURCE_REGULAR_BLOB')
  raw=git(repo,'show',tool+':'+source);payload[source]=raw
  rows[source]={'target':target,'mode':mode,'oldPresent':row['present'],'oldSha256':row.get('sha256'),'oldMode':row.get('mode'),'oldUid':row.get('uid'),'oldGid':row.get('gid'),'oldNlink':row.get('links'),'newSha256':sha(raw),'bytes':len(raw)}
 out=pathlib.Path(output);require(not os.path.lexists(out),'OUTPUT_EXISTS')
 for parent in out.parents:
  st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and (not st.st_mode&0o022 or bool(st.st_mode&stat.S_ISVTX)),'OUTPUT_PARENT')
 manifest={'schemaVersion':1,'mode':'review-package-only','applicationRevision':app,'toolRevision':tool,'localAncestryMainRevision':main,'localOnly':True,'installationAuthorized':False,'inventoryTrust':'untrustedInput','inventoryObservedAt':previous['observedAt'],'inventorySourceInvocation':previous['sourceInvocation'],'previousInventorySha256':sha(previous_raw),'files':rows,'generatorSha256':sha(safe_file(__file__)),'directoryDurabilityVerified':False,'installerImplemented':False,'installed':False,'ready':False}
 evidence_payload={};receipt_binding=None
 if provider_receipt is not None:
  receipt_raw=safe_file(provider_receipt);receipt_binding=verify_inventory_receipt(previous_raw,receipt_raw,expected_provider,now)
  evidence_payload={'inventory.json':previous_raw,'provider-receipt.json':receipt_raw}
 extension=None
 if compose_extension is not None:
  import base64
  extension_raw=safe_file(compose_extension)
  extension={'sha256':sha(extension_raw),'rawBase64':base64.b64encode(extension_raw).decode()}
 def extension_git_blob(rev,source):
  entry=git(repo,'ls-tree',rev,'--',source).decode().split()
  require(len(entry)==4 and entry[0] in ('100644','100755') and entry[1]=='blob' and entry[3]==source,'COMPOSE_EXTENSION_REGULAR_GIT_BLOB')
  return git(repo,'show',rev+':'+source)
 extension_evidence(tool,rows,payload.get(PROFILE_SCHEMA_SOURCE),extension,expected_extension,app,extension_git_blob)
 old_schema_raw=None
 for old in previous.get('profiles',{}).values():
  if old.get('present') is True:
   import base64
   old_content=json.loads(base64.b64decode(old['rawBase64'],validate=True));old_tool=old_content['toolRevision']
   require('composeExtensionV1' not in old_content or extension is not None,'COMPOSE_EXTENSION_REMOVAL_NOT_AUTHORIZED')
   old_files=allowlist(git(repo,'show',old_tool+':.harness/scripts/vm/cn-build-tool-identity.py'))
   old_profile_allowlist(old_content,old_files,previous)
   old_schema_raw=git(repo,'show',old_tool+':'+PROFILE_SCHEMA_SOURCE) if PROFILE_SCHEMA_SOURCE in old_files else None
   unused,old_rows=old_profile_binding(old,previous,old_schema_raw)
   old_extension=old_content.get('composeExtensionV1')
   if old_extension is not None:extension_evidence(old_tool,old_rows,old_schema_raw,old_extension,None,git_blob=extension_git_blob,old_projection=True)
   for source,row in old_rows.items():require(sha(git(repo,'show',old_tool+':'+source))==row['newSha256'],'PROFILE_OLD_GIT_CLOSURE')
 profile=profile_transaction(tool,rows,payload,previous,previous_raw,receipt_binding,old_schema_raw,extension,expected_extension)
 if extension is not None:
  require(profile is not None,'COMPOSE_EXTENSION_PROFILE_REQUIRED');manifest['composeExtensionV1']=extension
 blockers=['TOOL_ROOT_GIT_ARTIFACT_NOT_PACKAGED','PRODUCTION_INSTALL_APPROVAL_MISSING']
 blockers.append('PROFILE_TRANSACTION_REVIEW_PENDING' if profile else 'ROOT_PROFILE_OLD_INVENTORY_MISSING')
 if profile and not receipt_binding:blockers.append('PROVIDER_RECEIPT_BINDING_MISSING')
 evidence=None
 if receipt_binding:evidence={'inventoryPath':str((out/'evidence/inventory.json').absolute()),'inventorySha256':sha(previous_raw),'providerReceiptPath':str((out/'evidence/provider-receipt.json').absolute()),'providerReceiptSha256':sha(receipt_raw),'expected':expected_provider,'ttlSeconds':3600}
 manifest.update(toolRoot=tool_root,trustedGitClosure=closure,profileEntries=[],profileTransactionsV1=[profile] if profile else [],profileProposal={'toolRevision':tool,'filesSha256':{source:row['newSha256'] for source,row in rows.items()}},inventoryEvidenceV1=evidence,installationBlockers=blockers)
 require(trusted_local_git(repo)==closure['gitMetadataInventorySha256'],'GIT_METADATA_CHANGED')
 out.mkdir(mode=0o700);owned=out.lstat()
 try:
  for source,raw in payload.items():
   dest=out/'payload'/source;dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  for name,raw in evidence_payload.items():
   dest=out/'evidence'/name;dest.parent.mkdir(exist_ok=True,mode=0o700)
   fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  fd=os.open(out/'manifest.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb') as f:f.write((json.dumps(manifest,sort_keys=True)+'\n').encode());f.flush();os.fsync(f.fileno())
  require(json.loads(safe_file(out/'manifest.json'))==manifest,'MANIFEST_READBACK')
  for source,raw in payload.items():require(safe_file(out/'payload'/source)==raw,'PAYLOAD_READBACK')
  for name,raw in evidence_payload.items():require(safe_file(out/'evidence'/name)==raw,'EVIDENCE_READBACK')
  marker=(sha(safe_file(out/'manifest.json'))+'\n').encode()
  fd=os.open(out/'COMPLETE',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb') as f:f.write(marker);f.flush();os.fsync(f.fileno())
  require(safe_file(out/'COMPLETE')==marker,'COMPLETE_READBACK')
 except BaseException:
  current=out.lstat()
  require((current.st_dev,current.st_ino)==(owned.st_dev,owned.st_ino) and stat.S_ISDIR(current.st_mode),'OUTPUT_CLEANUP_UNPROVEN')
  shutil.rmtree(out)
  raise
 return manifest
if __name__=='__main__':
 try:
  extra={}
  if '--compose-extension' in sys.argv:
   i=sys.argv.index('--compose-extension');require(i==len(sys.argv)-3,'COMPOSE_EXTENSION_ARGUMENTS')
   extra.update(compose_extension=sys.argv[i+1],expected_extension=sys.argv[i+2]);sys.argv=sys.argv[:i]
  require(len(sys.argv) in (8,10),'USAGE_REPO_TOOL_APP_MERGEDMAIN_INVENTORY_OUTPUT_OPTIONAL_RECEIPT_EXPECTED')
  # Reserved exact protocol version prevents accidental legacy positional invocation.
  require(sys.argv[1]=='--review-package','REVIEW_ONLY')
  if len(sys.argv)==10:extra.update(provider_receipt=sys.argv[8],expected_provider=json.loads(safe_file(sys.argv[9])))
  result=produce(*sys.argv[2:8],**extra);print(json.dumps({'mode':result['mode'],'fileCount':len(result['files']),'installerImplemented':False,'ready':False}))
 except Exception:print('CN_TOOL_REVIEW_PACKAGE_REJECTED',file=sys.stderr);sys.exit(1)
