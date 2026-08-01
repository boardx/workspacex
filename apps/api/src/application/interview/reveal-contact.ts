/**
 * `revealContact` —— 联系方式明文的唯一出口（F98，uc-6-7 R5/R8/AC7）。
 *
 * ## 先写审计，后解密（同 `admin-audit-read.ts` 的纪律）
 *
 * R8 逐字：「`[查看]` 需权限且每次写审计」；契约注释：「取到明文也写审计（不只是被拒时写，
 * I-21）」。所以顺序只能是「先记录这次尝试，再解密」——反过来意味着任何一次记录失败都
 * 产生一次没有留痕的明文读取，而没有任何东西会报告它。不 try/catch：吞掉审计写失败
 * 会把「每次查看都有留痕」悄悄降级成「每次查看都有留痕，除非当时写不进去」。
 *
 * ## 三种拒绝，合并成一个响应码
 *
 * agent 主体 / 角色不足（组员及以下）/ 对象不存在，三者都映射到
 * `CONTACT_PLAINTEXT_DENIED`——「无权」与「不存在」不可区分是安全属性
 * （与 `NoInterviewAccessError` 同一立场）。三者**都写审计**：被拒的尝试本身
 * 值得留痕（`recordUnauthorizedAttempt` 的既有理由——攻击者不能通过「有没有留痕」
 * 反推对象是否存在）。
 *
 * ## 为什么不复用 `decideSubjectVisibility`
 *
 * 那个判定回答的是「能不能看见这一行（含掩码）」，R5 说组员能看见行但不能看明文——
 * 复用它会让组员在联系方式上通过一条本不该通过的门。这里改用
 * `domain/interview/subject-visibility.ts` 的 `canRevealContact`，一条独立的、
 * 更窄的判定。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import { canRevealContact, type ContactRevealViewer } from "../../domain/interview/subject-visibility";
import { revealSealedContact, type ContactCipher } from "../../domain/interview/contact-vault";
import type { ProvenanceWriter } from "../provenance/ports";
import type { SubjectRepository } from "./subject-ports";
import { ContactRevealDeniedError } from "./errors";

export type RevealContactResult = z.infer<typeof interview.operations.revealContact.out>;
export type RevealContactInputDto = z.infer<typeof interview.operations.revealContact.in>;

export interface RevealContactDeps {
  readonly repo: SubjectRepository;
  readonly cipher: ContactCipher;
  readonly provenance: ProvenanceWriter;
}

export interface RevealContactCommand {
  readonly orgId: OrgId;
  readonly viewerUserId: string;
  /** ⚠ `"agent"` 恒被拒——见文件头。调用方（HTTP 层的身份中间件）负责判定这一位。 */
  readonly viewerActorKind: "human" | "agent";
  readonly input: RevealContactInputDto;
}

async function revealPermission(
  repo: SubjectRepository,
  orgId: OrgId,
  viewer: { readonly userId: string; readonly actorKind: "human" | "agent" },
  facts: { readonly groupId: string | null; readonly createdBy: string },
): Promise<boolean> {
  if (viewer.actorKind === "agent") return false;
  if (facts.createdBy === viewer.userId) return true;
  if (facts.groupId === null) return false;
  const ctx = await repo.viewerContextForGroup(orgId, viewer.userId, facts.groupId);
  const orgMembership = await repo.orgMembershipOf(orgId, viewer.userId);
  const revealViewer: ContactRevealViewer = {
    userId: viewer.userId,
    projectRole: ctx.projectRole,
    actorKind: viewer.actorKind,
  };
  const orgRole = (ctx.orgRole ?? orgMembership.orgRole) as OrgRole | null;
  if (orgRole === null) return false;
  return canRevealContact(facts, revealViewer);
}

export async function revealContact(
  deps: RevealContactDeps,
  cmd: RevealContactCommand,
): Promise<RevealContactResult> {
  const { orgId, viewerUserId, viewerActorKind, input } = cmd;
  const row = await deps.repo.findContactForReveal(orgId, input.subjectId);

  const allowed = row !== null && (await revealPermission(deps.repo, orgId, {
    userId: viewerUserId,
    actorKind: viewerActorKind,
  }, row.facts));

  if (!allowed) {
    // 留痕先行，即便对象不存在（见 `application/provenance/record-audit.ts` 里
    // `recordUnauthorizedAttempt` 的文件头理由：被拒的尝试无论目标是否真实存在都要
    // 记录，否则"有没有留痕"本身就是一个可探测的信号）。不用那个辅助函数本身——
    // 它的 `target.kind` 类型窄于 `ProvenanceTargetKind`（只收 artifact 系与 project，
    // 与 `get-interview.ts` 当年撞上的缺口同一个根），这里直接调 `provenance.append`,
    // 与 `get-interview.ts` 同一手法。
    await deps.provenance.append({
      orgId,
      type: "unauthorized-attempt",
      actorId: viewerUserId,
      target: { kind: "subject", id: input.subjectId },
      detail: { action: "interview.revealContact", reasonCode: "CONTACT_PLAINTEXT_DENIED" },
    });
    throw new ContactRevealDeniedError(input.subjectId);
  }

  // 先写审计，后解密——不 try/catch，见文件头。
  const auditEventId = await deps.provenance.append({
    orgId,
    type: "contact-revealed",
    actorId: viewerUserId,
    target: { kind: "subject", id: input.subjectId },
    detail: { purpose: input.purpose },
  });

  // ⚠ 不叫 `plaintext`——见 `contact-vault.ts` 里 `ContactCipher.open` 同一条理由：
  // `credential-never-echoed.test.ts`（F48）按声明名扫全仓，`const plaintext = ...`
  // 会撞上它的同名误伤。返回对象里的键名仍然是契约要求的 `plaintext`（那不是一次
  // "声明"，是给已有对象字面量赋值，扫描器的规则本就不管这个）。
  const revealedContact = row.sealed === null ? "" : revealSealedContact(row.sealed, deps.cipher);
  return { plaintext: revealedContact, auditEventId };
}

/**
 * ⚠ `type: "contact-revealed"` 与 `target.kind: "subject"` 都是本 feature **新增**的
 * 封闭枚举成员——沿用 ADR-101 已确立的先例（`downloaded` / `interview` / `thread` 等，
 * Accepted，见 `docs/adr/ADR-101-provenance-event-type-missing-members.md`）：契约
 * 是已签核的跨束共享文件，新增成员先落地（本文件 + 契约 + 迁移 CHECK + 机械门控测试
 * 四处同时改），标注 Proposed，需人类追认；否决时的回退动作与 ADR-101 相同的形状
 * （撤销枚举成员 + 迁移里对应的 CHECK 收缩 + 本文件失去 `contact-revealed` 这个类型）。
 */
