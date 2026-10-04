const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function fixture(change={}){
 const browser=Buffer.from("module.exports={run:async()=>{},finishedRun:()=> 'actual-run'};"),producer=Buffer.from("const browser=require('compiled_maintenance_browser');module.exports={browserReceipt:async()=>browser.finishedRun()};"),hash=raw=>crypto.createHash('sha256').update(raw).digest('hex');
 const profile={toolRevision:'a'.repeat(40),filesSha256:{'.harness/scripts/vm/cn-maintenance-browser.cjs':hash(browser),'.harness/scripts/vm/acceptance_receipt_producer.cjs':hash(producer)}};
 const records={'/etc/workspacex-cn/trusted-tool-binding.json':{raw:Buffer.from(JSON.stringify(profile)),mode:0o600},'/usr/local/lib/workspacex-cn/cn-maintenance-browser.cjs':{raw:browser,mode:0o700},'/usr/local/lib/workspacex-cn/acceptance_receipt_producer.cjs':{raw:producer,mode:0o700}};
 Object.assign(records['/usr/local/lib/workspacex-cn/cn-maintenance-browser.cjs'],change);
 const fake={constants:fs.constants,lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o755}),openSync:path=>path,closeSync:()=>{},readFileSync:fd=>records[fd].raw,fstatSync:fd=>({isFile:()=>true,uid:0,gid:0,nlink:1,mode:records[fd].mode,size:records[fd].raw.length,mtimeMs:1,ctimeMs:1,...records[fd].stat})};
 const context={module:{exports:{}},require:id=>id==='node:fs'?fake:require(id)};vm.runInNewContext(fs.readFileSync(__dirname+'/acceptance_source_closure.cjs','utf8'),context);return context.module.exports;
}
test('compiles actual byte-pinned browser references without sibling require fallback',async()=>{const closure=fixture().loadPinnedAcceptanceClosure();assert.equal(await closure.producer.browserReceipt(),'actual-run');});
test('rejects changed bytes, wrong 0700 mode, foreign uid and hardlinks before compile',()=>{for(const override of [{raw:Buffer.from('module.exports={}')},{mode:0o755},{stat:{uid:1000}},{stat:{nlink:2}}])assert.throws(()=>fixture(override).loadPinnedAcceptanceClosure(),/ACCEPTANCE_SOURCE_(HASH|METADATA)/);});
