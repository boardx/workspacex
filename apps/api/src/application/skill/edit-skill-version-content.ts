/**
 * #595 后台管理面最小闭环 —— 编辑一个已导入 skill 的内容，落成**新版本**。
 *
 * ## 为什么存在
 *
 * URL 导入（#595 段 2）与 starter-pack 导入把内容落进模型 A
 * （`skills`/`skill_versions`/`skill_version_files`，运行时唯一真读的那套），
 * 但落地后没有任何写路径能再改它——`skill_versions`/`skill_version_files` 都是
 * immutable（DB 触发器拒绝 UPDATE/DELETE），这是故意的（审计可回看某次调用当时
 * 挂的是哪个版本），但也意味着「编辑」必须表达成「追加一个新版本」，不是「改旧版本」。
 * 本用例是这条追加路径。
 *
 * ## 范围：只编辑 `SKILL.md`，不做目录浏览/多文件
 *
 * coord-main 对 #595 的派工允许先落最小集合。多文件目录浏览/单文件之外的编辑
 * 留给后续 issue（见 PR 正文的「还差什么」）——`wave2_publish_skill_version` 本身
 * 也要求恰好一个根 `SKILL.md`，单文件编辑已经是能验证「编辑→pin→试跑」这条链路
 * 最小的那个动作。
 *
 * ## ⚠ 契约面是草案，尚未经人类签核
 *
 * 字段名 / 错误码全部来自 `packages/contracts` 的 `editSkillVersionContent`，
 * 那里标注**未签核**（ADR-023）。⛔ 本文件只 `import` 那份类型，不重新声明字段名。
 *
 * ## 顺序：授权 → 内容校验 → 持久化（与 URL 导入同一条纪律）
 *
 * 授权必须排在最前 —— 与 `import-skill-from-url.ts` 同一条理由：两条写路径通向
 * 同一批表，门槛不同就等于开了条矮的。
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { wave2Runtime as C } from "@repo/contracts";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";

export type EditSkillVersionContentInput = z.infer<
  typeof C.operations.editSkillVersionContent.in
> & {
  readonly orgId: string;
  readonly actorId: string;
  readonly skillId: string;
};

export type EditSkillVersionContentResult = z.infer<typeof C.operations.editSkillVersionContent.out>;

export type EditSkillVersionContentFailure = z.infer<typeof C.SkillVersionEditError>;

export class EditSkillVersionContentError extends Error {
  constructor(readonly code: EditSkillVersionContentFailure) {
    super(`edit skill version content failed: ${code}`);
    this.name = "EditSkillVersionContentError";
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export interface SkillVersionEditRepository {
  /**
   * 一次原子操作：确认 skill 存在于本组织，落一个新草稿版本 + `SKILL.md` 文件，
   * 再走唯一合法的发布路径 `wave2_publish_skill_version`。**不是**分成"先查再写"
   * 两步暴露给调用方——避免调用方在检查和写入之间被并发改写。
   */
  persist(input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly skillId: string;
    readonly content: string;
    readonly contentDigest: string;
  }): Promise<
    | { readonly kind: "ok"; readonly result: EditSkillVersionContentResult }
    | { readonly kind: "skill-not-found" }
  >;
}

export const SKILL_VERSION_EDIT_REPOSITORY = Symbol("SkillVersionEditRepository");

export interface EditSkillVersionContentDeps {
  readonly identities: IdentityRepository;
  readonly repository: SkillVersionEditRepository;
}

export async function editSkillVersionContent(
  input: EditSkillVersionContentInput,
  deps: EditSkillVersionContentDeps,
): Promise<EditSkillVersionContentResult> {
  /**
   * ⚠⚠ 授权门，必须是这条用例做的第一件事 —— 与 `import-skill-from-url.ts` /
   * `set-agent-skill-pins.ts` 逐字同一条门槛（`orgRole === "admin"`）。
   */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new EditSkillVersionContentError("EDIT_NOT_ORG_ADMIN");
  }

  const content = input.content.trim();
  if (content.length === 0) {
    throw new EditSkillVersionContentError("EDIT_CONTENT_INVALID");
  }

  const outcome = await deps.repository.persist({
    orgId: input.orgId,
    actorId: input.actorId,
    skillId: input.skillId,
    content,
    contentDigest: sha256(content),
  });

  switch (outcome.kind) {
    case "ok":
      return outcome.result;
    case "skill-not-found":
      throw new EditSkillVersionContentError("EDIT_SKILL_NOT_FOUND");
  }
}
