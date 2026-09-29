import * as React from "react";
import { WorkspaceXWordmark } from "@/components/shell/workspacex-logo";
import { Metamorphosis } from "@/components/entry/metamorphosis";

/**
 * 认证类进场页（登录 / 注册 / 找回密码 / 邮箱验证 / 邀请激活）的统一外壳。
 *
 * 之前每个页面各自写一套 `min-h-screen` 居中卡片、各自决定有没有品牌露出——登录页是
 * 带模拟数据（「全球 N 个战略问题」、AI 活动流）的两栏，其余页面干脆没有 logo。
 * 这里收敛成一处：宽屏左侧品牌栏（官方 logo + 一句定位 + 「蜕变」蝴蝶动画），右侧表单区；
 * 窄屏只保留表单区，logo 移到表单上方。页面只负责标题与表单内容。
 *
 * ⚠ 品牌栏只放产品事实，不放会被误读成实时数据的数字或活动流。
 */
export function AuthShell({
  title,
  description,
  icon,
  children,
  footer,
  aside,
  testId,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 标题左侧的状态图标（验证中 / 成功 / 失败等），纯表单页不需要。 */
  icon?: React.ReactNode;
  children?: React.ReactNode;
  /** 表单下方的次要链接或说明。 */
  footer?: React.ReactNode;
  /** 表单区顶部的附加内容（如 dev 七态预览条），生产环境通常为空。 */
  aside?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex min-h-screen w-full bg-background" data-testid="auth-shell">
      <BrandPanel />
      <main className="flex min-h-screen flex-1 flex-col bg-card px-6 py-8 sm:px-10">
        {aside ? <div className="mx-auto w-full max-w-sm">{aside}</div> : null}
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-8">
          <WorkspaceXWordmark className="-ml-2 h-14 w-auto self-start lg:hidden" />
          <section className="flex flex-col gap-6" data-testid={testId}>
            <header className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                {icon}
                <h1 className="text-24 font-semibold tracking-tight">{title}</h1>
              </div>
              {description ? <p className="text-13 text-muted-foreground">{description}</p> : null}
            </header>
            {children}
          </section>
          {footer ? <div className="text-12 text-muted-foreground">{footer}</div> : null}
        </div>
        <p className="mx-auto w-full max-w-sm text-11 text-muted-foreground lg:hidden">
          © WorkspaceX
        </p>
      </main>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside
      className="hidden w-5/12 max-w-xl flex-col justify-between border-r border-border-subtle bg-panel-alt p-12 lg:flex"
      data-testid="auth-brand"
    >
      <WorkspaceXWordmark className="-ml-3 h-20 w-auto self-start" />
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <h2 className="text-30 font-semibold leading-tight tracking-tight">
            AI 原生的团队协作与知识工作空间
          </h2>
          <p className="text-14 text-muted-foreground">和你的 AI 团队一起，把最难的问题拆开。</p>
        </div>
        <Metamorphosis />
      </div>
      <p className="text-11 text-muted-foreground">© WorkspaceX</p>
    </aside>
  );
}
