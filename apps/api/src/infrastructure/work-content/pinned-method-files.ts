import { posix } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";

const MAX_BYTES = 256 * 1024;
const MAX_FILES = 16;
const MAX_DEPTH = 4;
class PinnedMethodReferenceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PinnedMethodReferenceError";
  }
}
type Node = { type: string; url?: string; identifier?: string; children?: Node[] };

/** Only Markdown links (including reference links) to relative .md files are executable references.
 * Images, code, plain paths, fragment-only links and external URLs are not loaded.
 * Referenced files must stay under the published Skill's references/ directory.
 */
function links(body: string): string[] {
  const tree = unified().use(remarkParse).parse(body) as Node;
  const definitions = new Map<string, string>();
  const nodes: Node[] = [];
  const walk = (n: Node) => { nodes.push(n); n.children?.forEach(walk); };
  walk(tree);
  for (const n of nodes) if (n.type === "definition" && n.identifier && n.url) definitions.set(n.identifier, n.url);
  return nodes.flatMap(n => {
    if (n.type === "link" && n.url) return [n.url];
    if (n.type === "linkReference" && n.identifier) {
      const target = definitions.get(n.identifier);
      if (!target) throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_INVALID");
      return [target];
    }
    return [];
  });
}

function methodPath(from: string, target: string): string | null {
  if (target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) return null;
  const path = target.split("#")[0]!;
  if (!/\.md$/i.test(path.split("?")[0]!)) return null;
  if (path.startsWith("/") || /[%\\?\u0000-\u001f]/.test(path)) throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_INVALID");
  const resolved = posix.normalize(posix.join(posix.dirname(from), path));
  if (!resolved.startsWith("references/") || resolved === "references/" || resolved.split("/").includes("..")) {
    throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_INVALID");
  }
  return resolved;
}

/** read is bound by the adapter to one tenant and one immutable published version; no filesystem/network reads. */
export async function loadPinnedMethodFiles(
  root: string, label: string, read: (path: string) => Promise<string | null>,
): Promise<string> {
  let bytes = 0;
  const visited = new Set<string>();
  const active = new Set<string>();
  const parts: { path: string; body: string }[] = [];
  const visit = async (path: string, body: string, depth: number): Promise<void> => {
    if (active.has(path)) throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_CYCLE");
    if (visited.has(path)) return;
    if (depth > MAX_DEPTH || visited.size >= MAX_FILES) throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_LIMIT");
    bytes += Buffer.byteLength(body, "utf8");
    if (bytes > MAX_BYTES) throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_LIMIT");
    visited.add(path); active.add(path); parts.push({ path, body });
    for (const target of links(body)) {
      const next = methodPath(path, target);
      if (!next) continue;
      if (active.has(next)) throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_CYCLE");
      if (visited.has(next)) continue;
      if (depth >= MAX_DEPTH || visited.size >= MAX_FILES) throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_LIMIT");
      const content = await read(next);
      if (!content?.trim()) throw new PinnedMethodReferenceError("CONTENT_SKILL_METHOD_REFERENCE_MISSING");
      await visit(next, content, depth + 1);
    }
    active.delete(path);
  };
  await visit("SKILL.md", root, 0);
  // Preserve legacy single-file instructions byte-for-byte.
  return parts.length === 1 ? root : parts.map(p => `Skill ${label} source: ${p.path}\n${p.body}`).join("\n\n");
}
