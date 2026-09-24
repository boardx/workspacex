// /join/:slug —— UC-04 加入向导（协作层，D13 从公开页 /projects/:slug 的弹窗里搬出）。
// 向导自己读会话（/api/portal/join）并在未登录时给出真实 GitHub 登录链接，所以不进
// middleware 的会话门；公开主机上本路径一律 404（lib/public-host.ts）。
import type { Metadata } from "next";
import { JoinPage } from "@/components/p30/join-page";

export const runtime = "edge";

export const metadata: Metadata = { title: "加入项目 · Developer Portal" };

export default function ProjectJoinPage({ params }: { params: { slug: string } }) {
  return <JoinPage slug={params.slug} />;
}
