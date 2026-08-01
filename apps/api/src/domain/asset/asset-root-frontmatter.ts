/**
 * `validateRootFrontmatter` -- F142 (`uc-23-3` R3 "根文件的 frontmatter" / E2, R12-10).
 *
 * Pure function: given a root file's (`SKILL.md` / `AGENT.md`) full text, decide whether its
 * leading `--- ... ---` frontmatter block is well-formed AND carries the required fields for
 * that `AssetKind`. Returns an empty array when it is fine, otherwise one issue per problem --
 * mirroring `domain/skill/declarative-contract.ts`'s `ValidationIssue` shape (`field` / `rule`
 * / `detail`) so `CONTRACT_VALIDATION_FAILED` reads the same way across both bundles (`skills`
 * I-14's reuse note on this very code).
 *
 * ⚠ **Only the two root-file kinds are covered** (`skill` / `agent`) -- same 2/6 scope as the
 * rest of F141/F142 (AG4). Callers outside that pair should not call this at all.
 * ⚠ **Required fields come straight from `uc-23-3` R3's "根文件的 frontmatter" table** --
 *   `SKILL.md`: `name` / `description` / `allowed-tools`; `AGENT.md`: `name` / `role` / `model`
 *   / `skills` / `memory`. This module does not invent a fifth or sixth requirement.
 * ⚠ A malformed line (not `key: value`) makes the WHOLE block unparseable -- it stops at the
 *   first such line rather than trying to salvage a partial field list, because a YAML parser
 *   would reject the whole document too; reporting field-by-field after that point would imply
 *   a confidence the parse does not have.
 */

export interface FrontmatterIssue {
  readonly field: string;
  readonly rule: "unparsable" | "required";
  readonly detail: string;
}

export type RootFrontmatterAssetKind = "skill" | "agent";

export function isRootFrontmatterAssetKind(kind: string): kind is RootFrontmatterAssetKind {
  return kind === "skill" || kind === "agent";
}

const ROOT_REQUIRED_FIELDS: Readonly<Record<RootFrontmatterAssetKind, readonly string[]>> = {
  skill: ["name", "description", "allowed-tools"],
  agent: ["name", "role", "model", "skills", "memory"],
};

const FRONTMATTER_LINE = /^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/;

export function validateRootFrontmatter(
  assetKind: RootFrontmatterAssetKind,
  body: string,
): readonly FrontmatterIssue[] {
  const lines = body.split(/\r?\n/);

  if ((lines[0] ?? "").trim() !== "---") {
    return [
      {
        field: "frontmatter",
        rule: "unparsable",
        detail: "文件未以 `---` frontmatter 分隔符开头",
      },
    ];
  }

  const endIdx = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (endIdx === -1) {
    return [
      {
        field: "frontmatter",
        rule: "unparsable",
        detail: "找不到 frontmatter 的结束分隔符 `---`",
      },
    ];
  }

  const fields = new Map<string, string>();
  for (let i = 1; i < endIdx; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) continue;
    const match = FRONTMATTER_LINE.exec(line);
    if (match === null) {
      return [
        {
          field: "frontmatter",
          rule: "unparsable",
          detail: `第 ${i + 1} 行不是合法的 \`key: value\` 语法：${JSON.stringify(line)}`,
        },
      ];
    }
    fields.set(match[1]!, match[2]!);
  }

  const issues: FrontmatterIssue[] = [];
  for (const field of ROOT_REQUIRED_FIELDS[assetKind]) {
    const value = fields.get(field);
    if (value === undefined || value.trim().length === 0) {
      issues.push({ field, rule: "required", detail: `必填项 \`${field}\` 缺失或为空` });
    }
  }
  return issues;
}
