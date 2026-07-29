/**
 * 组织停用 / 只读降级的**纯规则**（F22 / O-29 ③、O-12）。
 *
 * 没有时钟、没有 I/O：`now` 一律由调用方传入，与 `lockout.ts` 同样的理由——
 * 「留存期是从停用那一刻算的」这句话，只有当时间是入参时才断言得了。
 */
import { auth as C } from "@repo/contracts";
import type { PermissionDecision } from "../identity/permission-decision";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 留存截止时间 = 停用时刻 + 留存期。
 *
 * ⚠ 这里是**唯一**一处把「180」变成日期的地方，而 180 本身来自
 * `AUTH_POLICY.orgRetentionDays`（契约，全仓唯一副本，出处 O-01 材料保留期）。
 * 迁移里刻意没有 `DEFAULT now() + interval '180 days'`：那会是第二份副本，
 * 而漂移方向是「TS 改了、SQL 没改」，两边都不报错。
 */
export function retentionUntil(disabledAt: Date): Date {
  return new Date(disabledAt.getTime() + C.AUTH_POLICY.orgRetentionDays * DAY_MS);
}

/**
 * 「仅管理员可导出」——O-29 ③ 的那半句，收敛成一个纯函数。
 *
 * ## ⚠ 这条判定在 `auth` 里，而 domain.md 第零节说本束不做权限判定
 *
 * 这是**如实越界**，不是没读到那条规则。coverage.md 的缺口 A-2 早就预告了这个两难：
 * V6「组织停用只读降级，仅管理员可导出」**有验收、无操作**，
 * 而 identity 束里也没有停用组织的用例。A-2 给的两条路是
 * 「补一个操作」或「明确归 phase-03 治理」，留着就是一条判不了的验收。
 *
 * 取「补操作 + 大声登记」（契约 `KNOWN_CONTRACT_GAPS.C11`）。既然要越界，
 * 就把越出去的部分**收成一个纯函数、一处**——散在 controller 与 repository 里的
 * `if (role !== 'admin')` 才是真正回不来的那种越界。
 *
 * ⚠ `compliance` 不算：D-18「管理员不是超级用户」的对偶——合规负责人对整个组织的
 * 合规负责（可查审计链、留存与撤回队列），但**不因此获得内容读取权**（UC-0.3 R7）。
 * 导出是把组织的数据整包拿走，那是内容读取的最强形式。
 * 需要给合规单开一条导出路径的话，那是 phase-03 治理的事，不是在这里悄悄加一个 `||`。
 */
export function canExportOrganization(orgRole: string | null): boolean {
  return orgRole === "admin";
}

/**
 * 上面那条规则的 `PermissionDecision` 形式，供 `discloseDecided` 使用。
 *
 * ## 为什么导出要走 `Guarded<T>` 那道门
 *
 * 组织清单是租户数据，`lint-permission-paths` 对读它的文件的要求只有一条：
 * 走 `application/security/permission-filter` 那**唯一**的门。
 * 这不是为过 lint 而套的壳——permission-filter 的文件头写得很清楚：
 * 「两个门之间，没人看的那个会漏」。F02 与 F03 并行时各自建了一套机制，
 * 两套单独跑都是绿的，合并才暴露。
 *
 * ## 为什么是 `discloseDecided` 而不是 `disclose`
 *
 * `disclose` 通过 `authorize` 判定，而 `authorize` 判的是「组织成员 ∧ 项目角色 ∧ scope」——
 * 对组织导出它会给出 `allowed: true` **给每一个成员**（没有 binding 行 ⇒ 落到宽松默认 scope）。
 * 也就是说走 `disclose` 会把「仅管理员」判成「任何人」，而且判定对象看起来完全正常。
 * `discloseDecided` 正是为这种「`authorize` 表达不了的更严规则」准备的（F03 的
 * `decideContentRead` 是同一类），代价是它无法校验规则本身对不对——所以规则在 domain 里，
 * 被直接测试。
 *
 * ⚠ `projectLayer` 恒为 null：导出是**组织层**的动作，没有项目上下文（不变量 I-11）。
 * 填一个假的项目层会让「为什么被拒」指向用户根本改不了的地方。
 */
export function decideOrgExport(input: {
  readonly decisionId: string;
  readonly orgRole: string | null;
  readonly teamId: string | null;
}): PermissionDecision {
  const allowed = canExportOrganization(input.orgRole);
  const orgLayer = {
    role: (input.orgRole ?? null) as PermissionDecision["orgLayer"]["role"],
    teamId: input.teamId,
    passed: allowed,
  };
  return {
    allowed,
    orgLayer,
    projectLayer: null,
    scopeLayer: { scope: "org-wide" as const, passed: allowed },
    /**
     * ⚠ 非成员与「是成员但不是管理员」用**同一个** reasonCode。
     * 分开会回答「这个组织存在吗 / 你在不在里面」，而 identity 的 usecases.md 对
     * `NO_PROJECT_ROLE` 与「没有这个项目」用的是同一条理由。
     */
    reasonCode: allowed ? null : "NO_ORG_MEMBERSHIP",
    decisionId: input.decisionId,
  };
}

/**
 * 组织是否处于只读降级。
 *
 * ⚠ 库层的 RLS 才是**强制**（迁移 0012），这个函数只是给界面用的同一事实的读法——
 * 它存在的理由是「顶部常驻『组织已停用·只读』条」需要一个可读的答案，
 * 而**不是**为了在 application 里再判一次「这次写要不要放行」。
 * 真去在 application 里挡写，就会有两个判定源，而漏掉的那个总是新加的路由。
 */
export function isReadOnly(status: string): boolean {
  return status === "disabled";
}
