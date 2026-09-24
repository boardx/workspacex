import { describe, expect, it } from 'vitest';
import { WhiteboardCommand, WhiteboardObject } from '../src/whiteboard-document';

const geometry = { x: 0, y: 0, width: 100, height: 80, rotation: 0 };
const object = (kind: 'sticky' | 'group' | 'frame') => ({ id: `${kind}-1`, schemaVersion: 1 as const, kind, geometry, text: '', style: {}, parentId: null, orderKey: '' });

describe('semantic whiteboard container contract', () => {
  it('defines group, ungroup and recursive translation commands', () => {
    expect(WhiteboardCommand.parse({ type: 'group', object: object('group'), memberIds: ['sticky-1'] }).type).toBe('group');
    expect(WhiteboardCommand.parse({ type: 'frame', object: object('frame'), memberIds: ['sticky-1'] }).type).toBe('frame');
    expect(WhiteboardCommand.parse({ type: 'ungroup', id: 'group-1' }).type).toBe('ungroup');
    expect(WhiteboardCommand.parse({ type: 'translate', id: 'frame-1', delta: { x: 12, y: -8 } }).type).toBe('translate');
  });

  it('allows only semantic containers to carry the undoable ungrouped state', () => {
    expect(WhiteboardObject.parse({ ...object('frame'), containerState: 'ungrouped' }).containerState).toBe('ungrouped');
    expect(() => WhiteboardObject.parse({ ...object('sticky'), containerState: 'ungrouped' })).toThrow(/Only containers/);
  });
});
