/**
 * Work Skill 源目录 → 导入后 `skill_versions.content_digest` 的**同一算法**（EV05 回写 digest 口径）。
 *
 * 导入（WS02）落库的 `content_digest` = `skillContentDigest(pack 条目)`；pack 条目由
 * `scripts/work-content-pack.ts` 从 `skills/<line>/<skill>/` 构建（manifest = { capabilityId, work }，
 * files = 包内全部文件的 { path, digest, mediaType }）。`harness eval` / 门脚本若另算一份 digest，
 * 回写 `WorkGateStatus.subjectVersionDigest` 会被 EV04 判 `WORK_EVAL_DIGEST_MISMATCH`——所以这里
 * 从源文件还原同一条目后调用同一个 `skillContentDigest`，不另写算法。
 */
import { parseSkillFrontmatter } from "./skill-frontmatter";
import { sha256, skillContentDigest, type SkillStarterPack } from "./starter-pack";
import { parseWorkSkillManifest } from "./work-skill-manifest";

/** starter-pack 文件的 mediaType（构建脚本与 digest 还原共用）。 */
export function starterPackMediaType(path: string): string {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/**
 * @param files 包内全部文件（posix 相对路径 + 字节），须含 `SKILL.md`。
 * @returns 与导入后 `content_digest` 相等的 hex；非合法 Work Skill 包（无/坏 frontmatter 或 metadata.work）→ null。
 */
export function workSkillSourceContentDigest(files: readonly { readonly path: string; readonly bytes: Buffer }[]): string | null {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (!skillMd) return null;
  const markdown = skillMd.bytes.toString("utf8");
  let capabilityId: string;
  try {
    capabilityId = parseSkillFrontmatter(markdown).capabilityId;
  } catch {
    return null;
  }
  const work = parseWorkSkillManifest("SKILL.md", markdown);
  if (work.kind !== "valid") return null;
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const entry: SkillStarterPack["skills"][number] = {
    stableName: "",
    name: "",
    semanticVersion: "0.0.0",
    manifest: { capabilityId, work: work.manifest },
    files: sorted.map((f) => ({ path: f.path, mediaType: starterPackMediaType(f.path), digest: sha256(f.bytes), contentBase64: "" })),
  };
  return skillContentDigest(entry);
}
