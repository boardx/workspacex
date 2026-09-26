import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import {
  BoardCommandPort,
  WhiteboardCommandOrigin,
  createWhiteboardDocument,
  executeCommands,
  readObjects,
  type BoardCommandEnvelope,
} from '../src';

const geometry = { x: 0, y: 0, width: 200, height: 150, rotation: 0 };

describe('canonical Board command port', () => {
  it('accepts one stable gesture envelope once and reuses its result on replay', () => {
    const doc = createWhiteboardDocument();
    executeCommands(doc, [{
      type: 'create',
      object: { id: 'note', schemaVersion: 1, kind: 'sticky', geometry, text: 'idea', style: {}, parentId: null, orderKey: '' },
    }], 'fixture');
    const transactions: Y.Transaction[] = [];
    doc.on('afterTransaction', transaction => {
      if (transaction.origin instanceof WhiteboardCommandOrigin) transactions.push(transaction);
    });
    const port = new BoardCommandPort(doc);
    const envelope: BoardCommandEnvelope = {
      boardId: 'board-1',
      clientId: 'browser-1',
      gestureId: 'drag-1',
      commands: [
        { type: 'geometry', id: 'note', geometry: { ...geometry, x: 80, y: 40 } },
        { type: 'style', id: 'note', style: { fill: '#ffd966' } },
      ],
    };

    const accepted = port.dispatch(envelope);
    const replayed = port.dispatch(structuredClone(envelope));

    expect(replayed).toEqual(accepted);
    expect(accepted.acceptedObjectIds).toEqual(['note']);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.origin).toMatchObject({
      boardId: 'board-1',
      clientId: 'browser-1',
      gestureId: 'drag-1',
      operationId: accepted.operationId,
      transactionId: accepted.transactionId,
    });
    expect(readObjects(doc)[0]?.geometry).toMatchObject({ x: 80, y: 40 });
    expect(readObjects(doc)[0]?.style).toMatchObject({ fill: '#ffd966' });
    doc.destroy();
  });

  it('rejects changed payload reuse and never reports or records a failed command', () => {
    const doc = createWhiteboardDocument();
    const port = new BoardCommandPort(doc);
    const create: BoardCommandEnvelope = {
      boardId: 'board-1',
      clientId: 'browser-1',
      gestureId: 'create-1',
      commands: [{
        type: 'create',
        object: { id: 'note', schemaVersion: 1, kind: 'sticky', geometry, text: 'idea', style: {}, parentId: null, orderKey: '' },
      }],
    };
    const accepted = port.dispatch(create);
    expect(accepted.acceptedObjectIds).toEqual(['note']);

    expect(() => port.dispatch({
      ...create,
      commands: [{ type: 'geometry', id: 'note', geometry: { ...geometry, x: 99 } }],
    })).toThrow('BOARD_COMMAND_INVALID');
    const missing: BoardCommandEnvelope = {
      boardId: 'board-1', clientId: 'browser-1', gestureId: 'missing-1',
      commands: [{ type: 'geometry', id: 'missing', geometry: { ...geometry, x: 10 } }],
    };
    expect(() => port.dispatch(missing)).toThrow('OBJECT_NOT_FOUND');
    executeCommands(doc, [{
      type: 'create',
      object: { id: 'missing', schemaVersion: 1, kind: 'sticky', geometry, text: 'later', style: {}, parentId: null, orderKey: '' },
    }], 'fixture');
    expect(port.dispatch(missing).acceptedObjectIds).toEqual(['missing']);
    expect(readObjects(doc)).toHaveLength(2);
    expect(readObjects(doc).find(object => object.id === 'missing')?.geometry.x).toBe(10);
    doc.destroy();
  });
});
