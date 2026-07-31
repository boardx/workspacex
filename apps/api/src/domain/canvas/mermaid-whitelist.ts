/**
 * I-8: the organization-level mermaid rendering whitelist. "白名单只关渲染、不关书写" —
 * a diagram type turned off in `setMermaidWhitelist` still writes and saves fine; it only
 * stops being turned into a rendered diagram object. The Markdown source is never touched.
 *
 * ⚠ On purpose, this file has no function that deletes or rewrites a fenced code block.
 * The contract note under `setMermaidWhitelist` is explicit that the endpoint "不得提供
 * 删除已写的被禁类型代码块的能力" — adding one here would be the missing capability
 * showing up one layer down instead of being genuinely absent. `applyMermaidWhitelist`
 * below only ever READS `markdown`; every exported function in this module returns new
 * values, none of them ever return an edited markdown string.
 *
 * Block extraction reuses `@repo/fabric-markdown`'s `extractMermaidBlocks` — the fence
 * parser that already backs F103's round-trip — rather than a second regex over fenced
 * code blocks. Two parsers for the same `` ```mermaid `` fences is exactly the kind of
 * second-source-of-truth this project keeps re-discovering the hard way.
 *
 * ⚠ Imported from the `/markdown` subpath, not the package root: the root `index.ts`
 * re-exports `mermaid-parser.ts` / `fabric-objects.ts`, which assume a DOM lib (`Element`,
 * `SVGElement`, `document`) that `apps/api`'s `tsconfig.json` does not include. This module
 * only needs the pure string-level fence parser in `markdown.ts`, so importing the subpath
 * directly is what keeps this file typecheckable under a Node-only `lib`.
 */
import { canvas as C } from "@repo/contracts";
import { extractMermaidBlocks, type MermaidBlock } from "@repo/fabric-markdown/markdown";
import type { z } from "zod";

export type MermaidDiagramType = z.infer<typeof C.MermaidDiagramType>;

/**
 * The 12-type closed enum's detection rules: the first non-blank line of a mermaid block's
 * body announces its diagram type in mermaid's own syntax. Order matters only in that each
 * pattern must not falsely match another type's opener; it does not encode a preference.
 */
const DETECTORS: ReadonlyArray<readonly [MermaidDiagramType, RegExp]> = [
  ["flowchart", /^(flowchart|graph)\b/i],
  ["sequenceDiagram", /^sequenceDiagram\b/],
  ["classDiagram", /^classDiagram\b/],
  ["stateDiagram", /^stateDiagram(-v2)?\b/],
  ["erDiagram", /^erDiagram\b/],
  ["journey", /^journey\b/],
  ["gantt", /^gantt\b/],
  ["pie", /^pie\b/],
  ["quadrantChart", /^quadrantChart\b/],
  ["mindmap", /^mindmap\b/],
  ["timeline", /^timeline\b/],
  ["gitGraph", /^gitGraph\b/],
];

/**
 * Which of the 12 whitelist-able types a mermaid block's source declares itself as, or
 * `null` if the first line does not match any of them. `null` is not "ignored" — a block
 * this function cannot classify is not one the whitelist has an opinion about, so it is
 * left out of `ignoredSyntaxCount` rather than silently counted as blocked.
 */
export function detectDiagramType(blockSource: string): MermaidDiagramType | null {
  const firstLine = blockSource
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  for (const [type, pattern] of DETECTORS) {
    if (pattern.test(firstLine)) return type;
  }
  return null;
}

/** One block the whitelist blocked from rendering — named, not just tallied. */
export interface IgnoredMermaidBlock {
  readonly type: MermaidDiagramType;
  readonly rawLineRange: { readonly from: number; readonly to: number };
}

export interface WhitelistApplication {
  /** = `ignoredBlocks.length`, kept as its own field because it is what the contract returns. */
  readonly ignoredSyntaxCount: number;
  /** Which blocks, and where — "点名哪几条被忽略，不只是数量". */
  readonly ignoredBlocks: readonly IgnoredMermaidBlock[];
  /** Types that DID pass the whitelist, in document order — for callers that render. */
  readonly renderableTypes: readonly MermaidDiagramType[];
}

/** 1-based [from, to] line numbers spanning a block's fence, from character offsets. */
function toLineRange(markdown: string, block: MermaidBlock): { from: number; to: number } {
  const from = markdown.slice(0, block.start).split("\n").length;
  const to = markdown.slice(0, block.end).split("\n").length;
  return { from, to };
}

/**
 * The whitelist gate itself: given the current markdown and the org's enabled diagram
 * types, report which mermaid blocks render and which are ignored — WITHOUT modifying
 * `markdown`. Non-mermaid fences (`persona` / `canvas` / `usecase`, from
 * `extractMermaidBlocks`' own fence grammar) are outside this whitelist's scope and are
 * never counted here; they are not "ignored", they were never eligible.
 */
export function applyMermaidWhitelist(
  markdown: string,
  enabled: readonly MermaidDiagramType[],
): WhitelistApplication {
  const enabledSet = new Set(enabled);
  const blocks = extractMermaidBlocks(markdown).filter((b) => b.lang === "mermaid");

  const ignoredBlocks: IgnoredMermaidBlock[] = [];
  const renderableTypes: MermaidDiagramType[] = [];

  for (const block of blocks) {
    const type = detectDiagramType(block.code);
    if (type === null) continue; // not one of the 12 — the whitelist has no opinion on it
    if (enabledSet.has(type)) {
      renderableTypes.push(type);
    } else {
      ignoredBlocks.push({ type, rawLineRange: toLineRange(markdown, block) });
    }
  }

  return {
    ignoredSyntaxCount: ignoredBlocks.length,
    ignoredBlocks,
    renderableTypes,
  };
}
