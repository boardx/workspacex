const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),assert=require('assert');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
for(const file of ['conservation-engine.cjs','secondary-conservation-engine-final.cjs']){
 const mod={exports:{}};const ctx={require:n=>n==='pg'?{Client:class{constructor(){throw Error('UNEXPECTED_SQL')}} ,Query:class{}}:require(n),module:mod,process:{env:{}},Buffer,TextDecoder,console};vm.runInNewContext(fs.readFileSync(__dirname+'/'+file,'utf8'),ctx);
 const body={kind:'fixture-only-binding-test'};const p={frozen:true,prepared:true,seed:false,force:false,candidateSha:'a'.repeat(40),sourceInstanceId:'pgm-source',expectedLedgerCount:390,fullSqlChecksums:{'0001.sql':'b'.repeat(64)},pendingSqlChecksums:{'0001.sql':'b'.repeat(64)},migrationLawBindings:{'0001.sql':{reviewed:true,sqlSha256:'b'.repeat(64),body,lawSha256:sha(JSON.stringify(body))}},canonicalSchemaPlanHashes:{}};
 const bind=p=>{const raw=JSON.stringify(p);return mod.exports.bindFrozenPlan({request:{candidateSha:'a'.repeat(40),targetInstanceId:'pgm-clone'},frozenPlanBytes:raw,frozenPlanSha256:sha(raw)})};
 bind(p);for(const mutate of [p=>p.prepared=false,p=>p.candidateSha='c'.repeat(40),p=>p.migrationLawBindings={},p=>p.migrationLawBindings['0001.sql'].body.kind='tampered',p=>p.pendingSqlChecksums['0001.sql']='d'.repeat(64)]){const q=JSON.parse(JSON.stringify(p));mutate(q);assert.throws(()=>bind(q));}
 const raw=JSON.stringify(p);assert.throws(()=>mod.exports.bindFrozenPlan({request:{candidateSha:p.candidateSha,targetInstanceId:'pgm-clone'},frozenPlanBytes:raw,frozenPlanSha256:'0'.repeat(64)}));
 console.log(file+': positive + six negative gates PASS (no SQL)');
}
