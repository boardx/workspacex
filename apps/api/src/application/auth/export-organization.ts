/**
 * `ExportOrganization` (F22) -- O-29 ③「停用期间**仅管理员可导出**」/ UC-1.5 V12 ②.
 *
 * ## ⚠ 这个用例明知故犯地越了 `auth` 的界，理由在这里，登记在契约里
 *
 * domain.md 第零节：「**本束不得自己做权限判定**。一旦它开始判『这个人能不能看 X』，
 * 就有了第二个判定源，而 X-1 的全部工作就是保证只有一个。」
 * 而「仅管理员可导出」就是一条「这个人能不能看 X」。
 *
 * coverage.md 的缺口 A-2 早就把这个两难写下来了：V6 有验收、无操作，
 * identity 束里也没有停用组织的用例，「不定的话 F22 会带着一条无法判定的验收」。
 * 它给的两条路是「补一个操作」或「明确归 phase-03 治理」。
 *
 * 取「补操作 + 大声登记」（契约 `KNOWN_CONTRACT_GAPS.C11`）。既然要越界，
 * 就把越出去的判定收成 `domain/auth/org-lifecycle.ts` 里**一个纯函数**——
 * 散在 controller 与 repository 里的 `if (role !== 'admin')` 才是回不来的那种越界。
 *
 * ## 为什么导出**不看**组织是否停用
 *
 * 直觉是「只有停用的组织才需要导出」。反了：一个只在停用后才存在的能力，
 * 意味着客户要先把自己冻上才能拿到数据——而 O-29 ③ 的整段是在讲
 * 「停用**不是**删除，数据还在、还能拿走」。停用只是让这件事变得紧要，
 * 不是它的前提。而且加一个 `if (status !== 'disabled') deny` 会多出一条
 * 必须永远正确的分支，它挡不住任何人，只会在活跃组织的管理员点导出时报错。
 *
 * ## 返回的是**清单**，这个词是认真的
 *
 * 组织自身的行 + 生命周期 + 每张租户表在本组织下的行数。**一条业务内容都没有**。
 * 真正的内容打包不在 phase-00（契约 `KNOWN_CONTRACT_GAPS.C12`）。
 * 叫它「导出」而返回空内容，才是最坏的做法：验收会绿，用户拿不到数据。
 */
import { auth as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { decideOrgExport } from "../../domain/auth/org-lifecycle";
import { NoOrgMembershipError } from "../identity/errors";
import type { DecisionIdFactory, IdentityRepository } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { OrgLifecycleRepository } from "./ports";

export interface ExportOrgDeps {
  readonly identity: IdentityRepository;
  readonly orgs: OrgLifecycleRepository;
  /** 判定要有 id，否则「为什么被拒/被放行」事后不可回溯（UC-0.3 R6）。 */
  readonly ids: DecisionIdFactory;
}

export type ExportOrgOutput = z.infer<typeof C.operations.exportOrganization.out>;

export async function exportOrganization(
  deps: ExportOrgDeps,
  input: { readonly userId: string; readonly orgId: OrgId },
): Promise<ExportOrgOutput> {
  const membership = await deps.identity.findOrgMembership(input.userId, input.orgId);

  const manifest = await deps.orgs.readExportManifest(input.orgId);
  // 组织不存在。⚠ 与「存在但你不是管理员」返回同一个错误：区分它们会回答
  // 「这个组织存在吗」，而 identity 的 usecases.md 对 NO_PROJECT_ROLE 与
  // 「没有这个项目」用的是同一条理由。
  if (manifest === null) throw new NoOrgMembershipError();

  const decision = decideOrgExport({
    decisionId: deps.ids.next(),
    orgRole: membership?.orgRole ?? null,
    teamId: membership?.teamId ?? null,
  });

  // ⚠ 内容只能从这里出来。`Guarded<T>` 的 payload 在一个模块私有的 WeakMap 里，
  // 除了 permission-filter 谁也拿不到——所以「忘了鉴权」从一个疏漏变成了类型错误。
  const result = discloseDecided(manifest, decision);
  if (!isDisclosed(result)) throw new NoOrgMembershipError();

  const { org, tables } = result.payload;

  return {
    org: {
      id: org.orgId,
      name: org.name,
      kind: org.kind,
      // 组织行本身不带 team；`team` 是**调用者的**成员关系上的字段
      // （switch-organization.ts / resolveIdentity 里同样是在知道成员关系的地方填的）。
      team: membership?.teamId ?? null,
      modelPolicy: org.modelPolicy as "any" | "self-hosted-only",
    },
    lifecycle: {
      status: org.status,
      disabledAt: org.disabledAt?.toISOString() ?? null,
      retentionUntil: org.retentionUntil?.toISOString() ?? null,
    },
    tables: tables.map((t) => ({ table: t.table, rowCount: t.rowCount })),
  };
}
