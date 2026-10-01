import { ProjectJoinScreen } from "@/components/project/project-join-screen";

/**
 * 项目邀请链接落地页 `/projects/join?t=<token>`（项目中枢 R2）。
 * 不套 AppShell：这是一个从链接直接进来的过渡页，接受成功即跳进项目。
 */
export default function ProjectJoinPage({ searchParams }: { searchParams: { t?: string } }) {
  const token = typeof searchParams.t === "string" && searchParams.t !== "" ? searchParams.t : null;
  return <ProjectJoinScreen token={token} />;
}
