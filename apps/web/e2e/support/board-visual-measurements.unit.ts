import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateVisualMeasurement,visualViewports} from './board-visual-measurements';
const valid=()=>({canvasAvailable:.9,toolbarCount:1,toolbarHeight:54,controls:['sticky','shape','draw','connector'].map(name=>({name,width:48,height:48,reachable:true}))});
test('UNIT validates required viewport set and compact measured state without subjective score',()=>{
  assert.deepEqual(visualViewports.map(v=>v.width),[1440,1280,1024]);assert.deepEqual(validateVisualMeasurement(valid()),[]);
});
test('UNIT rejects occlusion, stacked toolbar, small and obstructed targets',()=>{
  assert.ok(validateVisualMeasurement({...valid(),canvasAvailable:.79}).includes('CANVAS_OCCLUDED'));
  assert.ok(validateVisualMeasurement({...valid(),toolbarCount:2}).includes('CONTEXT_TOOLBAR'));
  assert.ok(validateVisualMeasurement({...valid(),toolbarHeight:65}).includes('CONTEXT_TOOLBAR'));
  for(const patch of [{width:43},{height:43},{reachable:false}])assert.ok(validateVisualMeasurement({...valid(),controls:[{...valid().controls[0]!,...patch}]}).includes('CORE_CONTROL_UNREACHABLE'));
});
