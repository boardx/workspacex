/**
 * `UpsertParticipantRoster`（F15 / UC-1.3）—— 按邮箱/手机号批量邀请并指派身份四选。
 *
 * ## 部分成功是**一等返回形态**，不是错误
 *
 * 契约 E3 逐字：「格式非法/重复项逐条标出并允许改正后重提，**不整批失败，也不静默丢弃**」。
 * 所以 `out` 三段齐全（created / deduped / invalid），而 `err` 里**没有**「批量失败」的码。
 * 一个 `throw` 掉整批的实现会让引导师粘 40 个手机号、错一个、全部重来。
 *
 * ## 掩码在这一层生成，且**掩码不是脱敏**
 *
 * `masked` 是给界面看的（`138 •••• 2049`）。它与原值一起存，因为界面恒展示它，
 * 而每次现算意味着掩码规则散在每一个读路径上。
 * ⚠ 原值仍然是明文列：手机号的存储形态是 domain.md `[待定 A]`（加密可逆 vs 只存哈希），
 *   **未裁决**。这里不发明密钥方案，见迁移 0025 的文件头。
 */
import { normalizeEmail } from "../../domain/auth/registration";
import {
  identityChoiceOf,
  newParticipantId,
  projectRoleOf,
  type ParticipantIdentityChoice,
} from "../../domain/auth/invite-link";
import type { OrgId } from "../../domain/org-id";
import { assertCanManageInviteLinks, type InviteLinkActor } from "./invite-link-authz";
import type {
  ParticipantRosterRepository,
  UpsertParticipantInput,
} from "./invite-link-ports";

export interface UpsertRosterDeps {
  readonly roster: ParticipantRosterRepository;
}

export interface UpsertRosterInput extends InviteLinkActor {
  readonly orgId: OrgId;
  readonly projectId: string;
  /** 「邮箱或手机号，逗号分隔」拆开后的数组。 */
  readonly recipients: readonly string[];
  readonly identity: ParticipantIdentityChoice;
  readonly groupId?: string | null;
}

export interface RosterEntryOutput {
  readonly participantId: string;
  readonly masked: string;
  readonly identity: ParticipantIdentityChoice;
  readonly projectRole: ReturnType<typeof projectRoleOf>;
  readonly groupId: string | null;
}

export interface UpsertRosterOutput {
  readonly created: readonly RosterEntryOutput[];
  readonly deduped: readonly string[];
  readonly invalid: readonly { readonly value: string; readonly reason: string }[];
}

/**
 * 手机号规范化：只留数字。
 *
 * ⚠ 刻意**不做国别号解析**（+86 / 0086 / 86）。那需要一份号码库，而本阶段没有裁决
 * 用哪一份（uc-1-2 的短信服务商同为 `[待确认]`）。只留数字意味着
 * `+8613800002049` 与 `8613800002049` 会被判为同一个人，而 `13800002049` 是另一个——
 * 这**不理想**，但它是一条可预测、可写成断言的规则；一个半吊子的国别号解析
 * 会在某些前缀上正确、在另一些上悄悄把两个人合成一个。
 */
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** `138 •••• 2049`：留头 3 尾 4。短于 7 位的号码不留头尾，全掩。 */
function maskPhone(digits: string): string {
  if (digits.length < 7) return "•".repeat(digits.length);
  return `${digits.slice(0, 3)} •••• ${digits.slice(-4)}`;
}

/** `zh••@example.com`：本地部分留头 2。 */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  const local = email.slice(0, at);
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - head.length, 1))}${email.slice(at)}`;
}

/**
 * 一个收件人是邮箱、手机号，还是格式非法。
 *
 * ⚠ 判据故意简单且**明说**：含 `@` ⇒ 按邮箱验；否则去掉非数字后 7–15 位 ⇒ 按手机号；
 *   都不是 ⇒ 非法。E.164 的上限是 15 位，下限取 7 是最短的国内可拨号长度。
 *   把它写成一个正则藏在别处，下一个人只会看到一堆 `invalid` 而不知道为什么。
 */
function classify(raw: string): UpsertParticipantInput | { readonly reason: string } {
  const value = raw.trim();
  if (value === "") return { reason: "EMPTY" };
  if (value.includes("@")) {
    // 一个 `@`、两侧非空、右侧含一个点且点不在首尾。不追求 RFC 5322：
    // 真正的判据是「这封邮件发得出去」，而那要等到 MailSender 存在（同 F10）。
    if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(value)) return { reason: "MALFORMED_EMAIL" };
    const email = normalizeEmail(value);
    return {
      participantId: newParticipantId(),
      contactKind: "email",
      contact: email,
      masked: maskEmail(email),
      projectRole: "member",
      groupId: null,
    };
  }
  const digits = normalizePhone(value);
  if (digits.length < 7 || digits.length > 15) return { reason: "MALFORMED_PHONE" };
  return {
    participantId: newParticipantId(),
    contactKind: "phone",
    contact: digits,
    masked: maskPhone(digits),
    projectRole: "member",
    groupId: null,
  };
}

export async function upsertParticipantRoster(
  deps: UpsertRosterDeps,
  input: UpsertRosterInput,
): Promise<UpsertRosterOutput> {
  assertCanManageInviteLinks(input);

  const projectRole = projectRoleOf(input.identity);
  const groupId = input.groupId ?? null;

  const invalid: { value: string; reason: string }[] = [];
  const rows: UpsertParticipantInput[] = [];
  /** 同一批里出现两次的，第二次进 `deduped`——不等到数据库才发现（那里只会报一次冲突）。 */
  const seen = new Map<string, string>();
  const dedupedInBatch: string[] = [];

  for (const raw of input.recipients) {
    const c = classify(raw);
    if ("reason" in c) {
      invalid.push({ value: raw, reason: c.reason });
      continue;
    }
    if (seen.has(c.contact)) {
      dedupedInBatch.push(raw);
      continue;
    }
    seen.set(c.contact, raw);
    rows.push({ ...c, projectRole, groupId });
  }

  const result = await deps.roster.upsert(input.orgId, input.projectId, input.actorId, rows);

  return {
    created: result.created.map((r) => ({
      participantId: r.participantId,
      masked: r.masked,
      // ⚠ 从 `projectRole` 反推，不把 identity 也存一列。见 domain/auth/invite-link.ts。
      identity: identityChoiceOf(r.projectRole),
      projectRole: r.projectRole,
      groupId: r.groupId,
    })),
    // 批内重复 + 库里已存在，两者都是「A2 去重掉的原始值」。
    // ⚠ 仓储返回的是**规范化后**的 contact（它只认识那个），在这里对回原始输入——
    //   界面要把「这一条重复了」标在用户自己粘进去的那一行上，标在 `13800002049` 上
    //   而用户输的是 `+86 138-0000-2049`，他找不到是哪一行。
    deduped: [...dedupedInBatch, ...result.deduped.map((c) => seen.get(c) ?? c)],
    invalid,
  };
}
