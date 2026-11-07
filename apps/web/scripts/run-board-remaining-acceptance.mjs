import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,openSync,closeSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {remainingAcceptanceVerdict} from '../board-remaining-registry.mjs';

const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const script=fileURLToPath(import.meta.url);
const config='playwright.board-remaining.config.ts';
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
async function execute(command,args,{cwd=root,env=process.env,log}){
  const fd=openSync(log,'a',0o600);
  try{return await new Promise((resolveResult,reject)=>{
    const child=spawn(command,args,{cwd,env,stdio:['ignore',fd,fd]});
    const signals=['SIGINT','SIGTERM'];
    const handlers=signals.map(signal=>{const handler=()=>child.kill(signal);process.on(signal,handler);return [signal,handler];});
    const release=()=>{for(const [signal,handler]of handlers)process.off(signal,handler);};
    child.once('error',error=>{release();reject(error);});
    child.once('exit',(code,signal)=>{release();resolveResult({command:[command,...args],exitCode:code,signal});});
  });}finally{closeSync(fd);}
}

async function worker(directory){
  const head=git(['rev-parse','HEAD']);
  const summary={kind:'supplementary-restored-cases-not-fullstack-or-native',head,status:'FAIL',firstFailure:null,commands:[],collection:null,execution:null,cleanup:'OUTER_ISOLATION_WRAPPER_PENDING'};
  const fail=code=>{summary.firstFailure??=code;};
  try{
    if(git(['status','--porcelain','--untracked-files=no']))throw new Error('TRACKED_SOURCE_DIRTY');
    const reports=[['collection',['--list']],['execution',[]]];
    for(const [phase,extra]of reports){
      const report=join(directory,`${phase}.json`),log=join(directory,`${phase}.private.log`);
      const result=await execute('pnpm',['exec','playwright','test','--config',config,...extra,'--reporter=json'],{
        cwd:join(root,'apps/web'),env:{...process.env,PLAYWRIGHT_JSON_OUTPUT_NAME:report},log,
      });
      summary.commands.push({...result,phase,report,log});
      if(result.exitCode!==0||result.signal)fail(`${phase.toUpperCase()}_COMMAND_FAILED`);
      if(!existsSync(report)){fail(`${phase.toUpperCase()}_REPORT_ABSENT`);break;}
      summary[phase]=remainingAcceptanceVerdict(JSON.parse(readFileSync(report,'utf8')),{collection:phase==='collection'});
      if(summary[phase].failures.length)fail(`${phase.toUpperCase()}_CONTRACT_FAILED`);
      if(summary.firstFailure)break;
    }
    if(git(['rev-parse','HEAD'])!==head||git(['status','--porcelain','--untracked-files=no']))fail('SOURCE_CHANGED_DURING_RUN');
    if(!summary.firstFailure&&summary.execution?.status==='PASS')summary.status='CASES_PASSED_CLEANUP_PENDING';
  }catch(error){
    // Detailed errors are private evidence, not a public diagnostic body.
    writeFileSync(join(directory,'runner.private.log'),String(error?.stack??error),{mode:0o600});fail('RUNNER_FAILED');
  }finally{save(join(directory,'cases-summary.json'),summary);}
  return summary.status==='CASES_PASSED_CLEANUP_PENDING'?0:1;
}

export async function runRemainingAcceptance(){
  process.umask(0o077);
  if(process.env.WORKSPACEX_KEEP_TEST_STACK==='1')throw new Error('SUPPLEMENTARY_ACCEPTANCE_REQUIRES_OWNED_STACK_CLEANUP');
  const directory=mkdtempSync(join(tmpdir(),'wsx-board-remaining-'));
  const head=git(['rev-parse','HEAD']);
  // One fresh isolation scope owns both collection and actual execution, and
  // its standard finally block owns DB/service cleanup. No existing DB is selected.
  // Explicit fixed command-kind tokens keep this compound worker inside the
  // harness's existing playwright/test heavy-suite admission lock.
  const command=['exec','tsx','.harness/scripts/with-test-isolation.ts','--',process.execPath,script,'--isolated-worker',directory,'--','playwright','test'];
  let result,summary;
  try{
    result=await execute('pnpm',command,{log:join(directory,'isolation.private.log')});
    summary=JSON.parse(readFileSync(join(directory,'cases-summary.json'),'utf8'));
    summary.isolationCommand=result;
    summary.cleanup=result.exitCode===0&&!result.signal?'ISOLATION_WRAPPER_EXIT_0':'ISOLATION_WRAPPER_FAILED';
    if(result.exitCode!==0||result.signal){summary.firstFailure??='ISOLATION_OR_CLEANUP_FAILED';summary.status='FAIL';}
    else if(summary.head===head&&git(['rev-parse','HEAD'])===head&&summary.execution?.status==='PASS'&&!summary.firstFailure)summary.status='PASS';
    else{summary.firstFailure??='FINAL_SOURCE_OR_CASES_MISMATCH';summary.status='FAIL';}
  }catch(error){
    writeFileSync(join(directory,'outer.private.log'),String(error?.stack??error),{mode:0o600});
    summary={kind:'supplementary-restored-cases-not-fullstack-or-native',head,status:'FAIL',firstFailure:'ISOLATION_OR_REPORT_FAILED',isolationCommand:result??null,cleanup:'UNVERIFIED'};
  }
  save(join(directory,'summary.json'),summary);
  process.stdout.write(JSON.stringify({status:summary.status,head,evidence:join(directory,'summary.json'),kind:summary.kind})+'\n');
  return summary.status==='PASS'?0:1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]==='--isolated-worker'&&process.argv.length===7&&JSON.stringify(process.argv.slice(4))===JSON.stringify(['--','playwright','test']))process.exitCode=await worker(resolve(process.argv[3]));
  else if(process.argv.length===2)process.exitCode=await runRemainingAcceptance();
  else throw new Error('NO_CASE_FILTER_OR_EXTRA_ARGUMENTS_ALLOWED');
}
