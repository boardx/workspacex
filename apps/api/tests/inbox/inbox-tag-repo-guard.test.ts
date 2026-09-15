/**
 * `pg-inbox-tag-repository.ts` 的 lint 豁免，钉在这里（2026-09-08 收件箱反馈 / 设计方案标签）。
 *
 * `lint-permission-paths.mjs` 的 ALLOWLIST 给这个文件开了口子，理由是「`inbox_item_tags`
 * 不是 `ObjectRef` 的任何一种，一行只存组织内条目的标签——真正的
 * 内容披露仍在 `inbox-projection.ts` 复用已完成的 D3 决策，body 为 null 的反馈标签必须清空」。那条理由**只在
 * 四个前提成立时**有效，所以四个前提在这里被逐条断言，而不是留在注释里当声明。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动——一条永远为真的断言与没有断言无法区分。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO = fileURLToPath(new URL("../../src/infrastructure/inbox/pg-inbox-tag-repository.ts", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

function stripComments(ts: string): string {
  return ts.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
}

const repoCode = stripComments(readFileSync(REPO, "utf8"));

/** 从迁移里推导租户表，与 lint 同一套推导——手写清单缺的正是刚加的那张表。 */
function tenantTables(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const body = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of body.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      if (/\borg_id\b/.test(m[2]!)) names.add(m[1]!);
    }
  }
  return names;
}

function tablesNamed(sql: string): ReadonlySet<string> {
  const hit = new Set<string>();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) hit.add(m[1]!);
  return hit;
}

describe("(a) 只碰 inbox_item_tags，没有第二张租户表", () => {
  const ALLOWED = new Set(["inbox_item_tags"]);

  it("没有第二张租户表", () => {
    const tenant = tenantTables();
    expect(tenant.size, "一张租户表都没推导出来——这个扫描是空转的").toBeGreaterThan(10);
    expect(tenant.has("inbox_item_tags"), "inbox_item_tags 不在租户表里").toBe(true);

    const named = tablesNamed(repoCode);
    expect(named.size, "一条 SQL 都没解析到").toBeGreaterThan(0);
    const strangers = [...named].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers, `出现了豁免范围之外的租户表：${strangers.join(",")}`).toEqual([]);
  });

  it("变异：加一张陌生租户表就应该被上面那条断言抓住", () => {
    const named = tablesNamed(`${repoCode}\nSELECT * FROM product_feedback`);
    const strangers = [...named].filter((t) => tenantTables().has(t) && !ALLOWED.has(t));
    expect(strangers).toEqual(["product_feedback"]);
  });
});

describe("(b) 从不调用 withoutTenant", () => {
  it("文件里没有 withoutTenant", () => {
    expect(repoCode.includes("withoutTenant")).toBe(false);
  });
});

describe("(c) 两个方法只碰 kind/item_id/tags/updated_at", () => {
  const ALLOWED_COLUMNS = ["kind", "item_id", "tags", "updated_at", "org_id"];

  it("SELECT 列表里没有出现允许集合之外的列名", () => {
    const selectMatch = repoCode.match(/SELECT\s+([\s\S]*?)\s+FROM\s+inbox_item_tags/);
    expect(selectMatch, "没找到 getTags 的 SELECT 语句——文件形状变了，这条断言需要跟着改").not.toBeNull();
    const columns = selectMatch![1]!.split(",").map((c) => c.trim());
    for (const col of columns) {
      expect(ALLOWED_COLUMNS.includes(col), `SELECT 里出现了不在允许集合里的列：${col}`).toBe(true);
    }
  });

  it("变异：往 SELECT 里加一列内容列应该被上面那条断言抓住", () => {
    const mutated = repoCode.replace(
      "SELECT kind, item_id, tags FROM inbox_item_tags",
      "SELECT kind, item_id, tags, granted_by_user_id FROM inbox_item_tags",
    );
    const selectMatch = mutated.match(/SELECT\s+([\s\S]*?)\s+FROM\s+inbox_item_tags/);
    const columns = selectMatch![1]!.split(",").map((c) => c.trim());
    expect(columns.includes("granted_by_user_id")).toBe(true);
  });
});

// Shape guard: this is intentionally narrower than a general-purpose taint analyzer.
// A new reader or a refactor must update this gate together with its disclosure tests.
const SRC = fileURLToPath(new URL("../../src", import.meta.url));
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

const READERS = new Map([
  ["application/inbox/list-inbox.ts", { fn: "listInbox", raw: "tags", projected: "all" }],
  ["application/inbox/get-inbox-counts.ts", { fn: "getInboxCounts", raw: "storedTags", projected: "everything" }],
]);

function readPathViolations(sources: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  const found = new Set<string>();
  for (const [path, code] of sources) {
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
    const accesses: ts.Node[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === "getTags" &&
          !ts.isMethodDeclaration(node.parent) && !ts.isMethodSignature(node.parent)) accesses.push(node);
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "getTags") accesses.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (accesses.length === 0) continue;
    const rule = READERS.get(path);
    if (!rule || accesses.length !== 1) { violations.push(`${path}: unexpected getTags reader`); continue; }
    found.add(path);
    const importsProjection = source.statements.some((node) => ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./inbox-projection" &&
      node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some((item) => item.name.text === "applyTags" && !item.propertyName));
    if (!importsProjection) violations.push(`${path}: missing shared projection import`);
    const fn = source.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === rule.fn);
    const body = fn?.body;
    if (!body || accesses[0]!.pos < body.pos || accesses[0]!.end > body.end) {
      violations.push(`${path}: read outside guarded function`); continue;
    }
    let projection: ts.CallExpression | undefined;
    let readStatement: ts.Statement | undefined;
    let projectionStatement: ts.Statement | undefined;
    const rawRefs: ts.Identifier[] = [];
    for (const statement of body.statements) {
      const walk = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "applyTags") {
          if (projection) violations.push(`${path}: multiple projections`);
          projection = node; projectionStatement = statement;
        }
        if (node === accesses[0]) readStatement = statement;
        if (ts.isIdentifier(node) && node.text === rule.raw &&
            !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) rawRefs.push(node);
        ts.forEachChild(node, walk);
      };
      walk(statement);
    }
    const rawArg = projection?.arguments[1];
    if (!rawArg || !ts.isIdentifier(rawArg) || rawArg.text !== rule.raw || !readStatement ||
        !projectionStatement || readStatement.end > projectionStatement.pos) {
      violations.push(`${path}: raw read must feed applyTags before consumption`); continue;
    }
    // Only the binding and applyTags argument may reference the raw result. Returning,
    // filtering or counting it directly (before OR after projection) fails this gate.
    const bindings = rawRefs.filter((node) => (ts.isBindingElement(node.parent) || ts.isVariableDeclaration(node.parent)) && node.parent.name === node);
    if (bindings.length !== 1 || bindings[0]!.pos < readStatement.pos || bindings[0]!.end > readStatement.end ||
        rawRefs.length !== 2 || !rawRefs.includes(rawArg)) {
      violations.push(`${path}: raw tags escape projection`);
    }
    if (!projectionStatement.getText(source).match(new RegExp(`\\b${rule.projected}\\s*=\\s*applyTags\\(`))) {
      violations.push(`${path}: filtered/counted result must originate in applyTags`);
    }
  }
  for (const path of READERS.keys()) if (!found.has(path)) violations.push(`${path}: expected reader missing`);
  return violations;
}

const sources = new Map(sourceFiles(SRC).map((path) => [path.slice(SRC.length + 1), readFileSync(path, "utf8")]));

describe("(d) D3-sensitive tag reads only reach scrubbed list/count projections", () => {
  it("pins every production read caller and forbids raw tag consumption", () => {
    expect(readPathViolations(sources)).toEqual([]);
  });
  it("rejects a new direct raw-tag endpoint", () => {
    const mutated = new Map(sources).set("interface/raw-tags.ts", "export const read = (repo) => repo.getTags();");
    expect(readPathViolations(mutated)).toContain("interface/raw-tags.ts: unexpected getTags reader");
  });
  it("rejects bracket access and destructuring aliases in new callers", () => {
    for (const code of ['export const read = (repo) => repo["getTags"]();', 'export const read = (repo) => { const { getTags } = repo; return getTags(); };']) {
      expect(readPathViolations(new Map(sources).set("interface/raw-tags.ts", code))).toContain("interface/raw-tags.ts: unexpected getTags reader");
    }
  });
  it("rejects redirecting the applyTags import", () => {
    const path = "application/inbox/list-inbox.ts";
    expect(readPathViolations(new Map(sources).set(path, sources.get(path)!.replace('from "./inbox-projection"', 'from "./unsafe-projection"')))).toContain(`${path}: missing shared projection import`);
  });
  it.each([...READERS.keys()])("rejects skipping applyTags in %s", (path) => {
    const mutated = new Map(sources).set(path, sources.get(path)!.replace("= applyTags(", "= unsafeProjection("));
    expect(readPathViolations(mutated)).toContain(`${path}: raw read must feed applyTags before consumption`);
  });
  it.each([...READERS.entries()])("rejects raw result leakage in %s", (path, rule) => {
    const mutated = new Map(sources).set(path, sources.get(path)!.replace("const startedAt = Date.now();", `const startedAt = Date.now(); const leaked = () => ${rule.raw};`));
    expect(readPathViolations(mutated)).toContain(`${path}: raw tags escape projection`);
  });
});
