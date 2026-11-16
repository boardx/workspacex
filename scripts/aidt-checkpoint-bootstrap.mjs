// Invoked only by the isolated standard startup before a restored fixture may skip its reset seed.
import{resolve}from'node:path';import{fileURLToPath}from'node:url';
import{verifyRestoredReceipt}from'./lib/aidt-checkpoint-restored-db.mjs';
import{invariant}from'./lib/aidt-checkpoint-restore.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);try{invariant(args.length===3&&args[0]==='--receipt'&&args[2]==='--emit-fixture','CHECKPOINT_BOOTSTRAP_ARGUMENTS');const{fixture}=await verifyRestoredReceipt(root,args[1]);const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";console.log('export FULLSTACK_E2E_FIXTURE=1');for(const[k,v]of Object.entries(fixture))if(typeof v==='string')console.log('export FULLSTACK_E2E_'+k.replace(/([A-Z])/g,'_$1').toUpperCase()+'='+quote(v));}catch(error){console.error(JSON.stringify({ok:false,reason:/^CHECKPOINT_[A-Z_]+$/.test(error.message)?error.message:'CHECKPOINT_BOOTSTRAP_FAILED'}));process.exitCode=1;}
