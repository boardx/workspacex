import { claimTriState } from "@repo/contracts/chat-knowledge-graph";
import { KG_OBJECT_KIND_LABEL_ZH, KG_CLAIM_KIND_LABEL_ZH } from "@/lib/knowledge-graph-view";
import { KG_RELATION_LABEL_ZH } from "@/lib/knowledge-graph-recall";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";

export interface GraphPort { id: string; type: "source" | "target"; side: "left" | "right"; offset: number }
export interface GraphItem {
  id: string; label: string; kindLabel: string; tone: "object" | "pending" | "confirmed" | "conflict";
  variant: "object" | "claim"; x: number; y: number; width: number; height: number; ports: GraphPort[];
}
export interface GraphLink { id: string; source: string; target: string; sourceHandle: string; targetHandle: string; label: string; sameColumn: boolean; lane: number }

/** Stable three-column layout. Each edge has its own port; no claim points outwards and back through itself. */
export function layoutKnowledgeGraph(data: Pick<ThreadKnowledge, "objects" | "claims" | "edges">): { items: GraphItem[]; links: GraphLink[] } {
  const claims = data.claims.filter(c => claimTriState(c.status) !== null);
  const rank = new Map(claims.map((c, i) => [c.id, i]));
  const objects = data.objects.filter(o => o.claimCount > 0);
  const weight = (id: string) => {
    const neighbors = data.edges.flatMap(e => e.src.kind === "object" && e.src.id === id && e.dst.kind === "claim" ? [e.dst.id] : e.dst.kind === "object" && e.dst.id === id && e.src.kind === "claim" ? [e.src.id] : []);
    const indices = neighbors.flatMap(id => rank.has(id) ? [rank.get(id)!] : []);
    return indices.length ? indices.reduce((a, b) => a + b, 0) / indices.length : claims.length;
  };
  const ordered = (person: boolean) => objects.filter(o => (o.kind === "person") === person).sort((a, b) => weight(a.id) - weight(b.id) || a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id));
  const people = ordered(true), topics = ordered(false);
  const height = (count: number, nodeHeight: number, gap: number) => Math.max(0, count * nodeHeight + (count - 1) * gap);
  const overallHeight = Math.max(height(claims.length, 128, 48), height(people.length, 96, 48), height(topics.length, 96, 48));
  const items: GraphItem[] = [];
  for (const [column, group] of [[0, people], [832, topics]] as const) {
    const start = (overallHeight - height(group.length, 96, 48)) / 2;
    group.forEach((o, i) => items.push({ id: `object:${o.id}`, label: o.name, kindLabel: KG_OBJECT_KIND_LABEL_ZH[o.kind], tone: "object", variant: "object", x: column, y: start + i * 144, width: 208, height: 96, ports: [] }));
  }
  const start = (overallHeight - height(claims.length, 128, 48)) / 2;
  claims.forEach((c, i) => items.push({ id: `claim:${c.id}`, label: c.statement, kindLabel: KG_CLAIM_KIND_LABEL_ZH[c.kind], tone: claimTriState(c.status)!, variant: "claim", x: 336, y: start + i * 176, width: 352, height: 128, ports: [] }));
  const byId = new Map(items.map(n => [n.id, n]));
  const links: GraphLink[] = [];
  for (const e of [...data.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = `${e.src.kind}:${e.src.id}`, target = `${e.dst.kind}:${e.dst.id}`;
    const a = byId.get(source), b = byId.get(target);
    if (!a || !b) continue;
    const sameColumn = a.x === b.x;
    const sourceSide = sameColumn || a.x < b.x ? "right" : "left";
    const targetSide = sameColumn || a.x > b.x ? "right" : "left";
    const id = `edge:${e.id}`;
    a.ports.push({ id: `${id}:source`, type: "source", side: sourceSide, offset: 0 });
    b.ports.push({ id: `${id}:target`, type: "target", side: targetSide, offset: 0 });
    links.push({ id, source, target, sourceHandle: `${id}:source`, targetHandle: `${id}:target`, label: KG_RELATION_LABEL_ZH[e.relation], sameColumn, lane: links.filter(l => l.sameColumn && byId.get(l.source)?.x === a.x).length });
  }
  for (const item of items) {
    for (const side of ["left", "right"] as const) {
      const ports = item.ports.filter(p => p.side === side);
      ports.sort((a, b) => {
        const otherY = (port: GraphPort) => {
          const link = links.find(e => e.sourceHandle === port.id || e.targetHandle === port.id)!;
          const neighbor = byId.get(link.source === item.id ? link.target : link.source)!;
          return neighbor.y + neighbor.height / 2;
        };
        return otherY(a) - otherY(b) || a.id.localeCompare(b.id);
      });
      ports.forEach((port, i) => { port.offset = 20 + (i + 1) * 60 / (ports.length + 1); });
    }
  }
  return { items, links };
}
