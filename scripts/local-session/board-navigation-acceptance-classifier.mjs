import assert from 'node:assert/strict';

export function assertHeldUncommitted(before, held) {
  assert.equal(held.head.epoch, before.head.epoch, 'held gesture changes epoch');
  assert.equal(held.head.seq, before.head.seq, 'held gesture must not submit an operation');
  assert.deepEqual(held.objects, before.objects, 'held preview changes canonical objects');
}

export function assertReleasedOnce(before, after) {
  assert.equal(after.head.epoch, before.head.epoch, 'release changes epoch');
  assert.equal(after.head.seq, before.head.seq + 1, 'release must commit exactly one transaction');
  assert.notDeepEqual(after.objects, before.objects, 'release must persist the changed objects');
}

export function assertCancelled(before, after) {
  assertHeldUncommitted(before, after);
}

export function assertEraseTransaction(before, after, undone, expectedIds) {
  assertReleasedOnce(before, after);
  assert(expectedIds.length >= 2, 'multi-object erase requires at least two drawing fixtures');
  for (const id of expectedIds) {
    const previous = before.objects.find(object => object.id === id), next = after.objects.find(object => object.id === id);
    assert.equal(previous?.kind, 'drawing');
    assert(next, 'vector eraser must preserve drawing identity');
    const oldContent = previous.extensionData.contentObject, content = next.extensionData.contentObject;
    assert.equal(content.strokes.length, oldContent.strokes.length + 1, 'erase appends exactly one mask per hit drawing');
    assert.deepEqual(content.strokes.slice(0, -1), oldContent.strokes, 'erase preserves original vector strokes');
    const mask = content.strokes.at(-1);
    assert.equal(mask.tool, 'eraser', 'appended stroke must be an eraser mask');
    assert.deepEqual([...mask.erases].sort(), oldContent.strokes.filter(stroke => stroke.tool !== 'eraser').map(stroke => stroke.id).sort(), 'mask references actual ink stroke identities');
    assert(mask.points.length >= 2 && mask.width > 0, 'mask contains captured path and positive width');
    const unchanged = object => { const { geometry, extensionData, ...rest } = object; return { ...rest, extensionData: { ...extensionData, contentObject: { ...extensionData.contentObject, strokes: [] } } }; };
    assert.deepEqual(unchanged(next), unchanged(previous), 'erase changes only geometry and drawing masks');
  }
  assert.deepEqual(after.objects.filter(object => !expectedIds.includes(object.id)), before.objects.filter(object => !expectedIds.includes(object.id)), 'eraser changes non-target or locked objects');
  assert.deepEqual(undone.objects, before.objects, 'single undo must restore the entire erase transaction');
}
