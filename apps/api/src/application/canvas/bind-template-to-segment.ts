/**
 * `bindTemplateToSegment`（#493 / F102）—— 把一个画布模板绑到某个议程环节。
 *
 * ## 这是「使用一个模板」在签核契约里的机械形态
 *
 * 契约把模板的**被使用程度**定义在两个字段上：`listTemplates.out.usageCount`
 * （「必须真实统计，不得估算」）与 `archiveTemplate.out.stillBoundSegmentCount`
 * （「有 N 个 agenda_segment 仍绑定此模板」）。`20260805030000_canvas_template_registry.sql`
 * 指名 `canvas_template_bindings` 是这两个字段的**唯一事实源**，并在文件头如实记着这张表
 * 「目前没有写入方，这是已知且刻意的 —— 写它的操作是 `bindTemplateToSegment`」。
 * 本文件就是那个写入方。
 *
 * ## 判定不在这里，在 domain
 *
 * 三条拒绝（`TEMPLATE_NOT_FOUND` / `TEMPLATE_ARCHIVED` / `SEGMENT_TEMPLATE_LIMIT`）整个来自
 * `domain/canvas/segment-binding.ts` 的 `canBindTemplateToSegment`——那个纯函数自 F102 起就
 * 存在、被 `tests/canvas/segment-two-template-limit.test.ts` 覆盖，只是从来没有任何 HTTP
 * 路径到得了它。本用例**不重写**那三条判据：重写就是第二份 I-5 / I-6，而两份判据里被漏掉
 * 的那一份不会有任何东西报警。
 *
 * ## 两个权限判据，两个不同的答案，都不是新发明的
 *
 * · 改模板注册表（publish / trial / archive / restore）判 **org admin**
 *   （`template-admin.ts` 的 `requireTemplateAdmin` → `canMutateCapabilities`）。
 * · **用**一个模板判**工作坊里的引导师** —— `usecases.md` 的 `pre:` 逐字只有「引导师」。
 *   ⇒ 走 `authorize()` 与 `PROJECT_ROLE_MATRIX` 的 `agendaSegment.bindTemplate`，
 *   与 `advanceAgendaSegment` 同一条路径、同一张矩阵。
 *
 * 「谁能配置这个组织有哪些模板」与「谁能在现场把模板用起来」本来就是两件事；把它们并成
 * 一个判据，要么组织管理员在现场绑不了，要么引导师能改全组织的模板库。
 *
 * ## `VERSION_CHANGED` 没有被实现，这一点是说出来的
 *
 * 契约的 `bindTemplateToSegment.err` 含 `VERSION_CHANGED`，但**没有任何一份已签核文档说明
 * 它在这条操作上指什么**：`usecases.md` 的 `err:` 只是列出它，`coverage.md` 里
 * `VERSION_CHANGED` 唯一被展开的地方是 V9（`batchConfirmAndWriteBackToBrain` 的
 * `expectedRevision` 乐观并发），而本操作的 `in` 里**没有** `expectedRevision` 之类的字段
 * 可供比对。最像的猜测是「你要绑的版本已不是当前 published 版本」，但那是一种猜测，而
 * `domain` 侧的 `canBindTemplateToSegment` 已经把「非 published」整体归到 `TEMPLATE_ARCHIVED`。
 * ⇒ 这里**不**替产品选一种含义。缺口报在 #493，形状与 `KNOWN_CONTRACT_GAPS.C_CANVAS_3`
 * 逐字同型（一个存在于 err 联合、却没有可达路径的码）。
 */
import { canBindTemplateToSegment } from "../../domain/canvas/segment-binding";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { CanvasError } from "./errors";
import {
  CanvasSegmentBindingExistsError,
  CanvasSegmentNotFoundError,
} from "./segment-binding-errors";
import type { CanvasTemplateRepository } from "./template-ports";

/** 引用矩阵里实际存在的字面量，不新造常量值（同 `ADVANCE_AGENDA_SEGMENT_ACTION` 的理由）。 */
export const BIND_TEMPLATE_TO_SEGMENT_ACTION = "agendaSegment.bindTemplate" as const;

export interface BindTemplateToSegmentDeps {
  readonly auth: AuthorizeDeps;
  readonly templates: CanvasTemplateRepository;
  /** 绑定 id 的来源。注入是为了让测试能造一次真实的 id 冲突，而不是相信随机数不会撞。 */
  readonly newBindingId: () => string;
}

export interface BindTemplateToSegmentInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly agendaSegmentId: string;
  readonly templateKey: string;
  readonly templateVersion: number;
}

export interface BindTemplateToSegmentOutput {
  readonly bindingId: string;
  readonly templateKey: string;
  readonly boundTemplateVersion: number;
}

export async function bindTemplateToSegment(
  deps: BindTemplateToSegmentDeps,
  input: BindTemplateToSegmentInput,
): Promise<BindTemplateToSegmentOutput> {
  // ① 环节在哪个工作坊。这一次查询同时喂给鉴权和写入 —— 见 `findSegmentWorkshopId` 的端口注释。
  //
  // ⚠ 先解析环节、再鉴权，是因为项目角色是**挂在工作坊上**的，不知道工作坊就无从判起。
  //   代价是「环节不存在」的 404 早于权限判定 —— 可接受：`agenda_segments` 走 RLS，
  //   别的组织的环节在这里本来就查不到，所以这个 404 不泄露跨组织的存在性
  //   （测试 `环节不存在（或属于别的组织）⇒ 404` 断言的正是这一条）。
  const workshopId = await deps.templates.findSegmentWorkshopId(input.orgId, input.agendaSegmentId);
  if (workshopId === null) throw new CanvasSegmentNotFoundError(input.agendaSegmentId);

  // ② 引导师判定。同 `advanceAgendaSegment`：一次 `authorize()`，矩阵说了算。
  const decision = await authorize(deps.auth, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: workshopId,
    object: { kind: "project", id: workshopId },
    action: BIND_TEMPLATE_TO_SEGMENT_ACTION,
  });
  // ⚠ 「不是成员」与「是成员但角色不够」抛**同一个** `ROLE_INSUFFICIENT`：契约的 err 联合里
  //   没有「你不在这个项目里」这个码，而把非成员单独渲染成另一种拒绝，等于告诉一个陌生人
  //   「这个工作坊存在，只是你不在里面」（同 `requireTemplateAdmin` 的文件头）。
  if (!decision.allowed) throw new CanvasError("ROLE_INSUFFICIENT");

  // ③ 模板当前状态 + 该环节已有的绑定 —— 判定所需的两个事实。
  const version = await deps.templates.findVersion(input.orgId, input.templateKey, input.templateVersion);
  const existing = await deps.templates.listSegmentBindings(input.orgId, input.agendaSegmentId);

  // ④ 判定整段来自 domain，本文件一条 `if` 都不复述。
  const verdict = canBindTemplateToSegment({
    existingBindingsForSegment: existing.map((b) => ({
      bindingId: b.bindingId,
      agendaSegmentId: b.agendaSegmentId,
      templateKey: b.templateKey,
      boundTemplateVersion: b.boundTemplateVersion,
    })),
    templateStatus: version?.state.status,
  });
  if (!verdict.ok) throw new CanvasError(verdict.reason);

  // ⑤ 写入。冲突由唯一约束判，不先查后写 —— 见 `insertSegmentBinding` 的端口注释。
  const bindingId = deps.newBindingId();
  const wrote = await deps.templates.insertSegmentBinding({
    orgId: input.orgId,
    bindingId,
    agendaSegmentId: input.agendaSegmentId,
    workshopId,
    templateKey: input.templateKey,
    templateVersion: input.templateVersion,
  });
  if (wrote === "conflict") throw new CanvasSegmentBindingExistsError(input.templateKey);

  // ⚠ `boundTemplateVersion` 回的是**请求里那个版本**，不是「模板现在是哪个版本」。
  //   F102 的冻结语义（domain 文件头）：绑定记下绑定那一刻的版本号，此后模板发新版、
  //   归档、恢复都不改写它。这里若改成回查注册表的当前版本，反向断言
  //   「绑 v1 后发布 v2，绑定仍指向 v1」就会红 —— 那条测试正是为此存在。
  return { bindingId, templateKey: input.templateKey, boundTemplateVersion: input.templateVersion };
}
