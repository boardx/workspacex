"use client";
// /join/:slug 的客户端外壳：打开即显示 UC-04 向导；关闭回到项目公开主页（协作主机上的
// /projects/:slug 会被 middleware 308 到公开主机）。
import { JoinWizard } from "@/components/p30/join-wizard";
import { MOCK_PUBLIC_PROJECT } from "@/lib/mock/p30";

export function JoinPage({ slug }: { slug: string }) {
  const name = MOCK_PUBLIC_PROJECT.slug === slug ? MOCK_PUBLIC_PROJECT.name : slug;
  return (
    <JoinWizard
      projectSlug={slug}
      projectName={name}
      onClose={() => {
        window.location.href = `/projects/${encodeURIComponent(slug)}`;
      }}
    />
  );
}
