/** Read-only source audit; inherited tokens are not a claim of browser QA. */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "../../docs/design/paper");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const files = ["app", "components", "lib"].flatMap((dir) => walk(join(root, dir)))
  .filter((path) => /\.[jt]sx?$/.test(path));
const sources = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));
const dependencies = new Map();
function resolveImport(path, name) {
  const base = name.startsWith("@/") ? resolve(root, name.slice(2)) :
    name.startsWith(".") ? resolve(dirname(path), name) : null;
  if (base === null) return null;
  return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]
    .find((candidate) => sources.has(candidate)) ?? null;
}
for (const [path, source] of sources) {
  dependencies.set(path, [...source.matchAll(/(?:from\s*|import\s*\()(["'])([^"']+)\1/g)]
    .map((match) => resolveImport(path, match[2])).filter(Boolean));
}
function closure(path) {
  const seen = new Set();
  const pending = [path];
  while (pending.length) {
    const next = pending.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(dependencies.get(next) ?? []));
  }
  return [...seen];
}
const rootLayout = readFileSync(join(root, "app/layout.tsx"), "utf8");
const inheritsRootTokens = rootLayout.includes('"./globals.css"');
const pages = files.filter((path) => path.endsWith("/page.tsx")).sort().map((path) => {
  const dependencies = closure(path);
  const source = relative(root, path);
  const route = "/" + relative(join(root, "app"), dirname(path)).split("/")
    .filter((part) => part && !part.startsWith("(")).join("/");
  return {
    route, source, inheritsRootTokens,
    sharedPrimitives: dependencies.filter((dep) => dep.includes("/components/ui/"))
      .map((dep) => relative(root, dep)).sort(),
    scopedTheme: dependencies.some((dep) => /homeThemeStyle|wx-light|paletteFrom/.test(sources.get(dep))),
    browserQA: "pending individual runtime verification",
  };
});
const patterns = {
  scopedTheme: /homeThemeStyle|wx-light|paletteFromImage/,
  authoredContent: /(?:whiteboard|canvas|diagram|fabric|export-|avatar|chart)/i,
  literalColorCandidate: /(?:#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\()/i,
  utilityPaletteCandidate: /(?:bg|text|border)-(?:slate|gray|zinc|red|blue|green|pink|orange|yellow)-\d/,
};
const exceptions = [...sources].flatMap(([path, source]) => {
  // Candidate scanning is deliberately conservative. No automatic color rewrite.
  const kinds = Object.entries(patterns).filter(([kind, pattern]) => pattern.test(kind === "authoredContent" ? relative(root, path) : source)).map(([kind]) => kind);
  return kinds.length ? [{ source: relative(root, path), kinds,
    disposition: kinds.includes("authoredContent") || kinds.includes("scopedTheme") ?
      "preserve user content or scoped override; inspect representative render" : "inspect candidate before editing" }] : [];
}).sort((a, b) => a.source.localeCompare(b.source));
const summary = {
  routes: pages.length,
  components: files.filter((path) => path.includes("/components/") && path.endsWith(".tsx")).length,
  routesInheritingBaseTokens: pages.filter((page) => page.inheritsRootTokens).length,
  routesReusingSharedPrimitives: pages.filter((page) => page.sharedPrimitives.length > 0).length,
  candidateFiles: exceptions.length,
  exceptionKinds: Object.fromEntries(Object.keys(patterns).map((kind) => [kind,
    exceptions.filter((item) => item.kinds.includes(kind)).length])),
  note: "Static dependency evidence, not full route or interaction acceptance. CSS and dynamic imports may add runtime dependencies.",
};
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "coverage.json"), JSON.stringify({ summary, pages, exceptions }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
