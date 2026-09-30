"use client";
/**
 * 组织成员 userId → 显示名（`GET /organizations/:orgId/members`，任何成员可读）。
 * 审计表 / 审批抽屉等要把内部 userId 换成人名的地方共用。读失败时返回空表，调用方走兜底文案。
 */
import * as React from "react";
import { listOrgMembers } from "@/lib/live-org-admin";

export function useOrgMemberNames(orgId: string | null | undefined): ReadonlyMap<string, string> {
  const [names, setNames] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  React.useEffect(() => {
    if (!orgId) return;
    let alive = true;
    listOrgMembers(orgId).then(
      (out) => { if (alive) setNames(new Map(out.members.map((m) => [m.userId, m.displayName || m.email]))); },
      () => { /* 成员目录读不到不挡页面 */ },
    );
    return () => { alive = false; };
  }, [orgId]);
  return names;
}

/** userId → 人名；自己加「（我）」；不在目录里的人不回退成内部 id。 */
export function memberLabel(userId: string, me: string | null | undefined, names: ReadonlyMap<string, string>): string {
  const name = names.get(userId);
  if (me && userId === me) return name ? `${name}（我）` : "我";
  return name ?? "已离开组织的成员";
}
