import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,symlink,rm,chmod,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertPlanBinding,prepareArguments,prepareEnvironment} from './r08-native-adapter.mjs';

test('R08 metadata selects the complete four-case matrix',async()=>{
 const suite=JSON.parse(await readFile(new URL('./r08-native-suite.json',import.meta.url),'utf8'));
 assert.equal(suite.files.length*suite.projects.length,4);
 assert.equal(new Set(suite.files).size,2);
 assert.deepEqual(suite.projects.map(project=>project.viewport.width),[1440,390]);
});
test('proxy prepare arguments reject unsafe ports',()=>{
 assert.deepEqual(prepareArguments({proxyPort:36336}),['--proxy-ws-port','36336']);
 for(const proxyPort of [undefined,'36336',0,1023,65536,1.5])assert.throws(()=>prepareArguments({proxyPort}));
});
test('prepared plan is bound to the actual ready runtime, never synthesized',()=>{
 const plan={prepared:true,root:'/tmp/r08',head:'abc',ports:{api:36320},proxyWebSocketPort:36336};
 const manifest={ready:true,webRoot:'/tmp/r08',apiRoot:'/tmp/r08',head:'abc',apiBase:'http://127.0.0.1:36320',proxyWebSocketUrl:'ws://127.0.0.1:36336'};
 assertPlanBinding(plan,manifest,'/tmp/r08');
 for(const change of [{ready:false},{head:'wrong'},{apiBase:'http://127.0.0.1:36321'},{proxyWebSocketUrl:'ws://127.0.0.1:36337'},{apiRoot:'/tmp/other'}])assert.throws(()=>assertPlanBinding(plan,{...manifest,...change},'/tmp/r08'));
 assert.throws(()=>assertPlanBinding({...plan,prepared:false},manifest,'/tmp/r08'));
});
test('private configuration rejects public directories and symlink plans before authority import',async()=>{
 const data=await realpath(await mkdtemp(join(tmpdir(),'r08-adapter-negative-')));
 try{
  const privateRoot=join(data,'r08'),planPath=join(data,'native-runtime-plan.json'),manifestPath=join(data,'runtime-manifest.json');
  await mkdir(privateRoot,{mode:0o700});
  await writeFile(planPath,'{}',{mode:0o600,flag:'wx'});
  await writeFile(manifestPath,'{}',{mode:0o600,flag:'wx'});
  await chmod(privateRoot,0o755);
  await assert.rejects(prepareEnvironment({root:data,privateRoot,planPath,manifestPath}),/PRIVATE_R08_PATH_REQUIRED/);
  await chmod(privateRoot,0o700);
  const link=join(data,'linked-plan.json');await symlink(planPath,link);
  await assert.rejects(prepareEnvironment({root:data,privateRoot,planPath:link,manifestPath}),/PRIVATE_R08_PATH_REQUIRED/);
 }finally{await rm(data,{recursive:true,force:true});}
});
