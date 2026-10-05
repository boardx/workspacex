import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {modelMetadataPermissionBoundaries as rules} from '../model-metadata-permission-boundaries.mjs';
import {workbenchBoundaries,verifyWorkbenchBoundaries} from '../workbench-permission-boundaries.mjs';
const api=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(api+path,'utf8');
const tables=new Set([...workbenchBoundaries.values()].flatMap(rule=>rule.tables).concat(['chat_messages','artifacts']));
test('all four reviewed metadata boundaries satisfy production checks',()=>{
 assert.equal(rules.size,4);assert.deepEqual(verifyWorkbenchBoundaries(read,tables),[]);
});
for(const [path,rule] of rules){
 test(`${path}: missing implementation invalidates registration`,()=>{
  assert(verifyWorkbenchBoundaries(file=>file===path?'':read(file),tables).some(f=>f.startsWith(path+':')));
 });
 for(const [index,[file,pattern]] of rule.checks.entries())test(`${path}: removing premise ${index} invalidates registration`,()=>{
  const target=file??path,source=read(target),match=source.match(pattern);assert(match,`${target}: premise exists`);
  const altered=source.replace(pattern,'');
  assert(verifyWorkbenchBoundaries(candidate=>candidate===target?altered:read(candidate),tables).some(f=>f.startsWith(path+':')));
 });
 for(const suffix of ['\nSELECT body FROM chat_messages','\nSELECT * FROM artifacts','\ndb.withoutTenant(async()=>{})'])test(`${path}: forbidden expansion ${suffix.trim()} is refused`,()=>{
  assert(verifyWorkbenchBoundaries(file=>read(file)+(file===path?suffix:''),tables).some(f=>f.startsWith(path+':')));
 });
}
