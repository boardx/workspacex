import assert from 'node:assert/strict';
import {createServer} from 'node:net';

const defaults = Object.freeze({web:36317,api:36320,postgres:36321,deepAgent:36324,sandbox:36325,asr:36326,ollama:36335,modelProvider:36327,deepAgentProvider:36328,loopbackSandbox:36329,asrProvider:36330,mailProvider:36331});
const localKeys = ['web','api','postgres','deepAgent','sandbox','asr','ollama'];
const providerVariables = Object.freeze({modelProvider:'WORKSPACEX_MODEL_PROVIDER_PORT',deepAgentProvider:'WORKSPACEX_DEEP_AGENT_PROVIDER_PORT',loopbackSandbox:'WORKSPACEX_LOOPBACK_SANDBOX_PORT',asrProvider:'WORKSPACEX_ASR_PROVIDER_PORT',mailProvider:'WORKSPACEX_MAIL_PROVIDER_PORT'});

export function nativeRuntimePorts(value=defaults){
  assert(value!==null&&typeof value==='object'&&!Array.isArray(value),'complete native port map required');
  const keys=Object.keys(value),required=Object.keys(defaults);
  assert.deepEqual(keys.filter(key=>key!=='proxyWebSocket').sort(),required.sort(),'exact complete native port keys required');
  for(const port of Object.values(value))assert(Number.isInteger(port)&&port>=1024&&port<=65535,'bounded integer native ports required');
  assert.equal(new Set(Object.values(value)).size,keys.length,'native service ports must be distinct');
  return Object.freeze({...value});
}

export function localRuntimePorts(value){
  const ports=nativeRuntimePorts(value);
  return Object.fromEntries(localKeys.map(key=>[key,ports[key]]));
}

export function nativeProviderEnvironment(value){
  const ports=nativeRuntimePorts(value);
  return Object.fromEntries(Object.entries(providerVariables).map(([key,variable])=>[variable,String(ports[key])]));
}

export async function assertNativePortsAvailable(value,{serverFactory=createServer,listenTimeoutMs=5000,closeTimeoutMs=5000}={}){
  for(const timeout of [listenTimeoutMs,closeTimeoutMs])assert(Number.isInteger(timeout)&&timeout>0&&timeout<=5000);
  const ports=nativeRuntimePorts(value),attempts=[];let failure;
  try{
    for(const port of Object.values(ports)){
      const server=serverFactory(socket=>socket.destroy()),controller=new AbortController();
      const attempt={server,controller,cancelled:false,closed:false,timer:undefined};attempts.push(attempt);
      attempt.closedPromise=new Promise(resolve=>server.once('close',()=>{attempt.closed=true;resolve();}));
      const close=()=>{try{server.close(error=>{if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')attempt.closeError=error;});}catch(error){attempt.closeError=error;}};
      attempt.close=close;
      server.on('listening',()=>{if(attempt.cancelled)close();});
      server.on('error',error=>{attempt.listenError=error;});
      await new Promise((resolve,reject)=>{
        attempt.timer=setTimeout(()=>{attempt.cancelled=true;controller.abort();close();reject(new Error('NATIVE_PORT_PROBE_TIMEOUT'));},listenTimeoutMs);
        const failed=error=>{clearTimeout(attempt.timer);reject(new Error('NATIVE_PORT_UNAVAILABLE',{cause:error}));};
        server.once('error',failed);
        server.listen({host:'127.0.0.1',port,exclusive:true,signal:controller.signal},()=>{clearTimeout(attempt.timer);server.removeListener('error',failed);if(attempt.cancelled){close();return;}resolve();});
      });
    }
  }catch(error){failure=error;}
  const cleanup=await Promise.allSettled(attempts.map(async attempt=>{
    clearTimeout(attempt.timer);attempt.cancelled=true;attempt.controller.abort();attempt.close();
    let timer;
    try{await Promise.race([attempt.closedPromise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('NATIVE_PORT_PROBE_CLOSE_TIMEOUT')),closeTimeoutMs);})]);}
    finally{clearTimeout(timer);}
    assert.equal(attempt.closed,true,'native probe must emit actual close');
    assert.equal(attempt.server.listening,false,'native probe listener must be released');
    if(attempt.closeError)throw new Error('NATIVE_PORT_PROBE_CLOSE_FAILED',{cause:attempt.closeError});
  }));
  const failures=[...(failure?[failure]:[]),...cleanup.filter(result=>result.status==='rejected').map(result=>result.reason)];
  if(failures.length)throw new AggregateError(failures,'NATIVE_PORT_AVAILABILITY_FAILED');
}
