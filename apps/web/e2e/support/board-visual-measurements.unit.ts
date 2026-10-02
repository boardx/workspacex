import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateVisualMeasurement,visualViewports} from './board-visual-measurements';
import {productionCoreToolIds} from './board-visual-policy';
const valid=()=>({canvasAvailable:.9,toolbarCount:1,toolbarHeight:54,controls:productionCoreToolIds.map(name=>({name,width:48,height:48,reachable:true}))});
test('UNIT validates required viewport set and compact measured state without subjective score',()=>{
  assert.deepEqual(visualViewports.map(v=>v.width),[1440,1280,1024]);assert.deepEqual(validateVisualMeasurement(valid()),[]);
});
test('UNIT rejects occlusion, stacked toolbar, small and obstructed targets',()=>{
  assert.ok(validateVisualMeasurement({...valid(),canvasAvailable:.79}).includes('CANVAS_OCCLUDED'));
  assert.ok(validateVisualMeasurement({...valid(),toolbarCount:2}).includes('CONTEXT_TOOLBAR'));
  assert.ok(validateVisualMeasurement({...valid(),toolbarHeight:65}).includes('CONTEXT_TOOLBAR'));
  for(const patch of [{width:43},{height:43},{reachable:false},{width:NaN}])assert.ok(validateVisualMeasurement({...valid(),controls:valid().controls.map((control,index)=>index===0?{...control,...patch}:control)}).includes('CORE_CONTROL_UNREACHABLE'));
});
test('UNIT rejects missing, duplicate and substituted production core controls',()=>{
  const controls=valid().controls;
  for(const invalid of [controls.slice(1),[controls[0]!,controls[0]!,controls[2]!],[{...controls[0]!,name:'board-add-connector'},...controls.slice(1)]])assert.ok(validateVisualMeasurement({...valid(),controls:invalid}).includes('CORE_CONTROL_UNREACHABLE'));
});
