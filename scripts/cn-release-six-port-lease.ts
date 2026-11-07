/** Parent-supervised port lease only; no Docker or application startup. */
import {createInterface} from 'node:readline';
import {ensureReservedTestIsolation} from '../.harness/scripts/lib/test-isolation';
async function main(){
 const lease=await ensureReservedTestIsolation({}, {worktreePath:process.cwd(),leaseDir:process.env.CN_SIX_LEASE_DIR});
 if(!lease.reserved)throw Error('FRESH_LEASE_REQUIRED');
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});let released=false,disposed=false;
 const out=(value:unknown)=>process.stdout.write(JSON.stringify(value)+'\n');
 out({kind:'cn-six-lease-v1',environment:lease.env,reserved:true});
 try{for await(const line of lines){
  if(line.length>256)throw Error('LEASE_COMMAND_LIMIT');const request=JSON.parse(line);
  if(request.command==='release'&&!released){lease.markStarting();await lease.release();released=true;out({released:true});}
  else if(request.command==='dispose'&&typeof request.verified==='boolean'){await lease.dispose(request.verified);disposed=true;out({disposed:true,verified:request.verified});break;}
  else throw Error('LEASE_COMMAND_REJECTED');
 }}finally{if(!disposed)await lease.dispose(false);lines.close();}
}
main().catch(()=>{process.stderr.write('SIX_PORT_LEASE_FAILED\n');process.exitCode=1;});
