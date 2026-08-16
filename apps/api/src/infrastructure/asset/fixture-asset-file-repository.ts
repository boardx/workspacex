/**
 * `FixtureAssetFileRepository` -- the phase-1 implementation of `AssetFileRepository`.
 *
 * ## Why a fixture and not a table
 *
 * There is, as of F141, no persisted store anywhere in this kernel for a skill/agent's
 * actual file bytes -- `03-skill`'s `Skill` entity carries governance metadata, not a
 * directory. Building that store is a bigger commitment than this feature's scope (F141 is
 * "browse & read", not "author a storage layer"), and the prototype gives EXACT file lists
 * for one Skill instance (`SK_TREE`) and one Agent instance (`AG_TREE`) -- see
 * `uc-23-3` R3 step 2's table. This repository serves those two trees for ANY `assetId`
 * of the matching kind, which is honest about what it is: a fixture that makes the read
 * path real and testable end to end, not a claim that every skill/agent has this content.
 *
 * ⚠ Scope is 2/6 `AssetKind`s (AG4): `getDirectory`/`readFile` return `null` for every kind
 *   other than `skill` / `agent`, and the use case turns that into the same not-found outcome
 *   as an unknown id (see `get-asset-directory.ts`'s header).
 *
 * `sizeBytes` is computed from the ACTUAL fixture body (`Buffer.byteLength`), not copied from
 * the prototype's rounded "2.1k" labels -- a size that does not match what `readFile` would
 * return for the same path is a bug users can find by opening the file, and I-6 (目录集合 =
 * 运行时装载集合) only means anything if the numbers agree with the bytes.
 */
import type {
  AssetDirectoryRecord,
  AssetFileContentRecord,
  AssetFileRepository,
  AssetKind,
} from "../../application/asset/ports";
import type { OrgId } from "../../domain/org-id";

interface FixtureFile {
  readonly path: string;
  readonly body: string;
}

const SKILL_MAIN_BODY = `---
name: MECE 假设拆解
description: 把商业问题拆成互斥穷尽的假设树，标注致命假设与验证成本
allowed-tools: Read, Grep, WebSearch
---

# MECE 假设拆解

## 什么时候用
用户给的是一个"要不要／能不能"的商业问题，而不是一个具体的计算题。先拆假设，再谈证据。

## 步骤
1. 把问题改写成一句可证伪的命题。
2. 沿一个维度切分（价值链 / 客户旅程 / 财务恒等式），一次只用一个维度，不要混切。
3. 每个分支标注：致命度（高/中/低）、验证成本、现有证据条数。
4. 找出"最便宜的致命假设"，作为下一步建议。

## 输出格式
见 references/output-schema.md。缺证据的分支必须显式写成"未验证"，不要用推测填满。

## 禁止
- 不要替用户做拍板结论。
- 不要在没有证据的分支上给置信度数字。
`;

const AGENT_MAIN_BODY = `---
name: Ava
role: 战略分析师
model: claude-opus-4.6
skills: [mece-decomposition, deep-research, meeting-notes]
memory: project + org(verified-only)
---

# Ava

## 她负责什么
把一个模糊的商业问题变成一棵有证据的假设树，并指出下一步最该验的那一件事。

## 她不做什么
- 不拍板。结论一律交给人签字。
- 不引用未标有效期的组织层知识。

## 交接
产出必须落到画布或报告的具体位置，不留在对话里。
`;

/** `SK_TREE`（`uc-23-3` R3 步骤 2 的表，逐字路径顺序）。 */
const SKILL_FILES: readonly FixtureFile[] = [
  { path: "SKILL.md", body: SKILL_MAIN_BODY },
  { path: "references/output-schema.md", body: "# 输出结构\n\n每个假设分支：致命度 / 验证成本 / 证据条数。\n" },
  { path: "references/question-bank.md", body: "# 追问题库\n\n- 这个分支的证据是一手还是转述？\n- 验证它最便宜的方式是什么？\n" },
  { path: "assets/tree-template.canvas.md", body: "# 假设树画布模板\n\n根节点：命题\n分支：致命度 / 验证成本 / 证据\n" },
  { path: "scripts/validate.py", body: "def validate(tree):\n    for node in tree:\n        assert node.get(\"lethality\") in (\"高\", \"中\", \"低\")\n" },
];

/** `AG_TREE`（`uc-23-3` R3 步骤 2 的表，逐字路径顺序）。 */
const AGENT_FILES: readonly FixtureFile[] = [
  { path: "AGENT.md", body: AGENT_MAIN_BODY },
  { path: "prompts/system.md", body: "# 系统提示词\n\n你是 Ava，战略分析师。先给反方，再给证据分级的建议。\n" },
  { path: "prompts/reflection.md", body: "# 自检清单\n\n- 是否先给了反对意见？\n- 是否有未标注证据强度的结论？\n" },
  { path: "tools/tools.json", body: JSON.stringify({ tools: ["read_project_files", "web_search"] }, null, 2) + "\n" },
  { path: "evals/regression.jsonl", body: '{"case":"欧洲EPC","expect":"先给反方"}\n{"case":"空材料","expect":"不硬编结论"}\n' },
];

function sizeOf(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

export class FixtureAssetFileRepository implements AssetFileRepository {
  /**
   * The per-(kind, assetId) LIVE file list, `path -> body`. Lazily cloned from the base
   * fixture tree (`SKILL_FILES` / `AGENT_FILES`) the first time any instance is touched, so a
   * write/delete/rename against one `assetId` never bleeds into another instance of the same
   * fixture tree -- but from then on THIS map is the single source of truth for both
   * `getDirectory` and `readFile` (F143's I-6: directory listing ＝ what a runtime loader
   * reading through this same repository would load -- true by construction, one store, not
   * two kept in sync by convention). A `Map`'s insertion order is preserved, so the base
   * tree's original order (asserted by `asset-directory-tree.test.ts`) survives untouched as
   * long as no delete/rename has touched those paths.
   */
  private readonly instances = new Map<string, Map<string, string>>();

  private instanceKey(assetKind: AssetKind, assetId: string): string {
    return `${assetKind}:${assetId}`;
  }

  private baseFilesFor(assetKind: AssetKind): readonly FixtureFile[] | null {
    if (assetKind === "skill") return SKILL_FILES;
    if (assetKind === "agent") return AGENT_FILES;
    // AG4: model / mcp / canvas-template / blueprint are not (yet) known to be directory-shaped.
    return null;
  }

  /** `null` = kind out of scope (AG4). Lazily materializes the live map on first touch. */
  private liveFiles(assetKind: AssetKind, assetId: string): Map<string, string> | null {
    const base = this.baseFilesFor(assetKind);
    if (base === null) return null;
    const key = this.instanceKey(assetKind, assetId);
    let map = this.instances.get(key);
    if (map === undefined) {
      map = new Map(base.map((f) => [f.path, f.body]));
      this.instances.set(key, map);
    }
    return map;
  }

  // ⚠ `orgId` is accepted (2026-08-09 / #785, see `ports.ts`'s header on why every method now
  // takes it) but deliberately IGNORED here: this fixture serves the SAME canned tree to any
  // caller regardless of tenant -- it was never claiming to be tenant-scoped, and adding a
  // fake per-org filter to a fixture would just be a second, redundant place to get that
  // filtering logic wrong. The real (Postgres) implementation is what actually enforces it.

  async getDirectory(_orgId: OrgId, assetKind: AssetKind, assetId: string): Promise<AssetDirectoryRecord | null> {
    const base = this.baseFilesFor(assetKind);
    const files = this.liveFiles(assetKind, assetId);
    if (base === null || files === null) return null;
    return {
      // The root file's path is a constant of the fixture tree, never mutated by this
      // repository (the use-case layer rejects any delete/rename of it before calling here).
      rootFile: base[0]!.path,
      entries: [...files.entries()].map(([path, body]) => ({ path, sizeBytes: sizeOf(body) })),
      // No version concept on this fixture-backed kind (`agent`, per #787) -- see
      // `AssetDirectoryRecord.currentVersionId`'s own doc comment.
      currentVersionId: null,
    };
  }

  async readFile(_orgId: OrgId, assetKind: AssetKind, assetId: string, path: string): Promise<AssetFileContentRecord | null> {
    const files = this.liveFiles(assetKind, assetId);
    if (files === null) return null;
    const body = files.get(path);
    if (body === undefined) return null;
    return { sizeBytes: sizeOf(body), body };
  }

  async writeFile(_orgId: OrgId, assetKind: AssetKind, assetId: string, path: string, body: string): Promise<AssetFileContentRecord | null> {
    const files = this.liveFiles(assetKind, assetId);
    if (files === null || !files.has(path)) return null;
    files.set(path, body);
    return { sizeBytes: sizeOf(body), body };
  }

  async deleteFile(_orgId: OrgId, assetKind: AssetKind, assetId: string, path: string): Promise<string | null> {
    const files = this.liveFiles(assetKind, assetId);
    if (files === null || !files.has(path)) return null;
    files.delete(path);
    return path;
  }

  async renameFile(
    _orgId: OrgId,
    assetKind: AssetKind,
    assetId: string,
    from: string,
    to: string,
  ): Promise<{ path: string; sizeBytes: number; body: string } | null> {
    const files = this.liveFiles(assetKind, assetId);
    if (files === null) return null;
    const body = files.get(from);
    if (body === undefined) return null;
    files.delete(from);
    files.set(to, body);
    return { path: to, sizeBytes: sizeOf(body), body };
  }
}
