import { describe, it, expect } from 'vitest';
import { classRelationToEdge } from '../src/mermaid-parser';
import type { DbClassRelation } from '../src/mermaid-parser';

function rel(partial: Partial<DbClassRelation> & { id1: string; id2: string }): DbClassRelation {
  return {
    relation: { type1: 'none', type2: 'none', lineType: 0 },
    ...partial,
  } as DbClassRelation;
}

describe('classRelationToEdge', () => {
  it('maps "Animal <|-- Dog" (marker at id1) to Dog→Animal inheritance', () => {
    const e = classRelationToEdge(
      rel({ id1: 'Animal', id2: 'Dog', relation: { type1: 1, type2: 'none', lineType: 0 }, title: 'inherits' }),
      0,
    );
    expect(e.source).toBe('Dog');
    expect(e.target).toBe('Animal');
    expect(e.kind).toBe('inheritance');
    expect(e.label).toBe('inherits');
  });

  it('maps dotted extension to realization', () => {
    const e = classRelationToEdge(
      rel({ id1: 'IShape', id2: 'Circle', relation: { type1: 1, type2: 'none', lineType: 1 } }),
      0,
    );
    expect(e.kind).toBe('realization');
    expect(e.source).toBe('Circle');
    expect(e.target).toBe('IShape');
  });

  it('maps "Dog *-- Tail" (composition at id1) with swapped ends', () => {
    const e = classRelationToEdge(
      rel({ id1: 'Dog', id2: 'Tail', relation: { type1: 2, type2: 'none', lineType: 0 } }),
      0,
    );
    expect(e.kind).toBe('composition');
    expect(e.source).toBe('Tail');
    expect(e.target).toBe('Dog');
  });

  it('maps arrow at id2 with cardinalities kept on the right ends', () => {
    const e = classRelationToEdge(
      rel({
        id1: 'Dog',
        id2: 'Bone',
        relation: { type1: 'none', type2: 3, lineType: 0 },
        relationTitle1: '1',
        relationTitle2: '*',
      }),
      1,
    );
    expect(e.source).toBe('Dog');
    expect(e.target).toBe('Bone');
    expect(e.kind).toBe('arrow');
    expect(e.sourceLabel).toBe('1');
    expect(e.targetLabel).toBe('*');
  });

  it('maps dotted arrow to dependency and bare line to open', () => {
    expect(
      classRelationToEdge(rel({ id1: 'A', id2: 'B', relation: { type1: 'none', type2: 3, lineType: 1 } }), 0).kind,
    ).toBe('dependency');
    expect(
      classRelationToEdge(rel({ id1: 'A', id2: 'B', relation: { type1: 'none', type2: 'none', lineType: 0 } }), 0).kind,
    ).toBe('open');
  });
});
