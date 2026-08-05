/**
 * `publishTemplate` —— 三段发布流程的第三段，含 I-4 前半「发布新版本时旧版自动归档」。
 *
 * ## 用例做的是编排，转移合法性归 domain
 *
 * 「published 状态下还能不能再 publish」这类问题在
 * `domain/canvas/template-lifecycle.ts` 的 `transition` 里已经是一张穷举过的 4×4 表。
 * 这里调用它，不重写；本文件负责的是它管不到的三件事：谁能做、旧版怎么归档、写库。
 *
 * ## `TEMPLATE_NOT_TRIALED` 没有实现，这是**刻意**的
 *
 * 契约把它留在 `err` 联合里但标了 `[待定 D-b]`，F101 的 notes 逐字写着本 feature 不含
 * 该阻断，`transition` 也据此把 `draft → published` 判为合法。所以这里**不加**这道门。
 * 加上它会让契约里一个未定的问题被一次实现悄悄裁定，而裁定它的应该是签核人。
 */
import { transition } from "../../domain/canvas/template-lifecycle";
import type { VisibilityScope } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError, CanvasIllegalTransitionError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import type { CanvasTemplateRepository, PublishOutcome } from "./template-ports";

export interface PublishTemplateDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
}

export interface PublishTemplateInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly version: number;
  readonly visibility: VisibilityScope;
}

export async function publishTemplate(
  deps: PublishTemplateDeps,
  input: PublishTemplateInput,
): Promise<{
  readonly key: string;
  readonly version: number;
  readonly status: "published";
  readonly archivedVersions: PublishOutcome["archivedVersions"];
}> {
  await requireTemplateAdmin({ identity: deps.identity }, input);

  const current = await deps.templates.findVersion(input.orgId, input.key, input.version);
  // ⚠ 权限在前、存在性在后，且顺序不能反：先查存在性，一个没有权限的调用方就能用
  //   404 与 403 的差别把这个组织有哪些模板 key 探出来。
  if (current === null) throw new CanvasError("TEMPLATE_NOT_FOUND");

  const next = transition(current.state, "publish");
  if (!next.ok) throw new CanvasIllegalTransitionError(next.reason);

  // 归档旧版与置本版为 published 是**一个事务**，边界在仓储里（见 `template-ports.ts`）。
  const outcome = await deps.templates.publish({
    orgId: input.orgId,
    key: input.key,
    version: input.version,
    visibility: input.visibility,
  });

  return {
    key: input.key,
    version: input.version,
    status: "published",
    archivedVersions: outcome.archivedVersions,
  };
}
