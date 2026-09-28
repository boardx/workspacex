/**
 * WS03 测试夹具：用真实 starter-pack 导入（WS02 路径）装出 Work Skill 目录行，再走真实 HTTP 读写目录。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export interface WorkSkillSpec {
  readonly stableName: string;
  readonly name: string;
  readonly stableId: string;
  readonly domain: string;
  readonly description: string;
  readonly semanticVersion?: string;
  readonly riskClass?: "low" | "medium" | "high";
}

function skillMd(spec: WorkSkillSpec): string {
  return [
    "---",
    `name: ${spec.name}`,
    "metadata:",
    "  work:",
    `    stableId: ${spec.stableId}`,
    `    domain: ${spec.domain}`,
    `    riskClass: ${spec.riskClass ?? "low"}`,
    "    dependencies:",
    "      required: [knowledge.search]",
    "      optional: [web.fetch]",
    "    provenance:",
    "      - repo: anthropics/skills",
    "        path: skills/research/SKILL.md",
    `        commit: ${"a".repeat(40)}`,
    "        license: Apache-2.0",
    "        strategy: adapt",
    "        copied: false",
    "    locales: [zh-CN, en]",
    "    jurisdictions: [CN]",
    "    evalSuiteId: E003",
    "    inputSchema: { type: object }",
    "    outputSchema: { type: object }",
    "---",
    `# ${spec.name}`,
    "",
    spec.description,
    "",
  ].join("\n");
}

export function writeWorkPack(packRoot: string, packId: string, packVersion: string, skills: readonly WorkSkillSpec[]): void {
  const built = skills.map((spec) => {
    const md = skillMd(spec);
    return {
      stableName: spec.stableName,
      name: spec.name,
      semanticVersion: spec.semanticVersion ?? "1.0.0",
      manifest: { description: spec.description, entrypoint: "SKILL.md" },
      files: [{
        path: "SKILL.md",
        mediaType: "text/markdown",
        digest: sha256(Buffer.from(md)),
        contentBase64: Buffer.from(md).toString("base64"),
      }],
    };
  });
  const unsigned = { schemaVersion: 1, packId, packVersion, skills: built };
  const dir = join(packRoot, packId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${packVersion}.json`), JSON.stringify({ ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) }));
}

export async function importWorkPack(base: string, principal: string, packId: string, packVersion: string) {
  const response = await fetch(`${base}/admin/skills/starter-pack-imports`, {
    method: "POST",
    headers: { "x-kernel-test-principal": principal, "content-type": "application/json" },
    body: JSON.stringify({ packId, packVersion, idempotencyKey: randomUUID() }),
  });
  if (response.status !== 201) throw new Error(`import failed: ${response.status} ${await response.text()}`);
  return await response.json() as { skillIds: string[]; versionIds: string[] };
}

export const RESEARCH: WorkSkillSpec = {
  stableName: "research-brief", name: "Research brief", stableId: "S003", domain: "Shared",
  description: "Search knowledge and write a research brief with citations. 调研简报",
};
export const MEETING: WorkSkillSpec = {
  stableName: "meeting-notes", name: "Meeting notes", stableId: "S004", domain: "Sales",
  description: "Summarise a customer meeting into action items.", riskClass: "medium",
};
export const CONTRACT: WorkSkillSpec = {
  stableName: "contract-review", name: "Contract review", stableId: "S005", domain: "Legal",
  description: "Review a contract clause by clause.", riskClass: "high",
};
