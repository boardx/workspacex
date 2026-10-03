import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {describe,it,expect} from "vitest";
const root=resolve(import.meta.dirname,"../../../..");
const matrix=JSON.parse(readFileSync(resolve(root,"docs/design/platform-organizations-usage/coverage.json"),"utf8")) as {productionEnforcement:boolean;routes:{id:string;status:string;sources:string[];tests:string[];remaining:string[]}[]};
describe("machine-checkable bounded issue coverage",()=>{
 it("incomplete coverage cannot claim production enforcement or lose a required call family",()=>{
  expect(matrix.productionEnforcement).toBe(false);
  expect(matrix.routes.map(row=>row.id)).toEqual(["executor-configured-primary","executor-history-summary","executor-script-regeneration","digital-agent-skills-workflow-python","subtask-text-file","digital-interview-research","embedding-rerank-kg-background","native-audio-image","trial-local-model","terminal-crash-repair"]);
  for(const row of matrix.routes){expect(row.remaining.length,row.id).toBeGreaterThan(0);for(const path of [...row.sources,...row.tests])expect(existsSync(resolve(root,path)),path).toBe(true);if(row.status==="connected-injected")expect(row.tests.length,row.id).toBeGreaterThan(0);}
 });
});
