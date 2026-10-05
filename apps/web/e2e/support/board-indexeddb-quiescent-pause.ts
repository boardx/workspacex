/** Test-only observation; serialize directly with addInitScript before app code. */
export function installIndexedDbTransactionObserver(key: string): void {
 const target=globalThis as unknown as Record<string,unknown>;
 if(Object.prototype.hasOwnProperty.call(target,key))throw new Error('IDB_QUIESCENCE_ALREADY_INSTALLED');
 const state={active:0,failed:false};
 const original=IDBDatabase.prototype.transaction;
 IDBDatabase.prototype.transaction=function(this: IDBDatabase,...args: Parameters<IDBDatabase['transaction']>) {
  const transaction=Reflect.apply(original,this,args) as IDBTransaction;
  state.active++;
  let finished=false;
  const finish=()=>{if(finished)return;finished=true;state.active--;if(state.active<0)state.failed=true;};
  try{transaction.addEventListener('complete',finish);transaction.addEventListener('abort',finish);}
  catch(error){state.failed=true;throw error;}
  return transaction;
 } as IDBDatabase['transaction'];
 Object.defineProperty(target,key,{value:state,writable:false,configurable:false});
}

/** Pause in the same timer task that observes no live transactions. */
export function requestIndexedDbQuiescentPause({key,binding}: {key:string;binding:string}): void {
 const target=globalThis as unknown as Record<string,unknown>;
 const state=target[key] as {active:number;failed:boolean}|undefined;
 const notify=target[binding];
 if(!state||typeof notify!=='function'||state.failed||!Number.isSafeInteger(state.active)||state.active<0)throw new Error('IDB_QUIESCENCE_UNAVAILABLE');
 const attempt=()=>{
  if(state.failed||!Number.isSafeInteger(state.active)||state.active<0)throw new Error('IDB_QUIESCENCE_INVALID');
  if(state.active!==0){setTimeout(attempt,0);return;}
  (notify as (message:string)=>void)(JSON.stringify({type:'storage-quiescent',active:0}));
  debugger;
 };
 setTimeout(attempt,0);
}
