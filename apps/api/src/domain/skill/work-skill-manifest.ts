/**
 * work-skill-manifest.ts —— `SKILL.md` frontmatter 中 `metadata.work` 的解析与校验（Phase 20 WS01，UC-1）。
 *
 * 纯函数：调用方传入已读出的 SKILL.md 正文与文件路径；本文件不碰 fs / DB。
 * 形状只认契约单源 `@repo/contracts/work-skill-meta` 的 `WorkSkillManifest`（ADR-117 #2），
 * 这里不复述任何字段规则；分类是否已登记（E6）由导入流程（WS02）对照登记表判定。
 */
import { parse as parseYaml } from "yaml";
import type { z, ZodIssue } from "zod";
import { WorkSkillManifest, WorkSkillManifestIssue as WorkSkillManifestIssueSchema } from "@repo/contracts/work-skill-meta";

/** 形状单源：契约 `WorkSkillManifestIssue`（WS02 导入 422 的 issues 复用同一类型）。 */
export type WorkSkillManifestIssue = z.infer<typeof WorkSkillManifestIssueSchema>;

export type WorkSkillManifestResult =
  | { readonly kind: "absent" } // 普通 Skill，无 metadata.work（A1）
  | { readonly kind: "valid"; readonly manifest: WorkSkillManifest }
  | { readonly kind: "invalid"; readonly issues: readonly WorkSkillManifestIssue[] };

const ROOT = "metadata.work";

function frontmatterBlock(markdown: string): string | null {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  return matched === null ? null : matched[1]!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issueFromZod(file: string, issue: ZodIssue): WorkSkillManifestIssue {
  const path = issue.path.map(String);
  if (issue.code === "unrecognized_keys") {
    return { file, fieldPath: [ROOT, ...path, issue.keys.join(",")].join("."), message: issue.message };
  }
  return { file, fieldPath: [ROOT, ...path].join("."), message: issue.message };
}

/** 解析一份 SKILL.md 的 `metadata.work`。无 frontmatter / 无该键 ⇒ absent；YAML 坏 ⇒ invalid。 */
export function parseWorkSkillManifest(file: string, markdown: string): WorkSkillManifestResult {
  const block = frontmatterBlock(markdown);
  if (block === null) return { kind: "absent" };
  let doc: unknown;
  try {
    doc = parseYaml(block);
  } catch (error) {
    // 任何 frontmatter YAML 解析失败都报 invalid：无法解析就无法证明不是 Work Skill
    // （flow 风格 `metadata: {work: [bad` 不会命中任何行首正则，E1 旁路）
    const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    return { kind: "invalid", issues: [{ file, fieldPath: "frontmatter", message: `YAML 解析失败：${message}` }] };
  }
  if (!isRecord(doc) || !isRecord(doc.metadata) || !("work" in doc.metadata)) return { kind: "absent" };
  const parsed = WorkSkillManifest.safeParse(doc.metadata.work);
  if (parsed.success) return { kind: "valid", manifest: parsed.data };
  return { kind: "invalid", issues: parsed.error.issues.map(issue => issueFromZod(file, issue)) };
}

export function formatWorkSkillManifestIssue(issue: WorkSkillManifestIssue): string {
  return `${issue.file}: ${issue.fieldPath}: ${issue.message}`;
}
