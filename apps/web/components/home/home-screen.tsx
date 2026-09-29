"use client";
import Link from "next/link";
import { FolderKanban, MessagesSquare, Shapes, Brain, ArrowRight } from "lucide-react";
import { useSession } from "@/components/session/session-provider";

/**
 * 组织首页 —— 登录后的第一落点（束: home，导航项见 `lib/navigation.ts` 的 `key: "home"`）。
 *
 * 2026-09-29 人类裁决「需要加」（对应 `docs/design/org-home-page/README.md` 未决问题①：
 * 导航要不要真的加一条「首页」——加）。本轮只做**导航项 + 真实页面框架**：
 *   - 组织名 / 显示名读真实 `useSession()`（`session.identity`），不编数字；
 *   - 一句话是静态产品文案，不是「假装可配置」的数据；
 *   - 四个快捷入口链到**真实存在的路由**（/chat /projects /studio/board /brain）。
 *
 * 2026-09-24 人类指令「取消所有的 mockup 的数据」——`docs/design/org-home-page/home.html`
 * 原型里的「最近内容 / 组织公告 / 我的任务 / 邀请团队」四个板块背后都还没有真实接口
 * （组织公告没有后端；最近内容需要跨对象的活动流；邀请卡片需要成员配额实时数据），
 * 本轮**不**用示例数字顶替，留到 README 记录的后续 feature 里接真实数据后再上。
 */
export function HomeScreen(): JSX.Element {
  const session = useSession();
  const orgName = session.identity?.org.name ?? null;
  const displayName = session.identity?.displayName ?? null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8" data-testid="home-screen">
      <section
        className="relative overflow-hidden rounded-container bg-inverse px-8 py-10 text-inverse-foreground shadow-lg"
        aria-label="组织首页横幅"
      >
        <p className="text-11 font-medium uppercase tracking-wide text-inverse-foreground/70">
          {orgName ?? "工作空间"}
        </p>
        <h1 className="mt-2 max-w-lg text-24 font-semibold leading-tight" data-testid="home-greeting">
          {displayName ? `你好，${displayName}` : "欢迎回来"}
        </h1>
        <p className="mt-2 max-w-md text-13 text-inverse-foreground/80">
          在同一个工作面上，和 AI 一起完成一件事。
        </p>
      </section>

      <section aria-label="快捷入口" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HomeQuickAction href="/chat" icon={MessagesSquare} label="对话" desc="开始一次新的对话" />
        <HomeQuickAction href="/projects" icon={FolderKanban} label="项目" desc="按项目组织的工作台" />
        <HomeQuickAction href="/studio/board" icon={Shapes} label="Board" desc="白板与协作" />
        <HomeQuickAction href="/brain" icon={Brain} label="大脑" desc="你的组织记忆" />
      </section>
    </div>
  );
}

function HomeQuickAction({
  href, icon: Icon, label, desc,
}: {
  href: string; icon: typeof MessagesSquare; label: string; desc: string;
}): JSX.Element {
  return (
    <Link
      href={href}
      data-testid={`home-quick-action-${label}`}
      className="group flex flex-col gap-2 rounded-card border border-border-subtle bg-card p-4 shadow-sm transition-shadow duration-fast hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-accent-foreground">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <span className="flex items-center gap-1 text-13 font-medium text-card-foreground">
        {label}
        <ArrowRight aria-hidden className="h-3 w-3 text-muted-foreground transition-transform duration-fast group-hover:translate-x-0.5" />
      </span>
      <span className="text-11 text-muted-foreground">{desc}</span>
    </Link>
  );
}
