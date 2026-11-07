const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('external process proof independently rejects an existing owned dist',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chat-standard-proof-')),scope='a'.repeat(64),logs=path.join(root,'apps/web/e2e/__evidence__/chat-refresh-diagnostics'),dist=path.join(root,'apps/web/.next-chat-refresh-'+scope.slice(0,16));
 try{fs.mkdirSync(logs,{recursive:true});fs.writeFileSync(path.join(logs,'production-build.jsonl'),JSON.stringify({event:'comparison-start',scopeHash:scope})+'\n'+JSON.stringify({event:'owned-start',scopeHash:scope,ownerPid:2147483647,pgid:2147483647})+'\n');
  fs.mkdirSync(dist);const cli=path.resolve(__dirname,'../e2e/support/chat-refresh-owned-process.cjs');let result=spawnSync(process.execPath,[cli],{cwd:root,encoding:'utf8'});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).distAbsent,false);
  fs.rmdirSync(dist);result=spawnSync(process.execPath,[cli],{cwd:root,encoding:'utf8'});assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).distAbsent,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
