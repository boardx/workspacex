/**
 * 项目邀请邮件的正文（中文，纯文本——`TransactionalMailTransport` 目前只收 `subject` + `text`）。
 *
 * 内容由用例层拼好再交给端口（端口不含任何业务文案，见 `transactional-mail-ports.ts`）。
 * 接受链接 `${APP_PUBLIC_URL}/projects/join?invite=<token>`：参数名 `invite` 与工作坊邀请链接的
 * `t` 区分开，同一个落地页据此分流，互不影响。
 */

export interface InvitationMailInput {
  readonly projectName: string;
  readonly inviterName: string;
  readonly appPublicUrl: string;
  readonly token: string;
  readonly expiresAt: Date;
}

/** 去掉控制字符（尤其换行）——名字会进邮件主题，不许借它注入头部。 */
function singleLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

export function buildInviteUrl(appPublicUrl: string, token: string): string {
  return `${appPublicUrl.replace(/\/+$/, "")}/projects/join?invite=${encodeURIComponent(token)}`;
}

/** 「2026年10月7日 18:30（北京时间）」。手算 UTC+8，不依赖运行时的 ICU / 时区配置。 */
export function formatBeijingTime(d: Date): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}年${t.getUTCMonth() + 1}月${t.getUTCDate()}日 ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}（北京时间）`;
}

export function buildInvitationMail(input: InvitationMailInput): { subject: string; text: string } {
  const project = singleLine(input.projectName);
  const inviter = singleLine(input.inviterName);
  const url = buildInviteUrl(input.appPublicUrl, input.token);
  return {
    subject: `${inviter} 邀请你加入项目「${project}」`,
    text: [
      `${inviter} 邀请你加入 WorkSpaceX 项目「${project}」。`,
      "",
      "点击下面的链接接受邀请：",
      url,
      "",
      `这条邀请将在 ${formatBeijingTime(input.expiresAt)} 过期，并且只能用于收到这封邮件的邮箱。`,
      "如果你不认识邀请人，可以直接忽略这封邮件。",
    ].join("\n"),
  };
}

/** 「已被加入项目」的站内通知文案（`addNonWorkshopMember` 之后尽力而为地发）。 */
export function buildMemberAddedNotice(input: { projectName: string; inviterName: string; role: "owner" | "collaborator" }): {
  title: string;
  body: string;
} {
  const project = singleLine(input.projectName);
  const inviter = singleLine(input.inviterName);
  const roleText = input.role === "owner" ? "负责人" : "协作者";
  return {
    title: `你已被加入项目「${project}」`,
    body: `${inviter} 把你加入了项目「${project}」，你的身份是${roleText}。`,
  };
}
