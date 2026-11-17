import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustedNetworkEnvironment, restoreOwnerEnvironment } from '../lib/aidt-checkpoint-network-env.mjs';
import { parseModelEnv } from '../real-model-config.mjs';

// Offline environment fixtures only: no CA file reads, HTTP, model, subprocess or stack.
test('all three caller-supplied trusted CA fields survive byte for byte',()=>{
  const current={SSL_CERT_FILE:'/caller/python.pem',REQUESTS_CA_BUNDLE:'/caller/requests.pem',NODE_EXTRA_CA_CERTS:'/caller/node.pem'};
  for(const [key,value] of Object.entries(current))assert.equal(restoreOwnerEnvironment(current,{})[key],value,key);
});
test('NO_PROXY and no_proxy retain supplied casing, whitespace and explicit empty values without precedence changes',()=>{
  for(const current of [{NO_PROXY:' .internal,localhost,, '},{no_proxy:'.lower.internal'},{NO_PROXY:'upper',no_proxy:'lower'},{NO_PROXY:''},{no_proxy:''}]){
    const result=trustedNetworkEnvironment(current);for(const [key,value] of Object.entries(current))assert.equal(result[key],value);
    for(const key of ['NO_PROXY','no_proxy'])if(!Object.hasOwn(current,key))assert.equal(Object.hasOwn(result,key),false);
  }
});
test('absent exclusions keep existing localhost defaults and all proxy spellings remain independently exact',()=>{
  assert.deepEqual(trustedNetworkEnvironment({}),{NO_PROXY:'127.0.0.1,localhost'});
  const keys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'],current=Object.fromEntries(keys.map((key,index)=>[key,`http://offline-proxy-${index}.invalid:8080`]));
  const result=trustedNetworkEnvironment(current);for(const key of keys)assert.equal(result[key],current[key]);
});
test('model/deployment data cannot override caller networking, inject CA paths or disable TLS',()=>{
  const current={HTTPS_PROXY:'http://trusted.invalid',NO_PROXY:'trusted.internal',SSL_CERT_FILE:'/caller/trust.pem'};
  const supplied={DASHSCOPE_MODEL:'offline-model',HTTPS_PROXY:'http://deployment.invalid',NO_PROXY:'deployment.internal',SSL_CERT_FILE:'/deployment/untrusted.pem',NODE_EXTRA_CA_CERTS:'/deployment/node.pem',NODE_TLS_REJECT_UNAUTHORIZED:'0',PGHOST:'deployment.invalid'};
  const result=restoreOwnerEnvironment(current,supplied);for(const [key,value] of Object.entries(current))assert.equal(result[key],value);
  assert.equal(result.DASHSCOPE_MODEL,'offline-model');for(const key of ['NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','PGHOST'])assert.equal(result[key],undefined);
  const parsed=parseModelEnv('DASHSCOPE_MODEL=offline-model\nHTTPS_PROXY=http://deployment.invalid\nNO_PROXY=deployment.internal\nSSL_CERT_FILE=/deployment/ca.pem\nNODE_TLS_REJECT_UNAUTHORIZED=0\n');assert.deepEqual(parsed.values,{DASHSCOPE_MODEL:'offline-model'});
  const clean=restoreOwnerEnvironment({PATH:'/caller/bin',DATABASE_URL:'private-offline-fixture',NODE_TLS_REJECT_UNAUTHORIZED:'0'},parsed.values);assert.equal(clean.PATH,'/caller/bin');assert.equal(clean.DATABASE_URL,undefined);assert.equal(clean.NODE_TLS_REJECT_UNAUTHORIZED,undefined);
});
test('restore preparation followed by downstream network preparation is idempotent and cannot mutate frozen inputs',()=>{
  const supplied={PATH:'/caller/bin',HTTP_PROXY:'http://upper.invalid',HTTPS_PROXY:'http://upper-tls.invalid',ALL_PROXY:'http://all.invalid',http_proxy:'http://lower.invalid',https_proxy:'http://lower-tls.invalid',all_proxy:'http://lower-all.invalid',NO_PROXY:' .upper.internal,,localhost ',no_proxy:'.lower.internal',SSL_CERT_FILE:'/caller/python.pem',REQUESTS_CA_BUNDLE:'/caller/requests.pem',NODE_EXTRA_CA_CERTS:'/caller/node.pem'};
  const current=Object.freeze({...supplied}),model=Object.freeze({DASHSCOPE_MODEL:'offline-model'});
  const restored=Object.freeze(restoreOwnerEnvironment(current,model));
  const downstream={...restored,...trustedNetworkEnvironment(restored)};
  assert.deepEqual(downstream,{...supplied,...model});assert.deepEqual(downstream,restored);
  assert.deepEqual(current,supplied);assert.deepEqual(model,{DASHSCOPE_MODEL:'offline-model'});
});
