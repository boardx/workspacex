/**
 * `createTemplate` —— 三段发布流程**之前**的那一段：把一行造出来（#496）。
 *
 * ## 🟡 本用例实现的契约面**尚未经人类签核**
 *
 * `packages/contracts/src/canvas.ts` 的 `createTemplate` 是 2026-08-04 由 coord-main 代
 * 人类裁决先做、并登记为**待补签**的 design-delta（issue #496 就是那条记录）。人类回来后
 * 要么补签，要么推翻并回退本文件与它的调用方。⚠ 在补签之前不得以它为既成事实继续扩展
 * （例如据此再造 update / newVersion）；签核状态只由人类在束级 `design-signoff.md` 里改。
 *
 * ## 它**加**一段，不**替**任何一段
 *
 * 造出来的行是 `draft`。要能用，还得走 `publishTemplate`（可选先 `trialTemplate`）——
 * 已签核的三段发布流程一段都没被绕开。⚠ 因此**不得**把 `publishTemplate` 改造成
 * 「不存在就创建」的 upsert：那会让它 `err` 里的 `TEMPLATE_NOT_FOUND` 变成不可达，
 * 而不可达的错误码正是契约自己点名的门控空转形状（`KNOWN_CONTRACT_GAPS.C_CANVAS_3`）。
 *
 * ## 这里没有「先查再建」
 *
 * key 是否被占用由仓储在**一条语句**里连同写入一起判定（见 `template-ports.ts` 的
 * `create()`）。用例里写 `findVersion(...) === null` 再 `create(...)`，读起来更直白，
 * 但两个并发请求会双双通过那次检查——而这种失败只在真并发下发生，顺序执行的测试全绿。
 *
 * ## `builtin` / `version` / `status` 不接受入参
 *
 * 三者都是服务端决定的：`builtin` 恒 false（内置清单的权威是契约的
 * `BUILTIN_CANVAS_TEMPLATES`，不是任何请求体），`version` 恒 1，`status` 恒 `draft`。
 * 契约的 `in` 是 `.strict()`，所以想自封 `published` 的请求在边界上就是 400，
 * 不会走到这里；这段注释说的是**即便走到了，这里也不读它们**。
 */
import type { OrgId } from "../../domain/org-id";
import type { VisibilityScope } from "../../domain/identity/roles";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import type {
  CanvasTemplateRepository,
  CreatedCanvasTemplate,
} from "./template-ports";

export interface CreateTemplateDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
}

export interface CreateTemplateInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly displayName: string;
  readonly underlyingType: string;
  readonly sections: CreatedCanvasTemplate["sections"];
  readonly visibility: VisibilityScope;
}

export async function createTemplate(
  deps: CreateTemplateDeps,
  input: CreateTemplateInput,
): Promise<CreatedCanvasTemplate> {
  // 与其余四个写操作**同一个**判定函数：不变量写五遍，漏掉的那一遍不会有任何东西报警。
  const membership = await requireTemplateAdmin({ identity: deps.identity }, input);

  const outcome = await deps.templates.create({
    orgId: input.orgId,
    key: input.key,
    displayName: input.displayName,
    underlyingType: input.underlyingType,
    sections: input.sections,
    visibility: input.visibility,
    // C_CANVAS_8 ①：契约没有 `ownerTeamId`，取创建者自己的团队。他没有团队时是 null，
    // 而 `team-only` + null owner 对**所有人**不可见（fail-closed，见迁移文件头）。
    // ⚠ 不要在这里给它编一个默认团队去「修好」这个后果：那会把一个契约缺口变成一条
    //   没人评审过的可见性规则，而缺口本身就此看不见了。后果如实留着，等人类补签时裁。
    ownerTeamId: membership.teamId,
  });

  if (!outcome.created) {
    // 本操作是 `TEMPLATE_KEY_CONFLICT` 在整个 canvas 束里**唯一**的产生方——在 #496 之前
    // 这个码在 `CanvasError` 闭集里却不属于任何一个操作的 err，即不可达。
    throw new CanvasError("TEMPLATE_KEY_CONFLICT");
  }
  return outcome.template;
}
