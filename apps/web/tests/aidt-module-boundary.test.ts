import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const webRoot = path.resolve(__dirname, "..");
const moduleRoot = "features/aidt";
const publicTargets = new Set([
  "features/aidt/public",
  "features/aidt/entry/home",
  "features/aidt/entry/workspace",
  "features/aidt/entry/board-return",
]);
const facades = new Set(["lib/project-aidt", "lib/aidt-module-config"]);
// Deliberate registration/return adapters only. Shared Chat, recording and Design
// are consumption ports for AIDT and must never acquire a reverse dependency.
const integrationAdapters = new Set([
  "app/aidt/page.tsx",
  "app/aidt/[projectId]/page.tsx",
  "app/studio/board/[boardId]/page.tsx",
  "lib/navigation.ts",
  "lib/project-aidt.ts",
  "lib/aidt-module-config.ts",
  "components/home/home-sections.tsx",
  "components/home/home-work-cards.tsx",
  "components/shell/app-shell.tsx",
  "components/shell/mobile-tabs.tsx",
  "components/projects/projects-screen.tsx",
  "components/project/create-project-form.tsx",
  "components/project/project-breadcrumb.tsx",
]);

type ImportEdge = { from: string; specifier: string; target: string | null };
function resolveImport(from: string, specifier: string): string | null {
  const target = specifier.startsWith("@/") ? specifier.slice(2)
    : specifier.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
      : null;
  return target?.replace(/\.(?:[cm]?js|tsx?)$/, "").replace(/\/index$/, "") ?? null;
}
function importsOf(from: string, source: string): ImportEdge[] {
  const ast = ts.createSourceFile(from, source, ts.ScriptTarget.Latest, true, from.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edges: ImportEdge[] = [];
  const add = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) edges.push({ from, specifier: node.text, target: resolveImport(from, node.text) });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return edges;
}
function violations(edges: readonly ImportEdge[]): string[] {
  return edges.flatMap(({ from, specifier, target }) => {
    if (!target) return [];
    const inside = from.startsWith(`${moduleRoot}/`);
    if (inside && facades.has(target)) return [`${from} -> ${specifier}: module must not depend on its compatibility facade`];
    if (inside || !(target.startsWith(`${moduleRoot}/`) || target === moduleRoot || facades.has(target))) return [];
    if (!integrationAdapters.has(from)) return [`${from} -> ${specifier}: undeclared AIDT integration adapter`];
    if (!facades.has(target) && !publicTargets.has(target)) return [`${from} -> ${specifier}: private AIDT implementation import`];
    return [];
  });
}
function sourceFiles(directory: string): string[] {
  if (!existsSync(path.join(webRoot, directory))) return [];
  return readdirSync(path.join(webRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return entry.isFile() && /\.(?:tsx?|[cm]?jsx?)$/.test(entry.name) ? [relative] : [];
  });
}

it("detects private, relative, dynamic and facade reverse dependencies without treating comments as imports", () => {
  const cases = [
    ["components/chat/existing.tsx", 'import { value } from "@/features/aidt/public";'],
    ["components/rec/existing.tsx", 'const load = () => import("../../features/aidt/entry/home");'],
    ["components/design-loop/existing.tsx", 'export { value } from "@/lib/project-aidt";'],
    ["app/aidt/page.tsx", 'import { View } from "@/features/aidt/components/aidt-home";'],
    ["features/aidt/lib/state.ts", 'import { value } from "@/lib/aidt-module-config";'],
  ] as const;
  for (const [file, source] of cases) expect(violations(importsOf(file, source)), `${file}: ${source}`).not.toEqual([]);
  expect(violations(importsOf("app/aidt/page.tsx", 'const load = () => import("@/features/aidt/entry/home");'))).toEqual([]);
  expect(violations(importsOf("components/chat/existing.tsx", '// import { value } from "@/features/aidt/lib/state";'))).toEqual([]);
});

it("keeps production AIDT consumers on explicit public registration adapters", () => {
  const files = ["app", "components", "lib", "features"].flatMap(sourceFiles);
  // A missing module or accidentally empty scan must fail instead of proving isolation.
  expect(files).toContain("components/chat/copilotkit-v2-panel-view.tsx");
  expect(files).toContain("app/aidt/page.tsx");
  expect(files.some((file) => file.startsWith(`${moduleRoot}/components/`))).toBe(true);
  const edges = files.flatMap((file) => importsOf(file, readFileSync(path.join(webRoot, file), "utf8")));
  expect(edges.some((edge) => edge.target?.startsWith(`${moduleRoot}/`))).toBe(true);
  expect(violations(edges)).toEqual([]);
});

it("keeps the compatibility facades as re-exports with no parallel implementation", () => {
  for (const facade of facades) {
    const filename = `${facade}.ts`;
    const ast = ts.createSourceFile(filename, readFileSync(path.join(webRoot, filename), "utf8"), ts.ScriptTarget.Latest, true);
    expect(ast.statements.length).toBeGreaterThan(0);
    expect(ast.statements.every((node) => ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && resolveImport(filename, node.moduleSpecifier.text) === "features/aidt/public")).toBe(true);
  }
  const leftovers = ["components/project", "lib"].flatMap(sourceFiles).filter((file) => {
    const basename = path.posix.basename(file);
    return /^(?:aidt-|project-aidt|live-aidt)/.test(basename) && !facades.has(file.replace(/\.tsx?$/, ""));
  });
  expect(leftovers).toEqual([]);
});

it("keeps the public domain/config entry free of transitive UI, client SDK and API runtime imports", () => {
  const files = ["app", "components", "lib", "features"].flatMap(sourceFiles);
  const modules = new Map(files.map((file) => [file.replace(/\.(?:[cm]?jsx?|tsx?)$/, "").replace(/\/index$/, ""), file]));
  const pending = ["features/aidt/public"], seen = new Set<string>(), failures: string[] = [];
  expect(modules.has(pending[0]!)).toBe(true);
  while (pending.length) {
    const target = pending.pop()!;
    if (seen.has(target)) continue;
    seen.add(target);
    const filename = modules.get(target);
    if (!filename) continue;
    for (const edge of importsOf(filename, readFileSync(path.join(webRoot, filename), "utf8"))) {
      if (/^(?:react(?:\/|$)|next(?:\/|$)|@copilotkit\/|@ag-ui\/)/.test(edge.specifier) || edge.target && (/^(?:components|app)\//.test(edge.target) || edge.target.startsWith(`${moduleRoot}/components/`) || edge.target.startsWith(`${moduleRoot}/entry/`) || /(?:^|\/)live-[^/]+$/.test(edge.target))) failures.push(`${filename} -> ${edge.specifier}`);
      if (edge.target && modules.has(edge.target)) pending.push(edge.target);
    }
  }
  expect(failures).toEqual([]);
});
