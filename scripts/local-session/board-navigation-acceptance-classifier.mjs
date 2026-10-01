import assert from 'node:assert/strict';
export function assertCaseFixtureRemoved(before, after, fixtureId) {
  assert(before.objects.some(object => object.id === fixtureId), 'cleanup fixture must exist before deletion');
  assertReleasedOnce(before, after);
  assert.deepEqual(after.objects, before.objects.filter(object => object.id !== fixtureId), 'case cleanup removes only its fixture and preserves all other objects exactly');
}
export function assertToolbarAnchor(actual, expected) {
  assert(Math.abs(actual.x - expected.x) <= 1 && Math.abs(actual.y - expected.y) <= 1, 'held toolbar matches independently measured live-selection anchor and chrome constraints');
}
export function rotateScenePoint(point, center, degrees) {
  const radians = degrees * Math.PI / 180, dx = point.x - center.x, dy = point.y - center.y;
  return { x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
}

export function rotationEntitySamplePoints(object, center, degrees, pointToScene) {
  const { width: w, height: h } = object.geometry;
  const inside = [[.18 * w, .18 * h], [.82 * w, .18 * h], [.82 * w, .82 * h], [.18 * w, .82 * h], [w / 2, 4], [w - 4, h / 2], [w / 2, h - 4], [4, h / 2]];
  const outside = [[w / 2, -12], [w + 12, h / 2], [w / 2, h + 12], [-12, h / 2]];
  const rotate = ([x, y]) => {
    return rotateScenePoint(pointToScene(object.geometry, { x, y }), center, degrees);
  };
  return { inside: inside.map(rotate), outside: outside.map(rotate) };
}

export function assertRotationEntities(entities) {
  assert.equal(entities.length, 2, 'both independently projected child entities must be measured');
  assert.equal(new Set(entities.map(entity => entity.id)).size, 2);
  for (const entity of entities) {
    assert.equal(entity.insideCounts.length, 8); assert.equal(entity.outsideCounts.length, 4);
    assert(entity.insideCounts.every(count => count >= 7), 'each child renders fill at independently rotated interior and edge samples');
    assert(entity.outsideCounts.every(count => count === 0), 'outer normal background excludes unchanged or oversized child fill');
  }
}

export function assertHeldRotationFrame({ pointerAngle, entities, corners }) {
  assert([-30, -60].includes(pointerAngle), 'expected angle comes from the independent pointer trajectory');
  assertRotationEntities(entities);
  assert.equal(corners.length, 4, 'all four expected rotated control corners are sampled');
  assert(corners.every(corner => corner.bluePixels >= 3), 'selection frame controls match the independently rotated baseline frame');
}

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

export function assertDrawingPixels({ thickness, expectedThickness, centerOffset, endcapAlpha, endcapColorMatches, outsideInk, alpha, expectedAlpha }) {
  assert(Number.isFinite(thickness) && thickness > 0, 'drawing has actual measurable ink');
  assert(Math.abs(thickness - expectedThickness) <= 3, 'actual thickness matches vector width and world transform');
  assert(Number.isFinite(centerOffset) && Math.abs(centerOffset) <= 1.5, 'ink centreline matches canonical world coordinates');
  assert(endcapAlpha >= expectedAlpha * .7, 'round endcap ink extends beyond the endpoint');
  assert(endcapColorMatches, 'endcap must contain the target stroke RGB, not unrelated opaque pixels');
  assert.equal(outsideInk, false, 'outside the cap radius must not contain target ink');
  assert(Math.abs(alpha - expectedAlpha) <= 12, 'stroke alpha is applied once, including at joins');
}
