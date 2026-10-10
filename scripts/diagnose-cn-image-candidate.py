#!/usr/bin/env python3
"""Single agent build diagnostic. No archive export or release authorization."""
import argparse,importlib.util,json,os,re,selectors,shutil,signal,subprocess,sys,tarfile,tempfile,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cn_image_candidate as c
import cn_image_archive as a
spec=importlib.util.spec_from_file_location('candidate_builder',Path(__file__).with_name('build-cn-image-candidates.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
CommandFailure=b.CommandFailure
command_category=b.command_category
PHASE='INPUT';HINTS={};LINE_LIMIT=0;DEADLINE=None
PHASES={'INPUT','EVENT_REF','PLAN','CONTROL','SOURCE','DOCKERFILE_CONTRACTS','CAPACITY','SOURCE_ARCHIVE','AGENT_BUILD','COMPLETE'}
CODES={'DIAGNOSTIC_EVENT_REF','DIAGNOSTIC_CONTROL_BINDING','DIAGNOSTIC_CAPACITY','DIAGNOSTIC_OUTPUT','DIAGNOSTIC_PLAN_SIZE','DIAGNOSTIC_SCRIPT_BYTES'}
def phase(value):
 global PHASE
 PHASE=value

def event_guard(env):
 a.require(env.get('EVENT_NAME')=='workflow_dispatch' and env.get('GITHUB_REF')=='refs/heads/main','DIAGNOSTIC_EVENT_REF')

def observe(raw):
 # Untrusted build messages are hints, never a root-cause assertion or raw output.
 lower=raw.lower()
 for key,needle in {'dns':b'no such host','tls':b'x509:','authentication':b'unauthorized','rateLimit':b'too many requests','missingFile':b'no such file or directory','noSpace':b'no space left on device','dependencyResolution':b'resolutionimpossible'}.items():HINTS[key]=needle in lower
 HINTS['dockerfileLines']=sorted({int(n) for n in re.findall(rb'(?m)^Dockerfile:([0-9]{1,6})\s*$',raw) if 1<=int(n)<=LINE_LIMIT})[:64]

def run(argv,cwd=None,*,stdout_file=None,stdout_limit=None):
    category=command_category(argv)
    if stdout_file is not None:
        a.require(type(stdout_limit) is int and 0<stdout_limit<=2*1024**3,'DIAGNOSTIC_OUTPUT')
    stdout_size=0
    if DEADLINE is not None and time.monotonic()>=DEADLINE:raise CommandFailure(category,'COMMAND_TIMEOUT')
    env={'PATH':'/usr/bin:/bin','LANG':'C','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_REPLACE_OBJECTS':'1','GIT_NO_LAZY_FETCH':'1'}
    with tempfile.TemporaryDirectory(prefix='wsx-candidate-home-') as home:
        env['HOME']=home;env['DOCKER_CONFIG']=str(Path(home)/'docker');Path(env['DOCKER_CONFIG']).mkdir(mode=0o700)
        try:process=subprocess.Popen(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        except OSError:raise CommandFailure(category,'COMMAND_START_FAILED') from None
        selector=selectors.DefaultSelector();buffers={};deadline=min(time.monotonic()+1200,DEADLINE) if DEADLINE is not None else time.monotonic()+1200
        try:
            for stream in (process.stdout,process.stderr):buffers[stream]=bytearray();selector.register(stream,selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic()>=deadline:raise CommandFailure(category,'COMMAND_TIMEOUT')
                for key,_ in selector.select(.2):
                    data=os.read(key.fileobj.fileno(),8192)
                    if not data:selector.unregister(key.fileobj);continue
                    if key.fileobj is process.stdout and stdout_file is not None:
                        stdout_size+=len(data)
                        if stdout_size>stdout_limit:raise a.Rejected('CANDIDATE_SAVE_LIMIT')
                        stdout_file.write(data);continue
                    if len(buffers[key.fileobj])+len(data)>8*1024**2:raise CommandFailure(category,'COMMAND_OUTPUT_LIMIT')
                    buffers[key.fileobj].extend(data)
            try:rc=process.wait(timeout=1)
            except subprocess.TimeoutExpired:raise CommandFailure(category,'COMMAND_TIMEOUT') from None
            if rc!=0:
                if category in {'DOCKER_BUILD','DOCKER_SAVE'}:observe(bytes(buffers[process.stdout])+b'\n'+bytes(buffers[process.stderr]))
                raise CommandFailure(category,'COMMAND_NONZERO',rc)
            return bytes(buffers[process.stdout])
        finally:
            if process.poll() is None:os.killpg(process.pid,signal.SIGKILL)
            process.wait();selector.close();process.stdout.close();process.stderr.close()

def execute(raw,source,output,env,command=run):
 global LINE_LIMIT,HINTS,DEADLINE
 DEADLINE=time.monotonic()+1200;HINTS={};LINE_LIMIT=0;phase('EVENT_REF');event_guard(env)
 phase('PLAN');a.require(len(raw)<=16384,'DIAGNOSTIC_PLAN_SIZE');p=c.validate_diagnostic_plan(a.decode(raw))
 a.require(p['controlRevision']==env.get('GITHUB_SHA'),'DIAGNOSTIC_CONTROL_BINDING')
 phase('CONTROL');b.control(p,command)
 root=Path(__file__).resolve().parent.parent
 for name in ('scripts/diagnose-cn-image-candidate.py','.github/workflows/diagnose-cn-image-candidate.yml'):
  a.require((root/name).read_bytes()==command(['git','show',p['controlRevision']+':'+name],root),'DIAGNOSTIC_SCRIPT_BYTES')
 phase('SOURCE');source=Path(source)
 a.require(command(['git','rev-parse','HEAD'],source).decode().strip()==c.SOURCE,'CANDIDATE_SOURCE_SHA')
 a.require(not command(['git','status','--porcelain','--untracked-files=all'],source).strip(),'CANDIDATE_SOURCE_DIRTY')
 command(['git','merge-base','--is-ancestor',c.SOURCE,'origin/main'],source)
 phase('DOCKERFILE_CONTRACTS')
 for service,v in p['sourceContracts'].items():
  data=command(['git','show',c.SOURCE+':'+v['dockerfile']],source)
  a.require(a.sha(data)==v['dockerfileSha256'],'CANDIDATE_DOCKERFILE_HASH')
  if service=='agent':LINE_LIMIT=len(data.splitlines())
 phase('CAPACITY');out=Path(output)
 a.require(out.parent.is_dir() and not out.exists() and not out.is_symlink(),'DIAGNOSTIC_OUTPUT')
 a.require(shutil.disk_usage(out.parent).free>=10*1024**3 and os.statvfs(out.parent).f_favail>=4096,'DIAGNOSTIC_CAPACITY')
 with tempfile.TemporaryDirectory(prefix='wsx-agent-diagnostic-',dir=out.parent) as td:
  phase('SOURCE_ARCHIVE');temp=Path(td);archive=temp/'source.tar';command(['git','archive','--format=tar','--output',str(archive),c.SOURCE],source)
  checkout=temp/'source';checkout.mkdir()
  with tarfile.open(archive,'r:') as stream:stream.extractall(checkout,filter='data')
  v=p['sourceContracts']['agent']
  # Recheck authorization/binding immediately before the only Docker operation.
  phase('EVENT_REF');event_guard(env);a.require(p['controlRevision']==env.get('GITHUB_SHA'),'DIAGNOSTIC_CONTROL_BINDING')
  phase('AGENT_BUILD');argv=['docker','buildx','build','--load','--progress=plain','--platform',p['platform'],'--label','org.opencontainers.image.revision='+c.SOURCE,'--label',c.LABEL+'='+c.identity(p),'-f',str(checkout/v['dockerfile']),'-t',c.tag(p,'agent'),'--build-arg','PYTHON_IMAGE='+p['baseImages']['python'],'--build-arg','SOURCE_REVISION='+c.SOURCE,str(checkout/v['context'])]
  command(argv)
 phase('COMPLETE');return {'status':'BUILD_COMPLETED','sourceRevision':c.SOURCE,'controlRevision':p['controlRevision'],'planRawSha256':a.sha(raw),'productionReady':False,'releaseReady':False,'rootCauseEstablished':False}

def failure(error):
 v=b.diagnostic(error);code=v['code']
 if isinstance(error,a.Rejected) and len(error.args)==1 and type(error.args[0]) is str and error.args[0] in CODES:code=error.args[0]
 return {'status':'DIAGNOSTIC_FAILED','phase':PHASE if PHASE in PHASES else 'INPUT','checkCode':code,'category':v.get('subcommand'),'returncode':v.get('returncode'),'observedErrorHints':dict(HINTS),'dockerfileLineCount':LINE_LIMIT,'rootCauseEstablished':False,'releaseReady':False,'productionReady':False}

def validate_metadata(raw):
 a.require(type(raw) is bytes and len(raw)<=16384,'DIAGNOSTIC_OUTPUT');v=a.decode(raw)
 a.require(type(v) is dict and v.get('productionReady') is False and v.get('releaseReady') is False and v.get('rootCauseEstablished') is False,'DIAGNOSTIC_OUTPUT')
 common={'status','productionReady','releaseReady','rootCauseEstablished'}
 if v.get('status')=='BUILD_COMPLETED':
  a.require(set(v)==common|{'sourceRevision','controlRevision','planRawSha256'} and v['sourceRevision']==c.SOURCE and a.hex_string(v['controlRevision'],40) and a.hex_string(v['planRawSha256'],64),'DIAGNOSTIC_OUTPUT')
 else:
  a.require(v.get('status')=='DIAGNOSTIC_FAILED' and set(v)==common|{'phase','checkCode','category','returncode','observedErrorHints','dockerfileLineCount'},'DIAGNOSTIC_OUTPUT')
  codes=b.SAFE_CODES|CODES|{'OPERATION_FAILED','COMMAND_START_FAILED','COMMAND_TIMEOUT','COMMAND_OUTPUT_LIMIT','COMMAND_NONZERO'}
  a.require(type(v['phase']) is str and v['phase'] in PHASES and type(v['checkCode']) is str and v['checkCode'] in codes,'DIAGNOSTIC_OUTPUT')
  a.require(v['category'] is None or type(v['category']) is str and v['category'] in {'GIT_IDENTITY','GIT_STATUS','GIT_CONTRACT','GIT_ANCESTRY','GIT_ARCHIVE','DOCKER_BUILD','DOCKER_SAVE','OTHER_COMMAND'},'DIAGNOSTIC_OUTPUT')
  a.require(v['returncode'] is None or type(v['returncode']) is int and -255<=v['returncode']<=255,'DIAGNOSTIC_OUTPUT')
  limit=v['dockerfileLineCount'];a.require(type(limit) is int and 0<=limit<=8*1024**2,'DIAGNOSTIC_OUTPUT')
  hints=v['observedErrorHints'];a.require(type(hints) is dict and set(hints)<={'dns','tls','authentication','rateLimit','missingFile','noSpace','dependencyResolution','dockerfileLines'},'DIAGNOSTIC_OUTPUT')
  for key,value in hints.items():
   if key=='dockerfileLines':a.require(type(value) is list and len(value)<=64 and all(type(n) is int and 1<=n<=limit for n in value),'DIAGNOSTIC_OUTPUT')
   else:a.require(type(value) is bool,'DIAGNOSTIC_OUTPUT')
 return v

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
 output=Path(args.output);rc=0
 try:result=execute(os.environ.get('BUILD_PLAN','').encode(),args.source,output,dict(os.environ))
 except Exception as error:
  result=failure(error);rc=error.returncode if isinstance(error,CommandFailure) and type(error.returncode) is int and 1<=error.returncode<=255 else 1
 data=json.dumps(result,sort_keys=True).encode()+b'\n'
 # Metadata only; bounded well below the 16MiB artifact ceiling, no raw plan/output.
 validate_metadata(data)
 a.require(len(data)<=16384 and output.parent.is_dir() and not output.exists() and not output.is_symlink(),'DIAGNOSTIC_OUTPUT')
 with open(output,'xb') as stream:stream.write(data)
 print(data.decode(),end='');return rc
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print(json.dumps({'status':'DIAGNOSTIC_FAILED','phase':'INPUT','checkCode':'DIAGNOSTIC_METADATA_WRITE_FAILED','productionReady':False,'releaseReady':False}),file=sys.stderr);sys.exit(1)
