/**
 * 进场类页面的外层——**刻意不套 `AppShell`**。
 *
 * 登录 / 链接落地 / 受访者同意书 / 小组工作台，面对的是**未登录成员**或**外部人员**：
 * 三栏工作台骨架（图标栏 / 五段导航 / 组织切换器）对他们既无意义也不该出现。
 * 这里只提供一个居中的中性底，业务屏各自决定内容宽度与七态渲染。
 */
export default function EntryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-background-foreground" data-testid="entry-root">
      {children}
    </div>
  );
}
