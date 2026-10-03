import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const source=readFileSync(new URL('../../components/whiteboard/collaborative-thinking-editor.tsx',import.meta.url),'utf8');
// This source gate verifies the actual parent prop in production. It is not a
// substitute for mounting the Dock or the real next-start creation lane.
function productionConnectorProp(){
  const docks=[...source.matchAll(/<BoardBottomDock\s+connectorEnabled(?:=\{([^}]+)\})?\s/g)];
  assert.equal(docks.length,1,'one explicit Connector policy must reach the actual Dock');
  return docks[0][1]===undefined?true:runInNewContext(docks[0][1],{process:{env:{NODE_ENV:'production'}}});
}

test('the approved Connector creation entry is enabled in production',()=>{
  assert.equal(productionConnectorProp(),true);
});

test('opening Connector does not remove the authoritative read-only Dock guard',()=>{
  const dock=source.slice(source.indexOf('<BoardBottomDock'),source.indexOf('/>',source.indexOf('<BoardBottomDock')));
  assert.match(dock,/readOnly=\{mutationBlocked\}/);
});
