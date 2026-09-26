import { describe, expect, it } from 'vitest';
import {
  BoardCommandPort,
  WhiteboardCommandOrigin,
  beginComposition,
  beginTextInput,
  cancelComposition,
  cancelTextInput,
  commitComposition,
  commitTextInput,
  createWhiteboardDocument,
  createStickyBatchEnvelope,
  nextStickyPlacement,
  parseBulkStickyLines,
  parseThinkingPaste,
  resolveStickyColor,
  readObjects,
  updateTextInput,
  validateTextAttributes,
} from '../src';

const geometry = (x: number, y: number, width = 200, height = 160) => ({ x, y, width, height, rotation: 0 });

describe('thinking input appearance', () => {
  it('resolves all eight presets and canonicalizes safe custom colors', () => {
    expect(['yellow', 'pink', 'blue', 'green', 'purple', 'orange', 'gray', 'white'].map(preset =>
      resolveStickyColor({ preset: preset as 'yellow' }),
    )).toEqual(['#F8D76E', '#F7B7CD', '#BBDDF8', '#BDE5C8', '#D9CDF7', '#F8C38D', '#D8D8D4', '#FFFFFF']);
    expect(resolveStickyColor({ custom: '#ab12ef' })).toBe('#AB12EF');
    expect(() => resolveStickyColor({ custom: 'red' })).toThrow('STICKY_COLOR_INVALID');
    expect(() => resolveStickyColor({ preset: 'missing' as 'yellow' })).toThrow('STICKY_COLOR_INVALID');
  });

  it('applies five text presets and validates overrides, links and bounds', () => {
    expect(['title', 'heading', 'subheading', 'body', 'caption'].map(preset =>
      validateTextAttributes({ preset: preset as 'body' }).fontSize,
    )).toEqual([48, 32, 24, 18, 14]);
    expect(validateTextAttributes({
      preset: 'body', fontSize: 22, bold: true, italic: true, underline: true,
      color: '#00aa11', alignment: 'center', lineHeight: 1.7, list: 'bullet', link: 'https://example.com/a',
    })).toMatchObject({ fontSize: 22, bold: true, italic: true, underline: true, color: '#00AA11', alignment: 'center', lineHeight: 1.7, list: 'bullet' });
    expect(() => validateTextAttributes({ preset: 'other' as 'body' })).toThrow('TEXT_PRESET_INVALID');
    expect(() => validateTextAttributes({ preset: 'body', fontSize: 201 })).toThrow('TEXT_FONT_SIZE_INVALID');
    expect(() => validateTextAttributes({ preset: 'body', link: 'javascript:alert(1)' })).toThrow('TEXT_LINK_INVALID');
    expect(() => validateTextAttributes({ preset: 'body', alignment: 'justify' as 'left' })).toThrow('TEXT_ALIGNMENT_INVALID');
    expect(() => validateTextAttributes({ preset: 'body', list: 'tasks' as 'none' })).toThrow('TEXT_LIST_INVALID');
  });
});

describe('IME-safe text intent', () => {
  it('keeps composition updates draft-only until composition and edit commit', () => {
    const editing = beginTextInput('想');
    const composing = beginComposition(editing);
    const updated = updateTextInput(composing, '想法');
    expect(updated).toMatchObject({ committed: '想', draft: '想法', composition: { before: '想', value: '想法' } });
    const compositionCommitted = commitComposition(updated);
    expect(compositionCommitted).toEqual({ committed: '想', draft: '想法', composition: null });
    expect(commitTextInput(compositionCommitted)).toEqual({ committed: '想法', draft: '想法', composition: null });
  });

  it('cancels a composition or the whole edit without leaking intermediate glyphs', () => {
    const composing = updateTextInput(beginComposition(beginTextInput('A')), 'Aに');
    expect(cancelComposition(composing)).toEqual({ committed: 'A', draft: 'A', composition: null });
    expect(cancelTextInput(commitComposition(composing, 'A日'))).toEqual({ committed: 'A', draft: 'A', composition: null });
    expect(() => commitTextInput(composing)).toThrow('TEXT_COMPOSITION_ACTIVE');
  });
});

describe('Tab continuation placement', () => {
  it('defaults to a 24px row and skips occupied slots deterministically', () => {
    const current = geometry(0, 0);
    expect(nextStickyPlacement(current, [])).toEqual({ direction: 'row', geometry: geometry(224, 0) });
    expect(nextStickyPlacement(current, [geometry(224, 0), geometry(448, 0)])).toEqual({ direction: 'row', geometry: geometry(672, 0) });
  });

  it('continues a nearby column when vertical evidence is stronger', () => {
    const current = geometry(0, 0);
    const result = nextStickyPlacement(current, [geometry(0, 184), geometry(0, 368), geometry(500, 0)]);
    expect(result).toEqual({ direction: 'column', geometry: geometry(0, 552) });
    expect(() => nextStickyPlacement(current, [], -1)).toThrow('STICKY_GAP_INVALID');
  });
});

describe('paste intelligence and batch command boundary', () => {
  it('normalizes CRLF and offers the same non-empty lines as a list or stickies', () => {
    expect(parseThinkingPaste(' Research \r\n\r\nDesign\n Prototype ')).toEqual({
      text: ' Research \n\nDesign\n Prototype ',
      list: ['Research', 'Design', 'Prototype'],
      stickies: ['Research', 'Design', 'Prototype'],
    });
    expect(parseBulkStickyLines('one\ntwo', 2)).toEqual(['one', 'two']);
    expect(() => parseBulkStickyLines('\n  ')).toThrow('BULK_STICKY_EMPTY');
    expect(() => parseBulkStickyLines(Array.from({ length: 101 }, (_, index) => `idea ${index}`).join('\n'))).toThrow('BULK_STICKY_LIMIT_EXCEEDED');
  });

  it('creates one stable caller-keyed envelope and preserves unknown extension metadata', () => {
    const input = {
      boardId: 'board-1', clientId: 'browser-1', gestureId: 'paste-1',
      variant: 'circle' as const, sizing: 'fixed' as const, color: { custom: '#aa00cc' } as const,
      text: { preset: 'caption' as const, alignment: 'center' as const },
      items: [
        { id: 'note-a', text: 'Research', geometry: geometry(10, 20, 180, 180), extensionData: { plugin: { stable: true }, thinkingInput: { future: 'keep' } } },
        { id: 'note-b', text: 'Design', geometry: geometry(214, 20, 180, 180) },
      ],
    };
    const envelope = createStickyBatchEnvelope(input);
    expect(createStickyBatchEnvelope(structuredClone(input))).toEqual(envelope);
    expect(envelope).toMatchObject({ boardId: 'board-1', clientId: 'browser-1', gestureId: 'paste-1' });
    expect(envelope.commands).toHaveLength(2);
    expect(envelope.commands[0]).toMatchObject({
      type: 'create',
      object: {
        id: 'note-a', kind: 'sticky', text: 'Research',
        style: { fill: '#AA00CC', color: '#242424', fontSize: 14 },
        extensionData: {
          plugin: { stable: true },
          thinkingInput: {
            future: 'keep',
            sticky: { variant: 'circle', sizing: 'fixed', color: '#AA00CC' },
            text: { preset: 'caption', alignment: 'center' },
          },
        },
      },
    });

    const doc = createWhiteboardDocument();
    let operationTransactions = 0;
    doc.on('afterTransaction', transaction => {
      if (transaction.origin instanceof WhiteboardCommandOrigin) operationTransactions += 1;
    });
    const accepted = new BoardCommandPort(doc).dispatch(envelope);
    expect(accepted.acceptedObjectIds).toEqual(['note-a', 'note-b']);
    expect(readObjects(doc).map(object => object.id)).toEqual(['note-a', 'note-b']);
    expect(operationTransactions).toBe(1);
    doc.destroy();
  });

  it('rejects invalid or duplicate supplied IDs and batches over 100', () => {
    const base = { boardId: 'b', clientId: 'c', gestureId: 'g' };
    expect(() => createStickyBatchEnvelope({ ...base, items: [] })).toThrow('BULK_STICKY_EMPTY');
    expect(() => createStickyBatchEnvelope({ ...base, items: [
      { id: 'same', text: 'a', geometry: geometry(0, 0) },
      { id: 'same', text: 'b', geometry: geometry(224, 0) },
    ] })).toThrow('STICKY_ID_INVALID');
    expect(() => createStickyBatchEnvelope({ ...base, items: Array.from({ length: 101 }, (_, index) => ({
      id: `n-${index}`, text: `${index}`, geometry: geometry(index * 224, 0),
    })) })).toThrow('BULK_STICKY_LIMIT_EXCEEDED');
  });
});
