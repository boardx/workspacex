import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadPrivateProxyConfig} from './wsx-r08-fault-proxy.mjs';

test('private config rejects symlink files and public parents before reading any manifest',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wsx-r08-private-config-'));
 try{
  await chmod(directory,0o700);const target=join(directory,'target.json'),link=join(directory,'link.json');
  await writeFile(target,'{}',{mode:0o600});await symlink(target,link);
  await assert.rejects(loadPrivateProxyConfig(link),/PRIVATE_OWNED_0600/);
  await chmod(target,0o644);await assert.rejects(loadPrivateProxyConfig(target),/PRIVATE_OWNED_0600/);
  await chmod(target,0o600);await chmod(directory,0o755);
  await assert.rejects(loadPrivateProxyConfig(target),/PARENT_MUST_BE_PRIVATE_OWNED/);
  await chmod(directory,0o700);const alias=`${directory}-alias`;await symlink(directory,alias);
  try{await assert.rejects(loadPrivateProxyConfig(join(alias,'target.json')),/PARENT_MUST_BE_PRIVATE_OWNED/);}finally{await rm(alias);}
 }finally{await rm(directory,{recursive:true});}
});
