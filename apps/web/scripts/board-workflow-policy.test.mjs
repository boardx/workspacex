import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {boardCiLaneMap, boardCiLanes, canonicalLanesForBoardCiLane} from './board-ci-lane-map.mjs';
import {requiredBoardAcceptanceLanes} from './board-acceptance-matrix.mjs';

const root=resolve(import.meta.dirname,'../../..');
const workflow=readFileSync(resolve(root,'.github/workflows/board-acceptance.yml'),'utf8');
const scripts=JSON.parse(readFileSync(resolve(root,'apps/web/package.json'),'utf8')).scripts;

test('nine isolated workflow jobs cover every canonical Board lane exactly once',()=>{
  assert.equal(boardCiLanes.length,9);
  const canonical=boardCiLanes.flatMap(lane=>canonicalLanesForBoardCiLane(lane));
  assert.equal(canonical.length,12);
  assert.equal(new Set(canonical).size,canonical.length);
  assert.deepEqual([...canonical].sort(),[...requiredBoardAcceptanceLanes].sort());
  assert.deepEqual(boardCiLaneMap.visual,['visual','accessibility']);
  assert.deepEqual(boardCiLaneMap.performance,['performance-1k','performance-5k','performance-10k']);
});

test('workflow invokes every mapped real producer and retains its lane directory',()=>{
  for(const lane of boardCiLanes){
    const script=`ci:board:${lane}`;
    assert.equal(typeof scripts[script],'string',script);
    assert.match(scripts[script],/run-board-ci-lane\.mjs/);
    assert.match(scripts[script],/playwright/);
    assert.equal(workflow.match(new RegExp(`pnpm --filter web run ${script.replaceAll(':','\\:')}`,'g'))?.length,1,script);
    assert.ok(workflow.includes(`path: apps/web/test-results/board-ci/${lane}/`),lane);
  }
  assert.match(workflow,/WHITEBOARD_CAPTURED_VENDOR_MANIFEST: \$\{\{ vars\.WHITEBOARD_CAPTURED_VENDOR_MANIFEST \}\}/);
});

test('unknown workflow lanes fail closed instead of claiming canonical coverage',()=>{
  assert.throws(()=>canonicalLanesForBoardCiLane('fixture-only'),/UNKNOWN_BOARD_CI_LANE/);
});
