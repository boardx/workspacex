import { describe, expect, it } from 'vitest';
import { partitionSmokeProjects } from '../../apps/web/smoke-project-partition';
import { smokeVerdict } from './ci-smoke-verdict.mjs';
const graph = [
  { name: 'seeded' },
  { name: 'board-unified-desktop', dependencies: ['seeded'] },
  { name: 'board-unified-mobile', dependencies: ['board-unified-desktop'] },
  { name: 'official', dependencies: ['seeded'] },
  { name: 'seeded-github-import', dependencies: ['official', 'board-unified-mobile'] },
];
describe('partition policy refuses ambiguous changes and preserves within-runtime state ordering', () => {
  it('leaves the full local graph untouched and preserves seed/import and desktop/mobile order', () => {
    expect(partitionSmokeProjects(graph)).toBe(graph);
    expect(partitionSmokeProjects(graph, 'board')).toEqual([{name:'board-unified-desktop',dependencies:[]},{name:'board-unified-mobile',dependencies:['board-unified-desktop']}]);
    expect(partitionSmokeProjects(graph, 'product').at(-1)?.dependencies).toEqual(['official']);
    expect(graph[1].dependencies).toEqual(['seeded']);
  });
  it('rejects unknown partitions, duplicate/missing projects, missing dependencies and new cross-runtime edges', () => {
    expect(() => partitionSmokeProjects(graph, 'typo')).toThrow('UNKNOWN');
    expect(() => partitionSmokeProjects(graph.slice(1), 'board')).toThrow('MISSING');
    expect(() => partitionSmokeProjects([...graph, graph[0]], 'product')).toThrow('INVALID');
    expect(() => partitionSmokeProjects(graph.filter(p=>p.name!=='board-unified-mobile'), 'product')).toThrow('INVALID');
    expect(() => partitionSmokeProjects([...graph,{name:'future',dependencies:['board-unified-desktop']}], 'product')).toThrow('UNREVIEWED');
  });
  it('Board actual verdict cannot pass missing execution or evidence', () => {
    for (const outcome of ['failure','skipped','cancelled',undefined]) for (const step of ['board','evidence']) {
      const steps = {board:{outcome:'success'},evidence:{outcome:'success'},[step]:{outcome}};
      expect(smokeVerdict({lane:'board-smoke',run:'true',steps})).toBe('failure');
    }
  });
});
