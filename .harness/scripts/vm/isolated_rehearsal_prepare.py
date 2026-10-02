#!/usr/bin/env python3
"""Assemble reviewed target-neutral inputs into exact clone-bound manifests.
No cloud operation, SQL, secret generation, or installed-system mutation.
"""
import ast,hashlib,json,os,sys
from pathlib import Path
from isolated_rehearsal import exclusive,input_ref,preflight,validate_binding

def modules_for(entry,available):
 root=Path(entry['path']).name;todo=[(root,input_ref(entry))];seen={};modules={}
 while todo:
  name,raw=todo.pop()
  if name in seen:continue
  seen[name]=raw
  if not name.endswith('.py'):continue
  for node in ast.walk(ast.parse(raw)):
   imports=([node.module] if isinstance(node,ast.ImportFrom) else [x.name for x in node.names] if isinstance(node,ast.Import) else [])
   for module in imports:
    if not module or not module.startswith('isolated_'):continue
    filename=module.split('.')[0]+'.py'
    if filename==root:continue
    if filename not in available:raise ValueError('REVIEWED_MODULE_REQUIRED:'+filename)
    ref=available[filename]
    if Path(ref['path']).name!=filename:raise ValueError('MODULE_BASENAME_BINDING')
    if filename not in modules:modules[filename]=ref;todo.append((filename,input_ref(ref)))
 return dict(entry,modules=modules)

def review_template(request):
 # This is a pre-purchase byte-closure check, not an invented target binding.
 b=request['binding'];stage=json.loads(input_ref(request['stageTemplate'],True))
 if stage.get('prepared') is not True or stage.get('candidateSha')!=b['candidateSha'] or 'targetInstanceId' in stage or 'attemptId' in stage:raise ValueError('TARGET_NEUTRAL_FROZEN_TEMPLATE_REQUIRED')
 def walk(value,key=''):
  if isinstance(value,dict):
   if 'path' in value and 'sha256' in value:input_ref(value,True)
   for name,child in value.items():walk(child,name)
  elif isinstance(value,list):
   for child in value:walk(child,key)
 walk(stage)
 available=request['reviewedModules']
 modules_for({'path':b['adapterPath'],'sha256':b['adapterSha256']},available)
 for entry in b['stages'].values():modules_for(entry,available)
 return {'reviewedInputBytesAvailable':True,'targetBindingRequired':True,'liveAccepted':False,'candidateSha':b['candidateSha']}

def prepare(request,directory,validate=preflight):
 b=dict(request['binding']);validate_binding(b)
 stage=json.loads(input_ref(request['stageTemplate'],True))
 if stage.get('candidateSha')!=b['candidateSha'] or stage.get('prepared') is not True:raise ValueError('PREPARED_TEMPLATE_REQUIRED')
 # Do not silently retarget an earlier attempt's template.
 for key in ('targetInstanceId','attemptId'):
  if key in stage and stage[key]!=b[key]:raise ValueError('OLD_TEMPLATE_TARGET')
 stage.update({key:b[key] for key in ('targetInstanceId','attemptId')})
 available=request['reviewedModules']
 adapter=modules_for({'path':b['adapterPath'],'sha256':b['adapterSha256']},available)
 b['adapterModules']=adapter['modules'];b['stages']={name:modules_for(entry,available) for name,entry in b['stages'].items()}
 directory=Path(directory)
 st=directory.lstat()
 if not directory.is_absolute() or not directory.is_dir() or st.st_uid!=os.geteuid() or st.st_mode&0o077:raise ValueError('PRIVATE_OUTPUT_DIRECTORY')
 stage_path=directory/'bound-stages.json';binding_path=directory/'bound-rehearsal.json';created=[]
 try:
  exclusive(stage_path,stage);created.append(stage_path)
  b.update(stageManifestPath=str(stage_path),stageManifestSha256=hashlib.sha256(stage_path.read_bytes()).hexdigest())
  result=validate(b)
  exclusive(binding_path,b);created.append(binding_path)
  return {'preparedInputClosure':result['preparedInputClosure'],'liveAccepted':False,'candidateSha':b['candidateSha'],'manifest':{'path':str(binding_path),'sha256':hashlib.sha256(binding_path.read_bytes()).hexdigest()},'stageManifest':{'path':str(stage_path),'sha256':b['stageManifestSha256']}}
 except BaseException:
  for path in reversed(created):path.unlink()
  raise
if __name__=='__main__':
 try:
  if os.geteuid()!=0 or len(sys.argv)!=4:raise ValueError('ROOT_REQUEST_HASH_DIRECTORY_REQUIRED')
  request=json.loads(input_ref({'path':sys.argv[1],'sha256':sys.argv[2]},True))
  print(json.dumps(review_template(request) if sys.argv[3]=='--review-template' else prepare(request,sys.argv[3])))
 except BaseException:print('ISOLATED_INPUT_PREPARATION_REJECTED',file=sys.stderr);sys.exit(1)
