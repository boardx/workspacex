import { ProjectJoinScreen } from "@/components/project/project-join-screen";
import { ProjectInvitationLanding } from "@/components/project/project-invitation-landing";

/**
 * 项目邀请链接落地页（不套 AppShell：从链接直接进来的过渡页）。
 *   · `/projects/join?t=<token>`      工作坊参与者链接（项目中枢 R2，行为不变）；
 *   · `/projects/join?invite=<token>` 通用项目邀请（#4788，邮件 / 邀请链接）。
 * 两个参数各走各的组件；都带时以通用邀请为准（邮件链接只会带 `invite`）。
 * ⚠ 本文件是服务端组件：只按 searchParams 选组件，不调用任何 "use client" 模块导出的函数。
 */
export default function ProjectJoinPage({ searchParams }: { searchParams: { t?: string; invite?: string } }) {
  const invite = typeof searchParams.invite === "string" && searchParams.invite !== "" ? searchParams.invite : null;
  if (invite !== null) return <ProjectInvitationLanding token={invite} />;
  const token = typeof searchParams.t === "string" && searchParams.t !== "" ? searchParams.t : null;
  return <ProjectJoinScreen token={token} />;
}
