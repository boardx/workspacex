import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { workbenchBoundaries, verifyWorkbenchBoundaries } from './workbench-permission-boundaries.mjs';
const read=path=>readFileSync(fileURLToPath(new URL(`../${path}`,import.meta.url)),'utf8');
const tables=new Set([...workbenchBoundaries.values()].flatMap(rule=>rule.tables));
tables.add('private_messages');
test('current control paths satisfy all bounded permission premises',()=>assert.deepEqual(verifyWorkbenchBoundaries(read,tables),[]));
for(const [path,rule] of workbenchBoundaries){
  test(`${path}: newly read tenant table is not exempt`,()=>{
    assert.ok(verifyWorkbenchBoundaries(file=>read(file)+(file===path?'\nSELECT * FROM private_messages;':''),tables).some(v=>v.includes('unexpected tenant table')));
  });
  for(const [file,pattern] of rule.checks){
    const target=file??path;
    test(`${path}: removing authority prerequisite ${pattern} fails`,()=>{
      const altered=read(target).replace(new RegExp(pattern.source,'g'),'REMOVED_AUTHORITY_BOUNDARY');
      assert.ok(verifyWorkbenchBoundaries(name=>name===target?altered:read(name),tables).length>0);
    });
  }
}
