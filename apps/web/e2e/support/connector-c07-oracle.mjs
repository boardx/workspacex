import {strict as assert} from 'node:assert';
export function restoredConnectorHistory(original,remoteB,objects){
 assert.equal(objects.length,3);assert.equal(new Set(objects.map(object=>object.id)).size,3);
 const a=original.find(object=>object.id==='c07-a'),edge=original.find(object=>object.id==='c07-edge');assert(a&&edge);
 assert.deepEqual(objects.find(object=>object.id==='c07-a'),a);assert.deepEqual(objects.find(object=>object.id==='c07-b'),remoteB);
 const restored=objects.find(object=>object.id==='c07-edge');assert(restored);
 assert.deepEqual({...restored,geometry:edge.geometry},edge);assert.notDeepEqual(restored.geometry,edge.geometry);
}
