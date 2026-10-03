import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {startManaged,killTree} from '../../../packages/local-runtime/src/processes.ts';

const root=realpathSync(resolve(process.cwd())),output=process.env.CWD_PROBE_OUTPUT;
assert(output,'Explicit safe evidence output required');
assert.equal(process.platform,'linux','This diagnostic requires actual Linux');
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert(/^[a-f0-9]{40}$/.test(sourceHead));
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
const results=[];
let cleanupCompleted=true;
try{
  for(const service of ['web','api']){
    const cwd=join(root,'apps',service),managed=startManaged({name:`cwd-probe-${service}`,command:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd},()=>{});
    let spawnFailed=false;
    managed.child.on('error',()=>{spawnFailed=true;});
    const closed=once(managed.child,'close').catch(()=>[]);
    try{
      await new Promise(resolve=>setTimeout(resolve,100));
      let pidAlive=false,commandExit=null,pathEqual=false;
      if(!spawnFailed&&managed.child.pid)try{process.kill(managed.child.pid,0);pidAlive=true;}catch{ /* Only the boolean is evidence. */ }
      if(pidAlive)try{
        const actual=execFileSync('lsof',['-a','-p',String(managed.child.pid),'-d','cwd','-Fn'],{encoding:'utf8',timeout:5000}).split('\n').find(line=>line.startsWith('n'))?.slice(1);
        commandExit=0;pathEqual=Boolean(actual&&realpathSync(actual)===realpathSync(cwd));
      }catch(error){commandExit=Number.isInteger(error.status)?error.status:-1;}
      results.push({service,pidAlive,commandExit,pathEqual});
    }finally{
      killTree(managed.child,'SIGTERM');
      let timer;
      const stopped=await Promise.race([closed.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),10000);})]);
      clearTimeout(timer);
      if(!stopped){
        cleanupCompleted=false;killTree(managed.child,'SIGKILL');
        await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);clearTimeout(timer);
      }
      if(managed.child.pid)try{process.kill(managed.child.pid,0);cleanupCompleted=false;}catch(error){if(error.code!=='ESRCH')cleanupCompleted=false;}
    }
  }
}catch{cleanupCompleted=false;}finally{
  writeFileSync(output,JSON.stringify({sourceHead,kind:'linux-node-spawn-cwd-probe',realApiWebIdentityVerified:false,cleanupCompleted,results},null,2),{mode:0o600,flag:'wx'});
}
assert(cleanupCompleted&&results.length===2&&results.every(item=>item.pidAlive&&item.commandExit===0&&item.pathEqual),'CWD_PROBE_FAILED');
