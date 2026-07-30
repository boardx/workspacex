/**
 * `adminAuditRead` —— 组织管理员的审计读（I-8 / O-04）。
 *
 * ## 管理员**不是**万能读，这个端口不是把它变成万能读
 *
 * 三条边界，缺一条这个端口就变成了万能钥匙：
 *
 *   1. **只有这一条路**。普通读路径（`getThread`）对无项目角色的管理员照样拒绝——
 *      本文件不改那件事，它只是另开一扇**留痕的**门。
 *   2. **项目层给内容，个人层只给计数**。个人层对任何人封闭，管理员也一样。
 *   3. **读到即留痕，且留痕先于内容**。写不下审计就不给内容
 *      （`AUDIT_SINK_UNAVAILABLE`）——「可读」与「必留痕」是同一个原子动作。
 *
 * ## 与 phase-00 F03 的关系（看起来相反，其实不是）
 *
 * F03 断言「管理员在 `/identity/content/read` 上被拒（403 / ADMIN_NOT_SUPERUSER）」，
 * 本文件断言「管理员在**审计端口**上拿到内容（200）」。两者同时成立，正是 O-04 的形状：
 * 管理员没有**日常读**，有**留痕的审计读**。
 * ⚠ `domain.md` I-8 特别写明：早期稿本「无项目角色即 403」的断言**作废**——
 *   照旧稿写测试会产出一个方向相反的绿灯。
 *
 * ## 顺序：先写审计，后取正文
 *
 * 反过来（先读后记）意味着任何一次记录失败都产生一次无记录的访问，而且没有任何东西
 * 会报告它。R4 A1 之所以允许这次读，就是因为它被记录了——所以记录是前置条件，不是收尾。
 */
import { chat as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { DecisionIdFactory, IdentityRepository } from "../identity/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import { decideAdminAuditRead } from "../../domain/chat/thread-visibility";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ChatRepository } from "./ports";

export type AdminAuditReadResult = z.infer<typeof C.operations.adminAuditRead.out>;

/** 不是组织管理员。`compliance` 也走这里——D-U3 给的是审计链，不是项目内容读。 */
export class NotOrgAdminError extends Error {
  constructor() {
    super("not_org_admin");
  }
}

export interface AdminAuditReadDeps {
  readonly repo: IdentityRepository;
  readonly chat: ChatRepository;
  readonly provenance: ProvenanceWriter;
  /** 判定要有 id 才追得回来（I-8 的「该事件对项目负责人可查」）。 */
  readonly ids: DecisionIdFactory;
}

export interface AdminAuditReadInput {
  readonly adminId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly threadId: string;
  readonly layer: "project" | "personal";
}

/**
 * 只有 `admin` 通过。
 *
 * ⚠ 刻意**不**包含 `compliance`：D-U3 说合规官拿到的是审计链本身，不是项目内容，
 *   phase-00 的 `admin-boundary-deny.test.ts` 已经把这条断言在案。
 */
function isAuditReader(role: OrgRole | null): boolean {
  return role === "admin";
}

export async function adminAuditRead(
  deps: AdminAuditReadDeps,
  input: AdminAuditReadInput,
): Promise<AdminAuditReadResult> {
  const { repo, chat, provenance } = deps;
  const { adminId, orgId, projectId, threadId, layer } = input;

  const membership = await repo.findOrgMembership(adminId, orgId);
  // ⚠ 这里**不**查项目角色，这正是 O-04：管理员不要求持有项目角色。
  //   加一条「或者他有项目角色」的旁路，就等于把审计读和日常读合并了。
  const decision = decideAdminAuditRead({
    decisionId: deps.ids.next(),
    orgRole: membership?.orgRole ?? null,
    teamId: membership?.teamId ?? null,
  });
  if (!decision.allowed) throw new NotOrgAdminError();

  // 留痕先行。不 try/catch：吞掉它会把「每次访问都有记录」变成
  // 「每次访问都有记录，除非当时写不进去」。
  const auditEventId = await provenance.append({
    orgId,
    type: "admin-project-access",
    actorId: adminId,
    // 目标是**项目**，不是线程：项目负责人问的是「谁在读我的项目」，
    // 按线程记会让这个问题变成一次需要先枚举全部线程 id 的扫描。
    target: { kind: "project", id: projectId },
    detail: { threadId, layer, surface: "chat.adminAuditRead" },
  });

  if (layer === "personal") {
    // 个人层：**计数，且只有计数**。正文根本没有被加载——
    // 让字段不出现在响应里最可靠的办法是那个值从未进过内存（F03 同款做法）。
    //
    // ⚠ 语义登记：I-9 使得每条对话线程都是项目层，因此「个人层」在对话语境下
    //   指的是「这次审计只允许知道量，不允许知道内容」。契约的 `layer` 参数对
    //   对话这一侧尚未给出更细的定义，此处按 I-8 的可断言部分实现。
    return { messages: [], itemCount: await chat.countMessages(orgId, threadId), auditEventId };
  }

  const guarded = await chat.findMessages(orgId, threadId);
  // 线程不存在。审计事件已经写了——「有人试图审计读一条不存在的线程」本身值得留痕。
  if (guarded === null) return { messages: [], itemCount: null, auditEventId };
  const disclosed = discloseDecided(guarded, decision);
  if (!isDisclosed(disclosed)) throw new NotOrgAdminError();
  return {
    messages: disclosed.payload.map((row) => ({
      id: row.id,
      authorKind: row.authorKind,
      agentId: row.agentId,
      skill: null,
      thinkingSummary: null,
      badges: [],
      citations: [],
      toolCallSummary: null,
      card: row.body,
    })),
    // 项目层不返计数：一个既给内容又给计数的响应，会让「个人层只给计数」
    // 看起来像是少给了点什么，而不是**另一种**答复。
    itemCount: null,
    auditEventId,
  };
}
