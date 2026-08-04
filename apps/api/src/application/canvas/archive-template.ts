/**
 * `archiveTemplate` —— O-10 的归档语义。**置位，不删除。**
 *
 * ## 这个 feature 唯一要防的两件事，都在这个文件的注释里，而断言在测试里
 *
 * ① **归档不是删除，也不是一个过滤条件。** 本仓在 research 模块把归档做成「过滤掉」踩过
 *    一次（F146）。这里 `setState` 写的是同一行的状态列，迁移**没有 GRANT DELETE**，所以
 *    「顺手实现成删除」在数据库层面就不成立，不靠这段注释被人读到。
 * ② **归档不挡存量绑定的实例化。** 见 `canInstantiateExistingBinding` 那条恒为 true 的
 *    谓词与它的文件头：一场正在进行的工作坊切到该环节时不能因为模板被归档而失败。
 *    本用例因此**不 touch 任何绑定行**——它连读写绑定表的端口都没有，只数它们。
 *
 * ## `confirmed: false` 是预检，一个字节都不写
 *
 * `stillBoundSegmentCount` 是**契约的一部分**，不是 UI 点缀：归档确认框必须显示
 * 「有 N 个议程环节仍绑定此模板」，而**返回 0 与不返回是两回事**。所以预检也走真实计数，
 * 不是返回一个占位值等以后接上。
 */
import { previewArchiveImpact, transition } from "../../domain/canvas/template-lifecycle";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError, CanvasIllegalTransitionError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import type { CanvasTemplateRepository } from "./template-ports";

export interface ArchiveTemplateDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
}

export interface ArchiveTemplateInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly version: number;
  /** false = 只做预检不写库，供确认框显示影响面。 */
  readonly confirmed: boolean;
}

export async function archiveTemplate(
  deps: ArchiveTemplateDeps,
  input: ArchiveTemplateInput,
): Promise<{ readonly status: "archived"; readonly stillBoundSegmentCount: number }> {
  await requireTemplateAdmin({ identity: deps.identity }, input);

  const current = await deps.templates.findVersion(input.orgId, input.key, input.version);
  if (current === null) throw new CanvasError("TEMPLATE_NOT_FOUND");

  // ⚠ 内置模板的判定在**转移之前**：`BUILTIN_TEMPLATE_UNDELETABLE` 只出现在
  //   `archiveTemplate.err` 里，是这条操作独有的门。19 个内置 A0 模板是产品的语言本身，
  //   一个组织把 `swot` 归档掉，之后所有引用它的文档与既有绑定都会指向一个没人能恢复
  //   （restore 也要过同一道 admin 门）的 key。
  if (current.builtin) throw new CanvasError("BUILTIN_TEMPLATE_UNDELETABLE");

  const next = transition(current.state, "archive");
  if (!next.ok) throw new CanvasIllegalTransitionError(next.reason);

  const boundSegmentIds = await deps.templates.listBoundSegmentIds(
    input.orgId,
    input.key,
    input.version,
  );
  // 过 domain 而不是直接 `boundSegmentIds.length`：这个字段叫什么、可不可缺省，由那个
  // 函数单点决定，绕过去就是把它声明在第二处。
  const impact = previewArchiveImpact(boundSegmentIds);

  if (input.confirmed) {
    await deps.templates.setState(input.orgId, input.key, input.version, next.next);
  }

  // ⚠ 预检也回 `status: "archived"`。契约的 `out.status` 是 `z.literal("archived")`——
  //   它描述的是「这次动作的目标状态」，不是「库里现在是什么」。预检与确认的差别由
  //   调用方自己的 `confirmed` 决定，且上面那条 `if` 是唯一的写点。
  return { status: "archived", stillBoundSegmentCount: impact.stillBoundSegmentCount };
}
