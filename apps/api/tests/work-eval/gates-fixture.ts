/**
 * EV03 门脚本测试共用的临时仓库夹具：一个声明 `metadata.work` 的 S003 Skill 包 + 实体文档 + 清单行 +
 * S003 评测套件副本；`evaluate()` 用真实 `harness eval` 运行器产出针对当前版本 digest 的报告。
 * 坏 fixture 由各测试在此基础上改一处得到。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import { runEvalCommand } from "../../src/infrastructure/work-eval/fs-eval-suite";

export const repoRoot = resolve(__dirname, "../../../..");
export const SKILL_DIR = "skills/standard-context/enterprise-search";
const tmpRoots: string[] = [];
export const cleanupFixtures = () => tmpRoots.splice(0).forEach(d => rmSync(d, { recursive: true, force: true }));
export const quiet = { out: () => {}, err: () => {} };

export function s003Manifest(): Record<string, unknown> {
  return {
    stableId: "S003",
    domain: "Shared",
    riskClass: "low",
    dependencies: { required: ["knowledge.search", "knowledge.read", "project.read"], optional: ["knowledge.graph.read"] },
    provenance: [
      {
        repo: "anthropics/knowledge-work-plugins",
        path: "enterprise-search/skills/search/SKILL.md",
        commit: "da38ec1ee89d41e5380e652a97382695003396e7",
        license: "Apache-2.0",
        strategy: "adapt",
        copied: false,
      },
    ],
    locales: ["zh-CN", "en"],
    jurisdictions: ["global"],
    evalSuiteId: "S003",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["question", "mode"],
      properties: {
        question: { type: "string", minLength: 1 },
        mode: { enum: ["evidence", "dedupe"] },
        queryType: { type: "string" },
        projectIds: { type: "array", items: { type: "string" } },
        scopes: { type: "array", items: { enum: ["current-files", "organization-index", "organization-hybrid"] } },
        timeWindow: { type: "object" },
        researchPlanItemRef: { type: "string" },
        maxHitsPerItem: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
    outputSchema: { type: "object" },
  };
}

export function writeSkill(root: string, manifest: unknown, dir = SKILL_DIR, body = "# Enterprise Search\n") {
  mkdirSync(join(root, dir), { recursive: true });
  const fm = stringify({ name: "enterprise-search", version: "1.0.0", description: "S003", metadata: { work: manifest } });
  writeFileSync(join(root, dir, "SKILL.md"), `---\n${fm}---\n${body}`);
}

/** 合规的临时仓库（尚无报告）。 */
export function goodRepo(opts: { manifest?: unknown; suite?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "ev03-"));
  tmpRoots.push(root);
  const req = join(root, "requirements/work-stack-v2");
  mkdirSync(join(req, "skills"), { recursive: true });
  writeFileSync(join(req, "WORK-STACK-320-LIST.md"), "| 状态 | ID | 类型 | 名称 |\n|---|---|---|---|\n| ✅ 通过 | S003 | Skill | Enterprise Search |\n");
  cpSync(join(repoRoot, "requirements/work-stack-v2/skills/S003-enterprise-search.md"), join(req, "skills/S003-enterprise-search.md"));
  writeSkill(root, opts.manifest ?? s003Manifest());
  if (opts.suite !== false) {
    cpSync(join(repoRoot, "evals/work-stack/S003"), join(root, "evals/work-stack/S003"), { recursive: true, filter: src => !src.includes("/reports") });
  }
  return root;
}

/** 跑真实回环评测（含 baseline），产出针对当前版本的报告；返回报告路径。 */
export async function evaluate(root: string, extra: { cases?: string[] } = {}): Promise<string> {
  const r = await runEvalCommand({ repoRoot: root, entity: "S003", baseline: true, ...quiet, ...extra });
  if (!r.reportPath) throw new Error(`eval failed with exit ${r.exitCode}`);
  return r.reportPath;
}

export function editCases(root: string, edit: (cases: Record<string, unknown>[]) => Record<string, unknown>[]) {
  const p = join(root, "evals/work-stack/S003/cases.jsonl");
  const cases = readFileSync(p, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
  writeFileSync(p, `${edit(cases).map(c => JSON.stringify(c)).join("\n")}\n`);
}
