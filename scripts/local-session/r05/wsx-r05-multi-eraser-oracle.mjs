import assert from 'node:assert/strict';

export function assertMultiEraseState(before,after,lockedId) {
 assert.equal(before.objects.length,3);assert.equal(after.objects.length,3);
 assert.equal(after.head.epoch,before.head.epoch);assert.equal(after.head.seq,before.head.seq+1);assert.equal(after.head.role,before.head.role);
 assert.deepEqual(after.objects.map(o=>o.id).sort(),before.objects.map(o=>o.id).sort());
 const locked=before.objects.find(o=>o.id===lockedId);assert(locked?.locked===true);
 assert.deepEqual(after.objects.find(o=>o.id===lockedId),locked,'Locked drawing must remain exactly unchanged');
 for(const object of before.objects.filter(o=>o.id!==lockedId)) {
  assert.equal(object.kind,'drawing');assert(!object.locked);
  const next=after.objects.find(o=>o.id===object.id);assert.equal(next.kind,'drawing');assert(!next.locked);
  const initial=object.extensionData.contentObject.strokes,updated=next.extensionData.contentObject.strokes;
  assert.equal(updated.length,initial.length+1);
  assert.deepEqual(updated.slice(0,-1),initial,'Existing drawing vectors and appearance must remain exact');
  assert.equal(updated.at(-1).tool,'eraser');
 }
}
