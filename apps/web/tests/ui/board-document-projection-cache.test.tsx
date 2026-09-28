import {act, renderHook} from '@testing-library/react';
import {expect, it} from 'vitest';
import {createWhiteboardDocument, executeCommands, type WhiteboardObject} from '@repo/whiteboard-core';
import {useWhiteboardDocument} from '@/components/whiteboard/use-whiteboard-document';

const note = (id: string): WhiteboardObject => ({
  id, schemaVersion: 1, kind: 'sticky', geometry: {x: 0, y: 0, width: 180, height: 180, rotation: 0},
  text: id, style: {}, parentId: null, orderKey: id,
});

it('preserves the canonical object projection across non-Yjs editor renders', () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{type: 'create', object: note('a')}], 'seed');
  const view = renderHook(({readOnly}) => useWhiteboardDocument(doc, readOnly), {initialProps: {readOnly: false}});
  const initial = view.result.current.objects;

  view.rerender({readOnly: true});
  expect(view.result.current.objects).toBe(initial);

  act(() => { executeCommands(doc, [{type: 'create', object: note('b')}], 'remote'); });
  expect(view.result.current.objects).not.toBe(initial);
  expect(view.result.current.objects.map(object => object.id)).toEqual(['a', 'b']);
  doc.destroy();
});
