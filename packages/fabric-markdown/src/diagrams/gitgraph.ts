/**
 * gitGraph plugin. Commits become 'circle' nodes placed on horizontal branch
 * lanes (x by commit seq, y by branch order), parent links become 'arrow'
 * edges. Serialization replays the commit sequence as branch/checkout/commit/
 * merge commands.
 *
 * Visuals (VISUAL-SPEC §2 gitgraph): one PALETTE hue per branch (commit dots
 * soft fill + incoming edges full hue), a soft lane band + bold branch-name
 * label per lane (locked decorations, drawn under the commits), and merge
 * commits as diamonds.
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode, DiagramEdge, Direction } from '../model';
import { paletteAt, paletteSoftAt } from '../theme';

interface GitCommit {
  id: string;
  message?: string;
  seq?: number;
  type?: number;
  tags?: string[];
  parents?: string[];
  branch?: string;
  customId?: boolean;
}

const DIRECTIONS = new Set(['TD', 'TB', 'LR', 'RL', 'BT']);

function callDb<T>(db: Record<string, unknown>, method: string, fallback: T): T {
  const fn = db[method];
  if (typeof fn === 'function') {
    try {
      const out = (fn as (this: unknown) => T).call(db);
      return out ?? fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function parseGitgraph(ctx: DiagramParseContext): DiagramModel {
  const { db } = ctx;
  let commits = callDb<unknown>(db, 'getCommitsArray', null);
  if (!Array.isArray(commits)) {
    // Older/newer dbs may only expose getCommits as a Map or plain object.
    const raw = callDb<unknown>(db, 'getCommits', {});
    commits = raw instanceof Map ? [...raw.values()] : Object.values(raw ?? {});
  }
  const commitList = (commits as GitCommit[]).filter((c) => c && typeof c.id === 'string');

  const branchObjs = callDb<Array<{ name?: string }>>(db, 'getBranchesAsObjArray', []);
  const branchNames: string[] = [];
  for (const b of branchObjs) {
    if (b?.name && !branchNames.includes(b.name)) branchNames.push(b.name);
  }
  // Fallback: derive lanes from commit order of appearance.
  for (const c of commitList) {
    const br = c.branch ?? 'main';
    if (!branchNames.includes(br)) branchNames.push(br);
  }
  const laneOf = new Map(branchNames.map((n, i) => [n, i]));

  const rawDir = callDb<string>(db, 'getDirection', 'LR');
  const direction = (DIRECTIONS.has(rawDir) ? rawDir : 'LR') as Direction;

  const laneY = (branch: string): number => 90 + (laneOf.get(branch) ?? 0) * 110;
  const commitX = (c: GitCommit, i: number): number =>
    110 + (typeof c.seq === 'number' ? c.seq : i) * 150;

  const nodes: DiagramNode[] = [];

  // Lane decorations first so they render under the commit nodes.
  for (const branch of branchNames) {
    const lane = laneOf.get(branch) ?? 0;
    const xs = commitList.filter((c) => (c.branch ?? 'main') === branch).map(commitX);
    if (xs.length === 0) continue;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    nodes.push({
      id: `lane-${branch}`,
      label: '',
      shape: 'rect',
      x: (minX + maxX) / 2,
      y: laneY(branch),
      width: maxX - minX + 160,
      height: 64,
      data: { role: 'decoration', locked: true, color: paletteSoftAt(lane), stroke: 'transparent' },
    });
    nodes.push({
      id: `lane-${branch}-label`,
      label: branch,
      shape: 'text',
      x: minX - 120,
      y: laneY(branch),
      width: 90,
      height: 24,
      data: { role: 'decoration', locked: true, bold: true },
    });
  }

  // Tag decorations (locked text above the tagged commit) go in the
  // decoration section too, so all decorations precede the commit nodes.
  for (const [i, c] of commitList.entries()) {
    const tags = c.tags ?? [];
    if (tags.length === 0) continue;
    const text = `🏷 ${tags.join(', ')}`;
    nodes.push({
      id: `tag-${c.id}`,
      label: text,
      shape: 'text',
      x: commitX(c, i),
      y: laneY(c.branch ?? 'main') - 36,
      width: Math.max(60, text.length * 8),
      height: 20,
      data: { role: 'decoration', locked: true, fontSize: 11 },
    });
  }

  for (const [i, c] of commitList.entries()) {
    const seq = typeof c.seq === 'number' ? c.seq : i;
    const branch = c.branch ?? 'main';
    const lane = laneOf.get(branch) ?? 0;
    const isMerge = (c.parents?.length ?? 0) > 1;
    // mermaid commitType enum: NORMAL=0 REVERSE=1 HIGHLIGHT=2 (3=merge,
    // 4=cherry-pick are structural, not kept as commitType).
    const commitType = c.type === 1 || c.type === 2 ? c.type : undefined;
    nodes.push({
      id: c.id,
      // REVERSE commits carry a ✕ prefix in the label.
      label: (commitType === 1 ? '✕ ' : '') + c.id.slice(0, 12),
      shape: isMerge ? 'diamond' : 'circle',
      x: commitX(c, i),
      y: laneY(branch),
      width: isMerge ? 40 : 36,
      height: isMerge ? 40 : 36,
      data: {
        branch,
        seq,
        tags: c.tags ?? [],
        message: c.message ?? '',
        isMerge,
        customId: c.customId ?? true,
        // HIGHLIGHT commits get an amber fill instead of the branch hue.
        color: commitType === 2 ? paletteSoftAt(3) : paletteSoftAt(lane),
        ...(commitType !== undefined ? { commitType } : {}),
      },
    });
  }

  const edges: DiagramEdge[] = [];
  let ei = 0;
  for (const c of commitList) {
    // Edges take the hue of the child commit's branch.
    const lane = laneOf.get(c.branch ?? 'main') ?? 0;
    for (const p of c.parents ?? []) {
      if (p) {
        edges.push({
          id: `e${ei++}`,
          source: p,
          target: c.id,
          kind: 'arrow',
          data: { color: paletteAt(lane) },
        });
      }
    }
  }

  return { kind: 'gitgraph', direction, nodes, edges, meta: { branches: branchNames } };
}

export function serializeGitgraph(model: DiagramModel): string {
  const lines: string[] = ['gitGraph'];
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  const parentsOf = new Map<string, string[]>();
  for (const e of model.edges) {
    const ps = parentsOf.get(e.target);
    if (ps) ps.push(e.source);
    else parentsOf.set(e.target, [e.source]);
  }

  // Stable sort by data.seq (array order as fallback when data was lost).
  // Lane decorations (data.role === 'decoration') are visual-only: skip them.
  const ordered = model.nodes
    .filter((n) => n.data?.role !== 'decoration')
    .map((n, i) => ({ n, i, seq: typeof n.data?.seq === 'number' ? (n.data.seq as number) : i }))
    .sort((a, b) => a.seq - b.seq || a.i - b.i);

  let currentBranch = 'main';
  const created = new Set(['main']);

  for (const { n } of ordered) {
    const branch = (n.data?.branch as string | undefined) ?? 'main';
    if (branch !== currentBranch) {
      if (created.has(branch)) {
        lines.push(`    checkout ${branch}`);
      } else {
        // `branch` both creates and checks out.
        lines.push(`    branch ${branch}`);
        created.add(branch);
      }
      currentBranch = branch;
    }

    const parents = parentsOf.get(n.id) ?? [];
    const isMerge = (n.data?.isMerge as boolean | undefined) ?? parents.length > 1;
    if (isMerge && parents.length > 1) {
      const other = parents
        .map((p) => byId.get(p))
        .find((p) => p && ((p.data?.branch as string | undefined) ?? 'main') !== branch);
      if (other) {
        lines.push(`    merge ${(other.data?.branch as string | undefined) ?? 'main'}`);
        continue;
      }
      // Degenerate merge (both parents on this branch): fall through to commit.
    }
    let s = `    commit id: "${n.id}"`;
    const commitType = n.data?.commitType as number | undefined;
    if (commitType === 1) s += ' type: REVERSE';
    else if (commitType === 2) s += ' type: HIGHLIGHT';
    for (const t of (n.data?.tags as string[] | undefined) ?? []) {
      s += ` tag: "${t}"`;
    }
    lines.push(s);
  }

  return lines.join('\n');
}

registerDiagram({
  kind: 'gitgraph',
  detects: ['gitGraph'],
  parse: parseGitgraph,
  serialize: serializeGitgraph,
});
