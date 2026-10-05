import assert from 'node:assert/strict';
import {auditWithSdkFactory} from '../../.harness/scripts/vm/cn_restore_objects';
const config={bucket:'test-bucket',prefix:'production'};
const tuple={bucket:config.bucket,namespace:config.prefix,key:'org/file.bin',versionId:null as string|null,bytes:0,sha256:'0'.repeat(64)};
let calls=0,cases=0;const factory=async()=>{calls++;throw Error('factory must not be called');};
for(const bad of [{bytes:-1},{bytes:NaN},{bytes:0.5},{sha256:'invalid'},{versionId:''},{versionId:'secret\nvalue'},{key:'../escape'},{bucket:'other'}]){
 await assert.rejects(auditWithSdkFactory(factory,config,{...tuple,...bad}));assert.equal(calls,0);cases++;
}
console.log(JSON.stringify({cases,clientFactoryCalls:calls,cloudExecuted:false}));
