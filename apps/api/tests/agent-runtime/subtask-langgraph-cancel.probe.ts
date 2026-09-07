/** Standalone real langgraph-api 0.12.4 cancellation probe; no DB or model account. */
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {DeepAgentEngineRunController} from '../../src/infrastructure/plan-control/deep-agent-engine-run-controller';
import {deriveRemoteThreadId} from '../../src/infrastructure/agent-run/deep-agent-model-provider';

async function main(){
 const root=process.cwd();
 const version=execFileSync(resolve(root,'apps/deep-agent-service/.venv/bin/python'),['-c','import importlib.metadata; print(importlib.metadata.version("langgraph-api"))'],{encoding:'utf8'}).trim();
 assert.equal(version,'0.12.4');
 const dir=await mkdtemp(join(tmpdir(),'wx-w16-langgraph-'));
 const socket=createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));
 const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
 const base=`http://127.0.0.1:${port}`,started=join(dir,'started'),cancelled=join(dir,'cancelled'),finalized=join(dir,'finalized');
 const graph=`import asyncio\nfrom pathlib import Path\nfrom typing import TypedDict\nfrom langgraph.graph import StateGraph, START, END\nclass State(TypedDict):\n    text: str\nasync def wait_node(state):\n    await asyncio.to_thread(Path(${JSON.stringify(started)}).write_text, 'started')\n    try:\n        await asyncio.sleep(300)\n    except asyncio.CancelledError:\n        await asyncio.to_thread(Path(${JSON.stringify(cancelled)}).write_text, 'cancelled')\n        raise\n    finally:\n        await asyncio.to_thread(Path(${JSON.stringify(finalized)}).write_text, 'finalized')\n    return state\nbuilder=StateGraph(State)\nbuilder.add_node('wait_node',wait_node)\nbuilder.add_edge(START,'wait_node')\nbuilder.add_edge('wait_node',END)\ngraph=builder.compile()\n`;
 await writeFile(join(dir,'graph.py'),graph);await writeFile(join(dir,'langgraph.json'),JSON.stringify({dependencies:[resolve(root,'apps/deep-agent-service')],graphs:{cancel_probe:join(dir,'graph.py:graph')}}));
 const fd=openSync(join(dir,'server.log'),'w');
 const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:dir,TMPDIR:dir,LANG:'en_US.UTF-8',LANGSMITH_TRACING:'false',LANGGRAPH_DISABLE_ANALYTICS:'true'};
 const child=spawn(resolve(root,'apps/deep-agent-service/.venv/bin/langgraph'),['dev','--config',join(dir,'langgraph.json'),'--host','127.0.0.1','--port',String(port),'--no-browser','--no-reload'],{cwd:dir,env,detached:true,stdio:['ignore',fd,fd]});
 const exited=new Promise<void>(r=>{child.once('exit',()=>r());child.once('error',()=>r());});
 const until=async(check:()=>Promise<boolean>)=>{const end=Date.now()+60000;while(!await check()){if(child.exitCode!==null||Date.now()>end)throw new Error('probe deadline/server exited');await delay(100);}};
 try{
  await until(async()=>{try{return (await fetch(`${base}/ok`,{signal:AbortSignal.timeout(500)})).ok;}catch{return false;}});
  const id=randomUUID(),thread=deriveRemoteThreadId(id);
  const post=async(path:string,body:unknown)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});assert.equal(response.ok,true);return response.json();};
  await post('/threads',{thread_id:thread});
  const run=await post(`/threads/${thread}/runs`,{assistant_id:'cancel_probe',input:{text:'real cancellation probe'}}) as {run_id:string};
  await until(async()=>await readFile(started,'utf8').then(()=>true,()=>false));
  process.env.KERNEL_DEEP_AGENT_BASE_URL=base;process.env.KERNEL_DEEP_AGENT_TIMEOUT_MS='10000';
  await new DeepAgentEngineRunController().cancelRun(id,run.run_id);
  assert.equal(await readFile(cancelled,'utf8'),'cancelled');assert.equal(await readFile(finalized,'utf8'),'finalized');
  const terminal=await (await fetch(`${base}/threads/${thread}/runs/${run.run_id}`,{signal:AbortSignal.timeout(5000)})).json() as {status:string};
  assert.equal(terminal.status,'interrupted');
  console.log(JSON.stringify({runtime:`langgraph-api==${version}`,actualRemoteProcess:true,remoteStatus:terminal.status,cancelledExceptionObserved:true,nodeFinallyObserved:true,externalModelCalls:0}));
 }catch(error){
  console.error((await readFile(join(dir,'server.log'),'utf8')).slice(-12000));throw error;
 }finally{
  if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  const kill=setTimeout(()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{}}},5000);
  await exited;clearTimeout(kill);closeSync(fd);await rm(dir,{recursive:true,force:true});
 }
}
main().catch(()=>{console.error('real LangGraph cancellation probe failed');process.exitCode=1;});
