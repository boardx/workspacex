import { parseUsecase } from '../../fabric-markdown/src/diagrams/usecase';
import { personaToModel } from '../../fabric-markdown/src/diagrams/persona';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { prepareDiagramImport, type DiagramImportBundle } from '../src/diagram-import';
import { createWhiteboardDocument, executeCommands, readObjects } from '../src/document';

// Reuse the authoritative existing 13-family model fixtures, without loading
// their vitest tests or importing the Fabric runtime into this server-safe core.
const fixtureSource = readFileSync('../../apps/api/tests/canvas/roundtrip-13-mermaid-diagrams.test.ts', 'utf8');
const fixtureProgram = fixtureSource.slice(fixtureSource.indexOf('function node('), fixtureSource.indexOf('\ndescribe('));
const fixtureJs = ts.transpile(fixtureProgram + '\nreturn FIXTURES;', { target: ts.ScriptTarget.ES2022 });
const fixtures = new Function(fixtureJs)() as Array<{ name: string; model: DiagramImportBundle['model'] }>;
// Reuse the two custom-language samples from existing parser tests too.
for (const [file, parse] of [['usecase', parseUsecase], ['persona', personaToModel]] as const) {
  const text = readFileSync(`../fabric-markdown/tests/${file}.test.ts`, 'utf8');
  const sample = text.match(/const SAMPLE = `([\s\S]*?)`;/)?.[1];
  if (!sample) throw new Error(`Missing authoritative ${file} sample`);
  fixtures.push({ name: file, model: parse(sample) });
}
const wrap = (model: DiagramImportBundle['model']): DiagramImportBundle => ({
  model, groupId: 'source-group', nodeIds: Object.fromEntries(model.nodes.map(n => [n.id, n.id])),
  edgeIds: Object.fromEntries(model.edges.map(e => [e.id, e.id])), diagnostics: [],
});
const sourceRef = { threadId: 'thread', messageId: 'message', blockId: 'stable-block', sourceHash: 'hash' };

describe('editable diagram import adapter', () => {
  it.each(fixtures)('imports existing $name fixture atomically and preserves specialized source data', fixture => {
    const result = prepareDiagramImport(wrap(fixture.model), `test_${fixture.name}`, sourceRef);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = createWhiteboardDocument();
    executeCommands(doc, result.commands, {});
    const actual = readObjects(doc);
    expect(actual).toHaveLength(fixture.model.nodes.length + fixture.model.edges.length + 1);
    for (const [i, node] of fixture.model.nodes.entries()) {
      const imported = actual.find(o => o.id === `${result.groupId}_n${i}`)!;
      expect(imported.text).toBe(node.label);
      expect(imported.extensionData?.diagramNode).toEqual(JSON.parse(JSON.stringify(node)));
      expect(imported.extensionData?.sourceRef).toEqual(sourceRef);
      expect(imported.parentId).toBe(result.groupId);
    }
    const group = actual.find(o => o.id === result.groupId)!;
    expect(group.extensionData?.meta).toEqual(fixture.model.meta ?? {});
    const first = result.objects.find(o => o.kind !== 'group' && o.kind !== 'connector');
    if (first) {
      executeCommands(doc, [{ type: 'text', id: first.id, index: 0, deleteCount: 0, insert: 'Edited ' }], {});
      expect(readObjects(doc).find(o => o.id === first.id)?.text).toBe(`Edited ${first.text}`);
    }
  });
  it('remaps independent insert identities and all native connector endpoints', () => {
    const model = fixtures[0].model;
    const a = prepareDiagramImport(wrap(model), 'first', sourceRef), b = prepareDiagramImport(wrap(model), 'second', sourceRef);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.objects.every(o => !b.objects.some(p => p.id === o.id))).toBe(true);
    const ids = new Set(a.objects.map(o => o.id));
    for (const edge of a.objects.filter(o => o.connector)) {
      expect(ids.has(edge.connector!.from)).toBe(true);
      expect(ids.has(edge.connector!.to)).toBe(true);
    }
  });
  it('rejects a whole diagram exceeding 500 commands without exposing a partial batch', () => {
    const model = structuredClone(fixtures[0].model);
    model.nodes = Array.from({ length: 500 }, (_, i) => ({ ...model.nodes[0], id: `n${i}` }));
    model.edges = [];
    const result = prepareDiagramImport(wrap(model), 'large', sourceRef);
    expect(result).toMatchObject({ ok: false, code: 'CAPACITY' });
    expect('commands' in result).toBe(false);
  });
  it('reports specialized representation losses explicitly and rejects dangling edges', () => {
    const special = fixtures.find(f => f.model.kind === 'sequence')!;
    const result = prepareDiagramImport(wrap(special.model), 'sequence', sourceRef);
    expect(result.ok).toBe(true);
    expect(result.losses.some(l => l.code === 'SHAPE_APPROXIMATION')).toBe(true);
    const invalid = structuredClone(fixtures[0].model); invalid.edges[0].source = 'absent';
    expect(prepareDiagramImport(wrap(invalid), 'invalid', sourceRef)).toMatchObject({ ok: false, code: 'INVALID' });
  });
});
