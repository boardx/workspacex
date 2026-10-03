import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// A normal browser touch release may implicitly release capture before click.
export function assertNormalToolRelease(receipt) {
  assert.equal(receipt.hardwareVerified, false);
  assert.equal(receipt.input, 'browser-protocol-trusted-touch-tap');
  const events = receipt.events;
  assert(Array.isArray(events));
  const down = events.findIndex(event => event.type === 'pointerdown');
  const up = events.findIndex(event => event.type === 'pointerup');
  const click = events.findIndex(event => event.type === 'click');
  assert(down >= 0 && up > down && click > up);
  for (const index of [down, up, click]) {
    assert.equal(events[index].isTrusted, true);
    assert.equal(events[index].onTool, true);
  }
  assert.equal(events.some(event => event.type === 'pointercancel'), false);
  for (const [index, event] of events.entries()) {
    if (event.type === 'lostpointercapture') {
      assert(index > up, 'capture loss before normal release is a different input case');
      assert.equal(event.isTrusted, true);
    }
  }
  assert.equal(receipt.armedKind, 'sticky');
  assert.equal(receipt.pickerVisible, true);
  assert(Array.isArray(receipt.beforeObjects) && Array.isArray(receipt.afterObjects));
  for (const head of [receipt.beforeHead, receipt.afterHead]) {
    assert(head && Number.isInteger(head.epoch) && head.epoch > 0 && Number.isInteger(head.seq) && head.seq >= 0);
    assert(['owner', 'editor'].includes(head.role));
  }
  assert.deepEqual(receipt.afterObjects, receipt.beforeObjects);
  assert.deepEqual(receipt.afterHead, receipt.beforeHead);
  for (const count of [receipt.beforeMutationCount, receipt.afterMutationCount, receipt.invalidFrames]) {
    assert(Number.isInteger(count) && count >= 0);
  }
  assert.equal(receipt.afterMutationCount, receipt.beforeMutationCount);
  assert.equal(receipt.invalidFrames, 0);
}

export async function runNormalToolRelease(ctx) {
  await ctx.choose('square', 'yellow');
  await ctx.expectSynced(ctx.owner);
  const before = await ctx.state(), transport = ctx.readMutationTransport(ctx.owner);
  assert.equal(transport.invalid, 0);
  const box = await ctx.page.getByTestId('board-add-sticky').boundingBox();
  assert(box && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0);
  const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
  assert(await ctx.page.evaluate(point => Boolean(document.elementFromPoint(point.x, point.y)?.closest('[data-testid="board-add-sticky"]')), point));
  const key = `normalRelease${randomUUID().replaceAll('-', '')}`;
  let cdp, primary, receipt;
  try {
    await ctx.page.evaluate(key => {
      const source = document.querySelector('[data-testid="board-add-sticky"]'), events = [];
      const types = ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'click'];
      const listener = event => events.push({type: event.type, isTrusted: event.isTrusted, onTool: source.contains(event.target)});
      for (const type of types) document.addEventListener(type, listener, true);
      window[key] = {events, remove: () => {for (const type of types) document.removeEventListener(type, listener, true);}};
    }, key);
    cdp = await ctx.owner.context.newCDPSession(ctx.page);
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...point, id: 1, radiusX: 1, radiusY: 1, force: 1}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await ctx.page.waitForFunction(key => window[key].events.some(event => event.type === 'click' && event.isTrusted && event.onTool), key, {timeout: 2000});
    await ctx.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await ctx.expectSynced(ctx.owner);
    const after = await ctx.state(), actualTransport = ctx.readMutationTransport(ctx.owner);
    receipt = {
      input: 'browser-protocol-trusted-touch-tap', hardwareVerified: false,
      events: await ctx.page.evaluate(key => window[key].events, key),
      armedKind: await ctx.page.getByTestId('board-add-sticky').getAttribute('aria-pressed') === 'true' ? 'sticky' : null,
      pickerVisible: await ctx.page.getByTestId('board-sticky-square').isVisible(),
      beforeObjects: before.objects, afterObjects: after.objects, beforeHead: before.head, afterHead: after.head,
      beforeMutationCount: transport.mutations, afterMutationCount: actualTransport.mutations, invalidFrames: actualTransport.invalid,
    };
    assertNormalToolRelease(receipt);
    await ctx.shot('S05-normal-trusted-touch-release-keeps-picker');
  } catch (error) {primary = error;}
  const errors = [];
  for (const action of [() => ctx.page.evaluate(key => {window[key]?.remove(); delete window[key];}, key),
    async () => {if (cdp) await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: false});},
    async () => {if (cdp) await cdp.detach();}]) {
    try {await action();} catch (error) {errors.push(error);}
  }
  if (primary || errors.length) throw new AggregateError([...(primary ? [primary] : []), ...errors], 'normal tool touch release execution/cleanup failed');
  return receipt;
}
