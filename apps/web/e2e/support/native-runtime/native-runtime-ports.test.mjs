import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {EventEmitter} from 'node:events';
import {nativeRuntimePorts,localRuntimePorts,nativeProviderEnvironment,assertNativePortsAvailable} from './native-runtime-ports.mjs';

test('one complete map retains original defaults and derives local and fixture ports',()=>{
  const ports=nativeRuntimePorts();
  assert.equal(Object.keys(ports).length,12);
  assert.deepEqual(localRuntimePorts(ports),{web:36317,api:36320,postgres:36321,deepAgent:36324,sandbox:36325,asr:36326,ollama:36335});
  assert.deepEqual(nativeProviderEnvironment(ports),{WORKSPACEX_MODEL_PROVIDER_PORT:'36327',WORKSPACEX_DEEP_AGENT_PROVIDER_PORT:'36328',WORKSPACEX_LOOPBACK_SANDBOX_PORT:'36329',WORKSPACEX_ASR_PROVIDER_PORT:'36330',WORKSPACEX_MAIL_PROVIDER_PORT:'36331'});
  assert.equal(nativeRuntimePorts({...ports,proxyWebSocket:36322}).proxyWebSocket,36322);
});

test('partial extra duplicate noninteger and unbounded maps reject',()=>{
  const ports=nativeRuntimePorts(),{web,...partial}=ports;
  for(const invalid of [null,[],{},partial,{...ports,redis:40000},{...ports,api:web},{...ports,api:1023},{...ports,api:65536},{...ports,api:NaN},{...ports,api:'3200'},{...ports,proxyWebSocket:web}])assert.throws(()=>nativeRuntimePorts(invalid));
});

test('actual occupied-port rejection closes every previously owned probe listener',async()=>{
  const blockers=[];
  try{
    for(let i=0;i<12;i++){
      const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0},resolve);});blockers.push(server);
    }
    const keys=Object.keys(nativeRuntimePorts()),map=Object.fromEntries(blockers.map((server,index)=>[keys[index],server.address().port]));
    const released=blockers.slice(0,4);await Promise.all(released.map(server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))));
    await assert.rejects(()=>assertNativePortsAvailable(map),/NATIVE_PORT_AVAILABILITY_FAILED/);
    const rebound=[];
    try{for(const server of released){const index=blockers.indexOf(server),probe=createServer();rebound.push(probe);await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen({host:'127.0.0.1',port:map[keys[index]]},resolve);});}}
    finally{await Promise.all(rebound.map(server=>new Promise(resolve=>server.close(resolve))));}
  }finally{await Promise.all(blockers.filter(server=>server.listening).map(server=>new Promise(resolve=>server.close(resolve))));}
});

test('a timed-out pending listen still closes an actual late-bound socket before returning',async()=>{
  const reservation=createServer();await new Promise(resolve=>reservation.listen({host:'127.0.0.1',port:0},resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const ports={...nativeRuntimePorts(),web:port},events=[],actual=createServer(),wrapper=new EventEmitter();
  Object.defineProperty(wrapper,'listening',{get:()=>actual.listening});
  for(const event of ['listening','close','error'])actual.on(event,(...args)=>{events.push(event);wrapper.emit(event,...args);});
  wrapper.listen=({signal,...options},callback)=>{events.push('pending');setTimeout(()=>{events.push('late-bind');actual.listen(options,callback);},30);return wrapper;};
  wrapper.close=callback=>{events.push(actual.listening?'close-bound':'close-pending');if(actual.listening)actual.close(callback);else callback(Object.assign(new Error('not running'),{code:'ERR_SERVER_NOT_RUNNING'}));return wrapper;};
  try{
    await assert.rejects(()=>assertNativePortsAvailable(ports,{serverFactory:()=>wrapper,listenTimeoutMs:5,closeTimeoutMs:500}),/NATIVE_PORT_AVAILABILITY_FAILED/);
    assert(events.indexOf('late-bind')>events.indexOf('close-pending'));assert(events.includes('close-bound'));assert(events.includes('close'));assert.equal(actual.listening,false);
    const rebound=createServer();try{await new Promise((resolve,reject)=>{rebound.once('error',reject);rebound.listen({host:'127.0.0.1',port},resolve);});}finally{await new Promise(resolve=>rebound.close(resolve));}
  }finally{if(actual.listening)await new Promise(resolve=>actual.close(resolve));}
});

test('unconfirmed close is a bounded failure, never a successful availability proof',async()=>{
  const server=new EventEmitter();server.listening=false;server.listen=()=>server;server.close=()=>server;
  await assert.rejects(()=>assertNativePortsAvailable(nativeRuntimePorts(),{serverFactory:()=>server,listenTimeoutMs:5,closeTimeoutMs:5}),error=>error instanceof AggregateError&&error.errors.some(cause=>cause.message==='NATIVE_PORT_PROBE_CLOSE_TIMEOUT'));
});
