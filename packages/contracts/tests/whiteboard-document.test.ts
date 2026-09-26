import { describe, expect, it } from 'vitest';
import { WhiteboardCommand, WhiteboardLayoutCommand, WhiteboardLayoutKind, WhiteboardObject } from '../src/whiteboard-document';

describe('whiteboard selection and layout contract', () => {
  it('exposes one strict operation vocabulary for UI, API and Agent callers', () => {
    expect(WhiteboardLayoutKind.options).toEqual([
      'align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom',
      'distribute-horizontal', 'distribute-vertical', 'grid', 'row', 'column', 'tidy-up',
    ]);
    expect(WhiteboardLayoutCommand.parse({
      type: 'arrange-objects', kind: 'grid', objectIds: ['a', 'b'], columns: 2, horizontalGap: 24, verticalGap: 32,
    })).toMatchObject({ kind: 'grid', columns: 2 });
    expect(() => WhiteboardLayoutCommand.parse({ type: 'arrange-objects', kind: 'grid', objectIds: ['a'], columns: 0 })).toThrow();
    expect(() => WhiteboardLayoutCommand.parse({ type: 'arrange-objects', kind: 'grid', objectIds: ['a', 'a'] })).toThrow('unique');
    expect(() => WhiteboardLayoutCommand.parse({ type: 'arrange-objects', kind: 'row', objectIds: ['a', 'b'], gap: Number.NaN })).toThrow();
    expect(() => WhiteboardLayoutCommand.parse({ type: 'arrange-objects', kind: 'row', objectIds: ['a', 'b'], surprise: true })).toThrow();
  });

  it('makes hidden state canonical and keeps state mutations strict', () => {
    const object = { id: 'a', schemaVersion: 1, kind: 'sticky', geometry: { x: 0, y: 0, width: 100, height: 80, rotation: 0 }, text: '', style: {}, parentId: null, orderKey: '', hidden: true };
    expect(WhiteboardObject.parse(object)).toMatchObject({ hidden: true });
    expect(WhiteboardCommand.parse({ type: 'state', id: 'a', hidden: false })).toEqual({ type: 'state', id: 'a', hidden: false });
    expect(() => WhiteboardCommand.parse({ type: 'state', id: 'a', hidden: false, unknown: true })).toThrow();
  });
});
