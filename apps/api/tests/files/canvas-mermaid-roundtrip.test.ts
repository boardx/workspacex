/**
 * F41 -- uc-22-3 V4 (canvas round-trip, executable, D-08): mermaid source is the
 * AUTHORITATIVE, diffable form of a canvas (R7 D-08). Acceptance is a round-trip assertion:
 * create a diagram with 3 node types -> materialize -> read the mermaid source back ->
 * reparse it into a canvas -> materialize again -> the two materialized mermaid sources
 * compare EQUAL, character for character.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { materializeSource } from "../../src/application/files/materialize-source";
import {
  buildLayoutSnapshot,
  parseMermaid,
  renderMermaid,
  type CanvasDiagram,
} from "../../src/domain/files/canvas-mermaid";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory } from "../support/artifact-fakes";

const ORG = toOrgId("org-f41-canvas");

const THREE_NODE_TYPES_DIAGRAM = `flowchart TD
  A[Start]
  B(Middle step)
  C{Decision}
  A --> B
  B --> C
`;

function harness() {
  return { store: new FakeObjectStore(), repo: new FakeArtifactRepository(), ids: new SequentialIdFactory() };
}

async function materializeCanvas(deps: ReturnType<typeof harness>, sourceRef: string, mermaidSource: string) {
  const diagram = parseMermaid(mermaidSource);
  const layout = buildLayoutSnapshot(diagram);
  return materializeSource(deps, {
    orgId: ORG,
    projectId: "proj-1",
    sourceType: "canvas",
    sourceRef,
    actorId: "user-1",
    parts: {
      "diagram.mermaid.md": new TextEncoder().encode(mermaidSource),
      "layout-snapshot.json": layout,
    },
  });
}

describe("F41 canvas mermaid round-trip -- uc-22-3 V4 / D-08", () => {
  it("parses 3 node shapes (rectangle/rounded/diamond) and 2 edges, in source order", () => {
    const diagram = parseMermaid(THREE_NODE_TYPES_DIAGRAM);
    expect(diagram.nodes.map((n) => n.shape)).toEqual(["rectangle", "rounded", "diamond"]);
    expect(diagram.edges).toEqual([
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ]);
  });

  it("renderMermaid(parseMermaid(source)) reproduces the same source, character for character", () => {
    const diagram = parseMermaid(THREE_NODE_TYPES_DIAGRAM);
    const rendered = renderMermaid(diagram);
    expect(rendered).toBe(THREE_NODE_TYPES_DIAGRAM);
  });

  it("D-08: create -> materialize -> read mermaid.md back -> reparse -> materialize again -> both versions' mermaid source are byte-identical", async () => {
    const deps = harness();

    const first = await materializeCanvas(deps, "canvas-1", THREE_NODE_TYPES_DIAGRAM);
    const firstKey = first.materializedKeys.find((k) => k.endsWith("diagram.mermaid.md"))!;
    const firstBytes = (await deps.store.get(firstKey))!;
    const firstSource = new TextDecoder().decode(firstBytes);

    // Re-parse the file this feature actually wrote (not the original in-memory string) --
    // proving the round trip survives having gone through the object store, not just through
    // two in-process function calls.
    const reparsed: CanvasDiagram = parseMermaid(firstSource);
    const rerendered = renderMermaid(reparsed);

    const second = await materializeCanvas(deps, "canvas-1", rerendered);
    const secondKey = second.materializedKeys.find((k) => k.endsWith("diagram.mermaid.md"))!;
    const secondBytes = (await deps.store.get(secondKey))!;
    const secondSource = new TextDecoder().decode(secondBytes);

    expect(secondSource).toBe(firstSource);
    expect(secondSource.length).toBe(firstSource.length);
  });

  it("materializes both required files: mermaid source is authoritative, layout snapshot is auxiliary (A3)", async () => {
    const deps = harness();
    const result = await materializeCanvas(deps, "canvas-2", THREE_NODE_TYPES_DIAGRAM);
    expect([...result.fileNames].sort()).toEqual(["diagram.mermaid.md", "layout-snapshot.json"]);
  });

  it("an unrecognized line is refused rather than silently dropped from the round trip", () => {
    expect(() => parseMermaid("flowchart TD\n  this is not a valid line\n")).toThrow();
  });
});
