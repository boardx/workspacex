import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorPlan, classifyCoverage, selectConnectorScenes, classifyPositionCoverage, positionChecks } from './connector-acceptance-plan.mjs';

test('matrix includes each path and all cardinal sides', () => {
  assert.equal(connectorPlan.length,24);
  for (const path of ['straight', 'curve', 'elbow']) {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      assert(connectorPlan.some(item => item.type === path && item.from === side));
    }
  }
});

const complete=()=>connectorPlan.map(scene=>({id:scene.id,ok:true,checks:[...positionChecks,'selected-no-blue-bbox','compact-menu-real-controls',...(scene.type==='straight'?[]:['actual-route-edit'])].map(name=>({name,ok:true}))}));
test('full 24 positions never imply complete C01-C04',()=>{
  const result=classifyPositionCoverage(complete(),{chrome:true,exerciseHandles:true});
  assert.equal(result.fullPositionMatrixPassed,true);assert.equal(result.scope,'position-matrix-only');
  assert.equal(result.coverageComplete,false);assert.equal(result.fullRequiredSuiteComplete,false);
});
test('subsets, missing, duplicate, unknown or missing checks cannot pass full positions',()=>{
  for(const results of [complete().slice(1),[...complete(),complete()[0]],complete().map((r,i)=>i===0?{...r,id:'unknown'}:r),complete().map((r,i)=>i===0?{...r,checks:[]}:r),complete().map((r,i)=>i===0?{...r,ok:false}:r)])assert.equal(classifyPositionCoverage(results).fullPositionMatrixPassed,false);
});
test('missing required flags remains explicitly subset even with full position evidence',()=>{
  for(const flags of [{},{chrome:true},{exerciseHandles:true}])assert.equal(classifyPositionCoverage(complete(),flags).scope,'subset');
});
test('selection uses only the single declared scene matrix and rejects duplicate selections',()=>{
  assert.deepEqual(selectConnectorScenes(),connectorPlan);
  assert.equal(selectConnectorScenes({types:['curve'],directions:['vertical']})[0].id,'curve-vertical');
  for(const input of [{types:['curve','curve']},{directions:['horizontal','horizontal']},{directions:['unknown']},{types:[]},{directions:[]}])assert.throws(()=>selectConnectorScenes(input));
});

test('partial or duplicate results cannot declare complete coverage', () => {
  assert.equal(classifyCoverage([]).coverageComplete, false);
  assert.equal(classifyCoverage(connectorPlan.map(item => ({ id: item.id, ok: true }))).coverageComplete, false);
  assert.equal(classifyCoverage([{ id: connectorPlan[0].id, ok: true }, { id: connectorPlan[0].id, ok: true }]).passed, false);
});
