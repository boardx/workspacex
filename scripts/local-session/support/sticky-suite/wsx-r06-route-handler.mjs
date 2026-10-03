export async function settleStickyRoute({route,scheduler,record}){
 try{
  await scheduler.run(async()=>{
   const response=await route.fetch({maxRetries:0});
   if(response.status()>=400)record({code:'HTTP_FAILURE',status:response.status()});
   await route.fulfill({response});
  });
 }catch(error){
  record({code:'ROUTE_FAILURE',status:null,privateMessage:error?.message??String(error)});
  try{await route.abort('failed');}
  catch(abortError){record({code:'ROUTE_ABORT_FAILURE',status:null,privateMessage:abortError?.message??String(abortError)});}
 }
}

export function createOwnedStickyRoutes({context,matcher,scheduler,record,exclusiveContext,deadlineMs=35000}){
 if(exclusiveContext!==true)throw new Error('STICKY_ROUTE_EXCLUSIVE_CONTEXT_REQUIRED');
 const tasks=new Set();let accepting=true,closing;
 const handler=route=>{
  if(!accepting)record({code:'LATE_ROUTE_ADMISSION',status:null});
  const task=settleStickyRoute({route,scheduler,record}).catch(error=>record({code:'ROUTE_HANDLER_FAILURE',status:null,privateMessage:error?.message??String(error)}));
  tasks.add(task);void task.finally(()=>tasks.delete(task));return task;
 };
 return {
  install:()=>context.route(matcher,handler),
  drain(){
   if(closing)return closing;
   accepting=false;
   closing=(async()=>{
    let timer;
    try{
     await Promise.race([
      (async()=>{await context.unrouteAll({behavior:'wait'});if(tasks.size)throw new Error('STICKY_ROUTE_HANDLERS_NOT_SETTLED');})(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('STICKY_ROUTE_DRAIN_TIMEOUT')),deadlineMs);}),
     ]);
    }catch(error){record({code:'ROUTE_DRAIN_FAILURE',status:null,privateMessage:error?.message??String(error)});throw error;}
    finally{clearTimeout(timer);}
   })();return closing;
  },
 };
}
