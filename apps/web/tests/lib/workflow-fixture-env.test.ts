import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, expect, it } from "vitest";
import { FULLSTACK_E2E } from "../../e2e/fullstack-smoke-fixture";
import { readFixtureExports } from "../../e2e/fixture-env-reader";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const seed = readFileSync(resolve(root, "../api/scripts/seed-fullstack-smoke.ts"), "utf8");
const required = [...seed.matchAll(/required\("(FULLSTACK_E2E_WORKFLOW_RUNS_[A-Z_]+)"\)/g)].map(match => match[1]!);
let exported: Record<string,string>;
beforeAll(() => { exported=readFixtureExports(execFileSync("pnpm",["exec","tsx","e2e/dump-fixture-env.ts"],{cwd:root,encoding:"utf8",timeout:10000})); });
it("exports every actual workflow seed requirement for the real-model startup path",()=>{
 expect(required.length).toBeGreaterThan(0);
 expect(required.filter(name=>typeof exported[name]!=="string")).toEqual([]);
});
it("gives Playwright and the shared exporter the same values for workflow seed requirements",()=>{
 const path=resolve(root,"playwright.fullstack-smoke.config.ts");const source=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
 const configured:Record<string,unknown>={};
 function visit(node:ts.Node):void {
  if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="fixtureEnv"&&node.initializer&&ts.isObjectLiteralExpression(node.initializer)) {
   for(const p of node.initializer.properties) if(ts.isPropertyAssignment(p)&&(ts.isIdentifier(p.name)||ts.isStringLiteral(p.name))&&ts.isPropertyAccessExpression(p.initializer)&&p.initializer.expression.getText(source)==="FULLSTACK_E2E") configured[p.name.text]=FULLSTACK_E2E[p.initializer.name.text as keyof typeof FULLSTACK_E2E];
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
 expect(required.filter(name=>typeof configured[name]!=="string"||configured[name]!==exported[name])).toEqual([]);
});
