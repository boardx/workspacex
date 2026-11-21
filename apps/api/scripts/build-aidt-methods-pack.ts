/** Optional AIDT pack builder. Shipped coordinates come from the opt-in registry;
 * Skill metadata comes from SKILL.md. Existing release bytes are never overwritten.
 * Build: pnpm --filter @repo/api exec tsx scripts/build-aidt-methods-pack.ts
 * Check: same command with --check. Neither command installs or publishes a Skill.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "../src/domain/skill/skill-frontmatter";
import { sha256, verifySkillStarterPack, type SkillStarterPack } from "../src/domain/skill/starter-pack";
import { AIDT_PLATFORM_SKILL_PACK } from "../src/infrastructure/aidt/aidt-module";
const repo = fileURLToPath(new URL("../../..", import.meta.url));
export const AIDT_SKILL_SOURCE_ROOT = join(repo, "skills", "aidt-methods-candidates", AIDT_PLATFORM_SKILL_PACK.packVersion);
export const AIDT_PACK_OUTPUT_ROOT = join(repo, "skills", "starter-packs", AIDT_PLATFORM_SKILL_PACK.packId);
/** Versioned source candidate; constructing bytes never changes installed Skills or thread mounts. */
export const AIDT_METHODS_CANDIDATE = AIDT_PLATFORM_SKILL_PACK;
export const AIDT_METHODS_CANDIDATE_SOURCE_ROOT = join(repo, "skills", "aidt-methods-candidates", AIDT_METHODS_CANDIDATE.packVersion);
export function buildAidtMethodsPack(sourceRoot = AIDT_SKILL_SOURCE_ROOT, coordinate: { packId: string; packVersion: string } = AIDT_PLATFORM_SKILL_PACK): SkillStarterPack {
  if (coordinate.packId !== AIDT_PLATFORM_SKILL_PACK.packId) throw new Error("AIDT methods pack lineage must remain unchanged");
  const entries = readdirSync(sourceRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(sourceRoot, entry.name, "SKILL.md"))).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length !== 6) throw new Error("AIDT pack requires six stage Skills");
  const skills = entries.map(entry => {
    const bytes = readFileSync(join(sourceRoot, entry.name, "SKILL.md"));
    const markdown = bytes.toString("utf8");
    const meta = parseSkillFrontmatter(markdown, entry.name);
    if (meta.semanticVersion !== coordinate.packVersion) throw new Error("AIDT source version differs from the requested release coordinate");
    const title = /^# (.+)$/m.exec(markdown)?.[1];
    if (!title?.trim()) throw new Error("AIDT Skill title missing");
    const files = [{ path: "SKILL.md", mediaType: "text/markdown", digest: sha256(bytes), contentBase64: bytes.toString("base64") }];
    const starter = join(sourceRoot, entry.name, "starter.json");
    if (existsSync(starter)) {
      const copy = readFileSync(starter);
      files.push({ path: "starter.json", mediaType: "application/json", digest: sha256(copy), contentBase64: copy.toString("base64") });
    }
    return { stableName: meta.stableName, name: `AIDT · ${title.trim()}`, semanticVersion: meta.semanticVersion,
      manifest: { capabilityId: meta.capabilityId }, files };
  });
  const unsigned = { schemaVersion: 1 as const, ...coordinate, skills };
  return verifySkillStarterPack({ ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) }, coordinate);
}
export function checkOrWriteAidtMethodsPack(pack: SkillStarterPack, outputRoot = AIDT_PACK_OUTPUT_ROOT, check = false): { path: string; created: boolean } {
  const path = join(outputRoot, `${pack.packVersion}.json`);
  const bytes = JSON.stringify(pack, null, 2) + "\n";
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== bytes) throw new Error("AIDT release exists with different bytes; use a new version, never overwrite a release");
    return { path, created: false };
  }
  if (check) throw new Error("AIDT release missing; build it before --check");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx" });
  return { path, created: true };
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidate = process.argv.includes("--candidate");
  const pack = candidate ? buildAidtMethodsPack(AIDT_METHODS_CANDIDATE_SOURCE_ROOT, AIDT_METHODS_CANDIDATE) : buildAidtMethodsPack();
  const result = checkOrWriteAidtMethodsPack(pack, AIDT_PACK_OUTPUT_ROOT, process.argv.includes("--check"));
  process.stdout.write(`${result.created ? "Created" : "Verified"} ${result.path}\n`);
}
