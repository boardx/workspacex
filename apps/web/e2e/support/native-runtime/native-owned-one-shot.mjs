import assert from 'node:assert/strict';
import {createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {finished} from 'node:stream/promises';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export function ownedGroupAlive(pid) {
  if (pid === undefined) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export function createOwnedOneShots({startManaged,killTree,termMs=8000,killMs=2000}) {
  assert(process.platform !== 'win32', 'Native PostgreSQL runner requires POSIX ownership');
  for (const budget of [termMs,killMs]) assert(Number.isInteger(budget)&&budget>0&&budget<=10000);
  const owned=[];
  let stopping=false,stopPromise;
  const start=spec=>{
    assert(!stopping,'OWNED_ONE_SHOT_ADMISSION_CLOSED');
    const {logDir,...spawnSpec}=spec;
    const managed=startManaged(spawnSpec,()=>{});
    const log=logDir?createWriteStream(join(logDir,`${spec.name}.log`),{flags:'a',mode:0o600}):null;
    const logFinished=log?finished(log):Promise.resolve();
    logFinished.catch(()=>{});
    if(log){for(const stream of [managed.child.stdout,managed.child.stderr])stream?.on('data',chunk=>log.write(chunk));}
    let closed=false;
    const close=new Promise((resolve,reject)=>managed.child.once('close',()=>{
      log?.end();
      logFinished.then(()=>{
        closed=true;
        if(log&&(!log.closed||!log.writableFinished)){reject(new Error('OWNED_ONE_SHOT_LOG_DRAIN_UNCONFIRMED'));return;}
        resolve();
      },error=>{closed=true;reject(error);});
    }));
    close.catch(()=>{});
    const item={managed,close,isClosed:()=>closed};
    owned.push(item);
    return {child:managed.child,async completed(){const code=await managed.exited;await close;assert(!stopping,'OWNED_ONE_SHOT_CANCELLED');return code;}};
  };
  const stop=()=>{
    if(stopPromise)return stopPromise;
    stopping=true;
    stopPromise=(async()=>{
      const failures=[];
      for(const item of [...owned].reverse()){
        try{
          const {child}=item.managed;
          const settled=()=>!ownedGroupAlive(child.pid)&&item.isClosed();
          if(!settled())killTree(child,'SIGTERM');
          let deadline=Date.now()+termMs;
          while(!settled()&&Date.now()<deadline)await sleep(10);
          if(!settled()){
            killTree(child,'SIGKILL');deadline=Date.now()+killMs;
            while(!settled()&&Date.now()<deadline)await sleep(10);
          }
          assert(settled(),'OWNED_ONE_SHOT_DRAIN_UNCONFIRMED');
          await item.close;
        }catch(error){failures.push(error);}
      }
      if(failures.length)throw new AggregateError(failures,'OWNED_ONE_SHOT_STOP_FAILED');
    })();
    return stopPromise;
  };
  return {start,stop,isStopping:()=>stopping};
}
