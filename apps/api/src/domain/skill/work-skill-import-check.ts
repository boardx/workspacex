/**
 * work-skill-import-check.ts —— starter-pack 导入时对 `metadata.work` 的校验（Phase 20 WS02，UC-2）。
 *
 * 纯函数：对已通过摘要校验的包，逐个 skill 解析根 `SKILL.md` 的 `metadata.work`（形状单源 =
 * 契约 `WorkSkillManifest`，经 WS01 的 `parseWorkSkillManifest`），再做分类登记检查（E6）。
 * 任一 skill 失败 ⇒ 整包拒绝（调用方在写库之前调用，保证 `skill_versions` 行数不变）。
 */
import type { WorkSkillManifest } from "@repo/contracts/work-skill-meta";
import { isRegisteredCapabilityCategory } from "./capability-category-registry";
import type { SkillStarterPack } from "./starter-pack";
import { parseWorkSkillManifest, type WorkSkillManifestIssue } from "./work-skill-manifest";

export type WorkSkillImportRejectionCode =
  | "WORK_SKILL_MANIFEST_INVALID"
  | "WORK_SKILL_CAPABILITY_UNREGISTERED"
  | "WORK_SKILL_PROVENANCE_LICENSE_MISSING";

export type WorkSkillImportCheck =
  | { readonly kind: "ok"; readonly manifests: ReadonlyMap<string, WorkSkillManifest> }
  | {
      readonly kind: "rejected";
      readonly code: WorkSkillImportRejectionCode;
      readonly issues: readonly WorkSkillManifestIssue[];
    };

/** E8：provenance 缺 license、或 copied 无 notice（契约 refine 落在 `notice`）。 */
const PROVENANCE_LICENSE_PATH = /^metadata\.work\.provenance\.\d+\.(license|notice)$/;

function rootSkillMarkdown(skill: SkillStarterPack["skills"][number]): string {
  const root = skill.files.find((file) => file.path === "SKILL.md");
  return root === undefined ? "" : Buffer.from(root.contentBase64, "base64").toString("utf8");
}

export function checkWorkSkillManifests(pack: SkillStarterPack): WorkSkillImportCheck {
  const manifests = new Map<string, WorkSkillManifest>();
  const invalid: WorkSkillManifestIssue[] = [];
  const unregistered: WorkSkillManifestIssue[] = [];
  for (const skill of pack.skills) {
    const file = `${skill.stableName}/SKILL.md`;
    const parsed = parseWorkSkillManifest(file, rootSkillMarkdown(skill));
    if (parsed.kind === "absent") continue;
    if (parsed.kind === "invalid") {
      invalid.push(...parsed.issues);
      continue;
    }
    const { required, optional } = parsed.manifest.dependencies;
    for (const [kind, categories] of [["required", required], ["optional", optional]] as const) {
      categories.forEach((category, index) => {
        if (!isRegisteredCapabilityCategory(category)) {
          unregistered.push({
            file,
            fieldPath: `metadata.work.dependencies.${kind}.${index}`,
            message: `capability category "${category}" is not registered`,
          });
        }
      });
    }
    const clash = [...manifests].find(([, other]) => other.stableId === parsed.manifest.stableId);
    if (clash !== undefined) {
      invalid.push({ file, fieldPath: "metadata.work.stableId", message: `stableId ${parsed.manifest.stableId} is also declared by ${clash[0]}` });
      continue;
    }
    manifests.set(skill.stableName, parsed.manifest);
  }
  if (invalid.length > 0) {
    const licenseOnly = invalid.every((issue) => PROVENANCE_LICENSE_PATH.test(issue.fieldPath));
    return {
      kind: "rejected",
      code: licenseOnly ? "WORK_SKILL_PROVENANCE_LICENSE_MISSING" : "WORK_SKILL_MANIFEST_INVALID",
      issues: invalid,
    };
  }
  if (unregistered.length > 0) {
    return { kind: "rejected", code: "WORK_SKILL_CAPABILITY_UNREGISTERED", issues: unregistered };
  }
  return { kind: "ok", manifests };
}
