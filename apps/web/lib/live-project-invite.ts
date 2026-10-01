/**
 * 项目邀请链接（项目中枢 R2）——契约 `orgAdmin.operations.{issueInviteLink, revokeInviteLink,
 * acceptProjectInvite}` 的真实 API 薄封装。
 *
 * ⚠ 服务端 F15 用例拼的 `url` 是原型路径（`/w/<projectId>?t=`），产品里的落地页是
 *   `/projects/join?t=`。前端以响应里的 `token` 自行拼可用链接（`buildProjectInviteLink`），
 *   与 `activation-link.ts` 对组织邀请令牌的做法相同——令牌是唯一权威，URL 只是它的呈现。
 */
import { orgAdmin } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type IssueInviteLinkIn = z.infer<typeof orgAdmin.operations.issueInviteLink.in>;
export type IssueInviteLinkOut = z.infer<typeof orgAdmin.operations.issueInviteLink.out>;
export type RevokeInviteLinkOut = z.infer<typeof orgAdmin.operations.revokeInviteLink.out>;
export type AcceptProjectInviteOut = z.infer<typeof orgAdmin.operations.acceptProjectInvite.out>;
export type ParticipantIdentityChoice = z.infer<typeof orgAdmin.ParticipantIdentityChoice>;
export type InviteLinkValidity = z.infer<typeof orgAdmin.InviteLinkValidity>;

/** 落地页路由（`app/projects/join/page.tsx`）与查询参数名——单一声明处。 */
export const PROJECT_JOIN_PAGE_PATH = "/projects/join";
export const PROJECT_INVITE_TOKEN_PARAM = "t";

export function buildProjectInviteLink(token: string, origin: string): string {
  return `${origin}${PROJECT_JOIN_PAGE_PATH}?${PROJECT_INVITE_TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/** 身份四选的中文标签——契约枚举成员逐个对应（缺键编译期红）。 */
export const PARTICIPANT_IDENTITY_LABEL: Record<ParticipantIdentityChoice, string> = {
  member: "组员",
  groupLead: "组长",
  observer: "观察者（只读）",
  coFacilitator: "协同引导师",
};

export const INVITE_LINK_VALIDITY_LABEL: Record<InviteLinkValidity, string> = {
  "24h": "24 小时",
  "7d": "7 天",
  once: "一次性",
};

function projectPath(template: string, projectId: string): string {
  return template.replace(":projectId", encodeURIComponent(projectId));
}

export async function issueProjectInviteLink(input: IssueInviteLinkIn): Promise<IssueInviteLinkOut> {
  return apiRequest<IssueInviteLinkOut>(
    projectPath(orgAdmin.operations.issueInviteLink.path, input.projectId),
    { method: "POST", body: input },
  );
}

/** `linkId: null` = `[重置全部]`。 */
export async function revokeProjectInviteLinks(projectId: string, linkId: string | null): Promise<RevokeInviteLinkOut> {
  return apiRequest<RevokeInviteLinkOut>(
    projectPath(orgAdmin.operations.revokeInviteLink.path, projectId),
    { method: "POST", body: { projectId, linkId } },
  );
}

export async function acceptProjectInvite(token: string): Promise<AcceptProjectInviteOut> {
  return apiRequest<AcceptProjectInviteOut>(
    orgAdmin.operations.acceptProjectInvite.path,
    { method: "POST", body: { token } },
  );
}
