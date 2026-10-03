import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertNormalToolRelease} from './wsx-r06-normal-tool-release-oracle.mjs';

const event = type => ({type, isTrusted: true, onTool: true});
const valid = () => ({
  hardwareVerified: false, input: 'browser-protocol-trusted-touch-tap',
  events: ['pointerdown', 'pointerup', 'lostpointercapture', 'click'].map(event),
  armedKind: 'sticky', pickerVisible: true,
  beforeObjects: [], afterObjects: [], beforeHead: {epoch: 1, seq: 3, role: 'owner'}, afterHead: {epoch: 1, seq: 3, role: 'owner'},
  beforeMutationCount: 0, afterMutationCount: 0, invalidFrames: 0,
});

test('normal trusted release keeps tool armed and is not hardware acceptance', () => {
  assert.doesNotThrow(() => assertNormalToolRelease(valid()));
  assert.doesNotThrow(() => assertNormalToolRelease({...valid(), events: ['pointerdown', 'pointerup', 'click'].map(event)}));
});
test('normal release rejects swallowed click, cancellation, wrong target and synthetic proof', () => {
  const value = valid();
  for (const events of [value.events.slice(0, 3), ['pointerdown', 'pointercancel', 'pointerup', 'click'].map(event),
    value.events.map(item => ({...item, isTrusted: false})), value.events.map(item => ({...item, onTool: false})),
    ['pointerdown', 'lostpointercapture', 'pointerup', 'click'].map(event)]) {
    assert.throws(() => assertNormalToolRelease({...value, events}));
  }
  assert.throws(() => assertNormalToolRelease({...value, hardwareVerified: true}));
});
test('normal release rejects disarming, closed picker and unexpected canonical writes', () => {
  for (const change of [{armedKind: null}, {pickerVisible: false}, {afterObjects: [{id: 'unexpected'}]},
    {afterHead: {epoch: 1, seq: 4, role: 'owner'}}, {afterHead: undefined}, {afterObjects: undefined}, {afterMutationCount: 1}, {invalidFrames: 1}]) {
    assert.throws(() => assertNormalToolRelease({...valid(), ...change}));
  }
});
