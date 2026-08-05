/**
 * `restoreTemplate` —— [恢复]。回到**当初被归档时的那个状态**，不是回到一个默认状态。
 *
 * ## 落点由 domain 算，且它需要一个必须落库的字段
 *
 * `transition({status:"archived", archivedFrom}, "restore")` 的结果取决于 `archivedFrom`：
 * 从 published 归档的回 published，其余回 draft（契约的 `out` 只有这两个落点，
 * `trial` 不是合法的恢复目的地）。所以 `archived_from` 是一个**必须落库**的列——
 * 只记「archived」的实现，恢复时无从分辨该回哪里，只能猜一个。
 *
 * ## 恢复到 published 时**不**顺手归档现任 published
 *
 * 数据库的部分唯一索引 `canvas_templates_one_published_per_key` 会拒绝这次写入，用例把它
 * 翻译成 409 而不是替人挑一个。理由写在 `errors.ts` 的
 * `CanvasPublishedVersionConflictError` 上：「恢复」这个动作的语义里没有「把别人挤下去」，
 * 而 `publishTemplate` 有（I-4 明说旧版自动归档）。两条路径看起来都能到达 published，
 * 只有一条被授权改动**别的**行。
 */
import { transition } from "../../domain/canvas/template-lifecycle";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import {
  CanvasError,
  CanvasIllegalTransitionError,
  CanvasPublishedVersionConflictError,
} from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import type { CanvasTemplateRepository } from "./template-ports";

export interface RestoreTemplateDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
}

export interface RestoreTemplateInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly version: number;
}

export async function restoreTemplate(
  deps: RestoreTemplateDeps,
  input: RestoreTemplateInput,
): Promise<{ readonly status: "draft" | "published" }> {
  await requireTemplateAdmin({ identity: deps.identity }, input);

  const current = await deps.templates.findVersion(input.orgId, input.key, input.version);
  if (current === null) throw new CanvasError("TEMPLATE_NOT_FOUND");

  const next = transition(current.state, "restore");
  if (!next.ok) throw new CanvasIllegalTransitionError(next.reason);

  // `transition` 的返回类型是全部四个状态，而契约的 `out` 只有两个。这一句不是防御性
  // 代码：它是「domain 的落点集合与契约的 out 集合今天相等」这件事的编译期证明点，
  // 哪天 domain 多出一个落点，这里会立刻不通过类型检查，而不是静默地回一个契约没有的值。
  const status = next.next.status;
  if (status !== "draft" && status !== "published") {
    throw new CanvasIllegalTransitionError(`restore 落到了契约之外的状态 "${status}"`);
  }

  try {
    await deps.templates.setState(input.orgId, input.key, input.version, next.next);
  } catch (e) {
    if (isUniquePublishedViolation(e)) throw new CanvasPublishedVersionConflictError(input.key);
    throw e;
  }

  return { status };
}

/**
 * 认那条部分唯一索引的违反。
 *
 * ⚠ 按**索引名**认，不按 SQLSTATE 认：`23505` 是「任何唯一约束冲突」，这张表上还有主键。
 *   用 23505 会把「这个版本号已经存在」也渲染成「已有 published 版本」，两条完全不同的
 *   诊断长成一句话。
 */
function isUniquePublishedViolation(e: unknown): boolean {
  const err = e as { code?: unknown; constraint?: unknown };
  return err?.code === "23505" && err?.constraint === "canvas_templates_one_published_per_key";
}
