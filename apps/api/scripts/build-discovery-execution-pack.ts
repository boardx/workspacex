import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, verifySkillStarterPack, type SkillStarterPack } from "../src/domain/skill/starter-pack";
import { DISCOVERY_EXECUTION_SKILL_VERSION } from "../src/domain/work-content/discovery-execution-definition";

export const DISCOVERY_SKILL_VERSION = DISCOVERY_EXECUTION_SKILL_VERSION;
export const DISCOVERY_PACK_ID = "work-discovery-execution";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourcePath = "skills/starter-packs/work-product/1.0.0.json";

/** Compile independently authored v2 methods into a new immutable version, retaining old packs.
 * Import/publish/evaluation remain separate operations; packaging grants no Verified status.
 */
export function buildDiscoveryExecutionPack(root = repoRoot): SkillStarterPack {
  const source = verifySkillStarterPack(JSON.parse(readFileSync(resolve(root, sourcePath), "utf8")),
    { packId: "work-product", packVersion: "1.0.0" });
  const v2 = resolve(root, "requirements/work-stack-v2");
  const workflowMatrix = readFileSync(resolve(v2, "WORKFLOW-SKILL-MATRIX.md"), "utf8");
  const row = workflowMatrix.split("\n").find(line => /^\| W027 \|/.test(line));
  if (!row) throw new Error("W027_COMPOSITION_MISSING");
  const ids = [...new Set(row.match(/S\d{3}/g) ?? [])].sort();
  const skills = ids.map(id => {
    const skill = source.skills.find(entry => entry.name === id);
    if (!skill) throw new Error(`W027_SKILL_SOURCE_MISSING:${id}`);
    const review = readFileSync(resolve(v2, `reviews/${id}.review.md`), "utf8");
    if (!/Verdict:\s*(?:\*\*)?PASS\b/i.test(review)) throw new Error(`W027_AUTHOR_REVIEW_NOT_PASS:${id}`);
    const file = readdirSync(resolve(v2, "skills")).find(name => name.startsWith(`${id}-`));
    if (!file) throw new Error(`W027_METHOD_MISSING:${id}`);
    const method = readFileSync(resolve(v2, "skills", file), "utf8");
    const originalRoot = Buffer.from(skill.files.find(entry => entry.path === "SKILL.md")!.contentBase64, "base64").toString("utf8");
    const metadata = /^---\r?\n[\s\S]*?\r?\n---/.exec(originalRoot)?.[0];
    if (!metadata) throw new Error(`W027_SKILL_FRONTMATTER_MISSING:${id}`);
    const entry = metadata.replace(/^version:\s*[^\n]+/m, `version: ${DISCOVERY_SKILL_VERSION}`) +
      `\n\n# ${id} ${skill.stableName}\n\n执行本版本的[独立作者化方法](references/authored-method.md)。\n`;
    const files = [
      { path: "SKILL.md", mediaType: "text/markdown", digest: sha256(entry), contentBase64: Buffer.from(entry).toString("base64") },
      { path: "references/authored-method.md", mediaType: "text/markdown", digest: sha256(method), contentBase64: Buffer.from(method).toString("base64") }]
      .sort((a, b) => a.path.localeCompare(b.path));
    return { ...skill, semanticVersion: DISCOVERY_SKILL_VERSION, files };
  });
  const unsigned = { schemaVersion: 1 as const, packId: DISCOVERY_PACK_ID, packVersion: DISCOVERY_SKILL_VERSION, skills };
  return verifySkillStarterPack({ ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) },
    { packId: DISCOVERY_PACK_ID, packVersion: DISCOVERY_SKILL_VERSION });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pack = buildDiscoveryExecutionPack();
  const path = resolve(repoRoot, `skills/starter-packs/${pack.packId}/${pack.packVersion}.json`);
  if (existsSync(path)) {
    const previous = verifySkillStarterPack(JSON.parse(readFileSync(path, "utf8")),
      { packId: pack.packId, packVersion: pack.packVersion });
    if (previous.packDigest !== pack.packDigest) throw new Error("W027_PACK_VERSION_IMMUTABLE");
  }
  if (process.argv.includes("--check")) {
    if (!existsSync(path)) throw new Error("W027_PACK_NOT_SHIPPED");
  } else {
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
  }
  console.log(`${pack.packId}@${pack.packVersion}: ${pack.skills.length} pinned authored methods, ${pack.packDigest}`);
}
