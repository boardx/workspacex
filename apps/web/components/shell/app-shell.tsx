"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { IconRail } from "./icon-rail";
import { TopBar } from "./top-bar";
import { MobileTabs } from "./mobile-tabs";
import { isLocalOrg, MOCK_ORGS, type Identity, type ProjectRole } from "@/lib/identity";
import { EditionBanner } from "./edition-banner";
import { MAIN_CONTENT_ID, SkipToContent } from "./skip-to-content";
import { organizationLabel } from "@/lib/org-display";
import { cn } from "@/lib/utils";
import { useOptionalSession, type SessionContextValue } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { FeedbackProvider } from "@/components/feedback/feedback-provider";
import { SHELL_RIGHT_PANEL_TOGGLE_EVENT } from "@/lib/shell-panel-events";
import { sanitizeReturnTo } from "@/lib/return-to";
import { buildOrgSwitchUrl, forgetOrgSwitch, rememberOrgSwitch, takeOrgSwitchLanding, type OrgSwitchLanding } from "@/lib/org-switch";
import { ShellBusyProvider, useShellBusyCount } from "@/lib/shell-busy";
import {
  OrgSwitchConfirm, OrgSwitchFailed, OrgSwitchLanded, OrgSwitchProgress,
  shouldConfirmOrgSwitch, type PendingOrgSwitch,
} from "./org-switch-feedback";

/**
 * 三栏骨架 —— 尺寸来自原型实测：
 *   图标栏 76px ｜ 左栏 272px ｜ 中栏 flex ｜ 右栏 300px
 * 这是**已确认的产品心智**，业务屏只填充三个栏位，不要另起布局（UC-0.4 R7）。
 *
 * 响应式（实测原型「同一信息架构，三栏折叠为三层」）：
 *   ≥xl  四栏全开
 *   ≥md  收起右栏（上下文包与证据栏），中栏拿到宽度
 *   <md  收起图标栏与左右栏，改用底部一级 tab；顶部条与中栏保留
 * 三档（375 / 768 / 1280）都不得出现横向溢出（uiux-standards U8 / UC-0.4 R12 V9）。
 *
 * ⚠ `hideRoleSwitcher`（2026-07-30）：当**本页内容区自带角色/视角切换器**时置 true，
 *   顶栏就不再渲染它自己的预览切换器——避免「同一页两套角色切换系统」。
 *   角色切换的唯一来源 = 各域内容区自带的切换器；顶栏只负责组织切换 + 上下文标签。
 *
 * ⚠ 「底部环境态条」（`AmbientBar`，2026-07-30 起 `shell-ambient`）已于 #752 移除：
 *   它曾是全局硬编码假数据（固定「28:14」/固定发言人/固定 agent 进度），与任何真实
 *   会话/线程无关，在 admin/tpl/skill 等非现场屏也照样显示。真实的转录与进度状态
 *   已经由线程内的 `chat-transcript-*` 卡片（`components/chat/**`）承载——那里才有
 *   真实的 `recording`/`wave2Runtime` 数据可读。壳层这一级拿不到「当前是否有活跃
 *   录音/agent run」的真实信号，所以不再在这一层渲染任何等价内容，也不留占位符。
 */
export function AppShell({
  identity, previewRole, left, right, children, hideRoleSwitcher, hideTopBar, fullscreen,
}: {
  /** Legacy prototype screens may still provide an explicit projection; authenticated routes omit it. */
  identity?: Identity;
  previewRole: ProjectRole | null;
  left?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  /** 本页自带角色/视角切换器时置 true，顶栏让位不再出第二套 */
  hideRoleSwitcher?: boolean;
  /** 沉浸式工作台可隐藏横向顶栏，仅保留全局图标栏。 */
  hideTopBar?: boolean;
  /** Canvas workspace: retain session gating while removing navigation chrome. */
  fullscreen?: boolean;
}) {
  const session = useOptionalSession();
  // `ShellBusyProvider` 包在最外：壳层要读的那个数字由 `children` 里正在跑的那一方登记
  // （`useReportShellBusy`），所以 Provider 必须同时罩住壳层自己和 children。
  if (identity) {
    return (
      <ShellBusyProvider>
        <ShellChrome identity={identity} previewRole={previewRole} left={left} right={right} hideRoleSwitcher={hideRoleSwitcher} hideTopBar={hideTopBar} fullscreen={fullscreen}>
          {children}
        </ShellChrome>
      </ShellBusyProvider>
    );
  }
  if (!session) throw new Error("Authenticated AppShell requires SessionProvider");
  return (
    <ShellBusyProvider>
      <SessionAppShell session={session} previewRole={previewRole} left={left} right={right} hideRoleSwitcher={hideRoleSwitcher} hideTopBar={hideTopBar} fullscreen={fullscreen}>
        {children}
      </SessionAppShell>
    </ShellBusyProvider>
  );
}

function SessionAppShell({
  session, previewRole, left, right, children, hideRoleSwitcher, hideTopBar, fullscreen,
}: {
  session: SessionContextValue;
  previewRole: ProjectRole | null;
  left?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  hideRoleSwitcher?: boolean;
  hideTopBar?: boolean;
  /** Canvas workspace: retain session gating while removing navigation chrome. */
  fullscreen?: boolean;
}) {
  const router = useRouter();

  // ⚠ 画布模板后台管理刷新掉回根目录一案：这里此前是 `router.replace("/login")`，
  // 深链（如 `/canvas/template-admin`）在跳转中丢失，登录/恢复会话后
  // 一律落到 `/projects`，用户体感就是"刷新就退回根目录"。现在把当前 URL
  // （路径 + 查询串）编码进 `?next=`，`LoginSessionGate` 与 `LoginForm` 登录
  // 成功后据此跳回原页——见 `lib/return-to.ts` 头注。
  React.useEffect(() => {
    if (session.status !== "anonymous") return;
    const current = `${window.location.pathname}${window.location.search}`;
    const next = sanitizeReturnTo(current);
    router.replace(next === "/projects" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
  }, [router, session.status]);

  if (session.status === "loading" || session.status === "anonymous") {
    return <SessionState testId="session-loading">正在确认登录状态…</SessionState>;
  }
  if (session.status === "dependency-failed" || !session.identity || !session.session) {
    return (
      <SessionState testId="session-dependency-failed">
        <p>身份服务暂时不可用，登录状态已保留。</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void session.retry()}>重试</Button>
          <Button size="sm" variant="ghost" onClick={async () => { await session.logout(); router.replace("/login"); }}>
            退出登录
          </Button>
        </div>
      </SessionState>
    );
  }

  // #596：名字由 SessionProvider 逐个组织解析（见 `SessionContextValue.organizations`）。
  // 这里**只做投影，不再自己拼 label** —— 旧写法是 `id === 当前组织 ? name : id`，
  // 等于宣布「除当前组织外，一律拿裸 ID 冒充名称」。
  const organizations = session.organizations.map((org) => ({ id: org.id, label: organizationLabel(org) }));

  return (
    <ShellChrome
      identity={session.identity}
      previewRole={previewRole}
      left={left}
      right={right}
      hideRoleSwitcher={hideRoleSwitcher}
      hideTopBar={hideTopBar}
      fullscreen={fullscreen}
      organizations={organizations}
      onSwitchOrganization={async (orgId) => {
        await session.switchOrganization(orgId);
        router.replace("/projects");
      }}
      onLogout={async () => {
        await session.logout();
        router.replace("/login");
      }}
    >
      {children}
    </ShellChrome>
  );
}

function SessionState({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId} className="flex h-dvh items-center justify-center bg-background p-6 text-13 text-muted-foreground">
      <div className="flex flex-col items-center gap-3">{children}</div>
    </div>
  );
}

/**
 * 导出仅为了让切换体感的测试能按**生产那条路的形状**驱动它：
 * 生产走的是 `SessionAppShell` → `ShellChrome` 并带上 `onSwitchOrganization`，
 * 而 `AppShell` 自己不接这个 prop。拿 `AppShell` + mock 回落去测，测到的是
 * `window.location.assign` 那条原型分支，不是用户真正走的那条。
 */
export function ShellChrome({
  identity, previewRole, left, right, children, hideRoleSwitcher, hideTopBar, fullscreen,
  organizations, onSwitchOrganization, onLogout,
}: {
  identity: Identity;
  previewRole: ProjectRole | null;
  left?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  hideRoleSwitcher?: boolean;
  hideTopBar?: boolean;
  /** Canvas workspace: retain session gating while removing navigation chrome. */
  fullscreen?: boolean;
  organizations?: ReadonlyArray<{ id: string; label: string }>;
  onSwitchOrganization?: (orgId: string) => Promise<void>;
  onLogout?: () => void;
}) {
  const [switching, setSwitching] = React.useState(false);
  // organizations 未传（旧版 identity 直传原型页）时回落到 mock 列表——
  // 这段回落原先住在 TopBar 的 OrgSwitcher 里，切换器并入左上角组织菜单
  //（2026-08-11 信息架构调整）后上提到壳层，rail 与 <md 顶栏两个菜单实例共用一份。
  const effectiveOrganizations = React.useMemo<ReadonlyArray<{ id: string; label: string }>>(
    () => organizations ?? MOCK_ORGS.map((o) => ({ id: o.id, label: isLocalOrg(o) ? `🔒 ${o.name}（本地）` : o.name })),
    [organizations],
  );
  /**
   * 切换的三段体感。**顺序是刻意的**：先问（只在有活在跑时），再遮（盖住旧组织的
   * 内容并说正在切到哪），最后在新页面上确认落地。
   *
   * 落地标记在 await **之前**写、失败时撤回——不是之后写。`onSwitchOrganization`
   * 内部成功后立刻 `router.replace`，await 一返回新页面就可能已经在挂载了，
   * 那时候再写标记就是跟新 AppShell 的读抢时序。
   */
  const busyCount = useShellBusyCount();
  const [pendingSwitch, setPendingSwitch] = React.useState<PendingOrgSwitch | null>(null);
  const [switchingTo, setSwitchingTo] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<PendingOrgSwitch | null>(null);
  const [landing, setLanding] = React.useState<OrgSwitchLanding | null>(null);

  /**
   * `prev ?? ` 不是防御性写法，是修一个真 bug。React 严格模式（dev）把 effect 跑两次：
   * 第一次 `takeOrgSwitchLanding()` 读走并清掉标记、置位；第二次读到 null，
   * 直接 `setLanding(null)` 就把刚拿到的落地信息**覆盖掉了**——实测现象是切换完成、
   * 标记确实被消费了，而那条「已切换到 X」从来没出现过。jsdom 测试看不见这个：
   * RTL 默认不套 StrictMode。
   *
   * 为什么不改成「模块级缓存，同一次页面加载返回同一个答案」：换路由时 AppShell 会
   * 真的重新挂载，那时候该读到 null（不该再弹一次），缓存会让它重弹。
   * 严格模式的双调用保留 state，真重挂载不保留——`prev ?? ` 正好区分这两件事。
   *
   * 为什么依赖 `identity.org.id` 而不是空数组：用户**本来就在 `/projects`** 时
   * `router.replace("/projects")` 不换页、也不重挂载 AppShell，只挂载时读一次的写法
   * 在这条路上永远读不到——那条确认会一直躺在 sessionStorage 里，等之后某次不相干的
   * 跳转才弹出来，变成一条过时的假消息。组织 id 变的那一刻，才是「你现在在 X」成立的时刻。
   */
  const lastOrgIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const orgId = identity.org.id;
    const orgChanged = lastOrgIdRef.current !== null && lastOrgIdRef.current !== orgId;
    lastOrgIdRef.current = orgId;
    // 组织真的变了 ⇒ 重新读一次（这一刻才是「你现在在 X」成立的时刻）；
    // 否则是首次挂载 ⇒ `prev ??` 保护严格模式的双调用（见上）。
    setLanding((prev) => (orgChanged ? takeOrgSwitchLanding() ?? prev : prev ?? takeOrgSwitchLanding()));
  }, [identity.org.id]);

  const currentOrgLabel = React.useMemo(
    () => effectiveOrganizations.find((o) => o.id === identity.org.id)?.label ?? identity.org.name ?? "",
    [effectiveOrganizations, identity.org.id, identity.org.name],
  );

  const runSwitch = React.useCallback((target: PendingOrgSwitch) => {
    setPendingSwitch(null);
    setFailed(null);
    if (onSwitchOrganization) {
      setSwitching(true);
      setSwitchingTo(target.toLabel);
      rememberOrgSwitch({
        toLabel: target.toLabel,
        fromLabel: target.fromLabel,
        runsLeftBehind: target.runsInFlight,
      });
      void onSwitchOrganization(target.orgId)
        .catch(() => {
          forgetOrgSwitch();   // 切换没成，别让下一次跳转弹出一条「已切换到 X」的假消息
          setSwitchingTo(null);
          setFailed(target);   // 静默失败 = 用户只会再点一次；说出来并给一次重试
        })
        .finally(() => setSwitching(false));
      return;
    }
    // 原型页（无 session）回落：O-12 —— 切组织 = 清空全部项目级上下文，权限重新求值。
    setSwitchingTo(target.toLabel);
    rememberOrgSwitch({
      toLabel: target.toLabel,
      fromLabel: target.fromLabel,
      runsLeftBehind: target.runsInFlight,
    });
    window.location.assign(buildOrgSwitchUrl(window.location.href, target.orgId));
  }, [onSwitchOrganization]);

  const handleSwitchOrganization = React.useCallback((orgId: string) => {
    const target: PendingOrgSwitch = {
      orgId,
      toLabel: effectiveOrganizations.find((o) => o.id === orgId)?.label ?? orgId,
      fromLabel: currentOrgLabel,
      runsInFlight: busyCount,
    };
    if (shouldConfirmOrgSwitch(target.runsInFlight)) {
      setPendingSwitch(target);
      return;
    }
    runSwitch(target);
  }, [busyCount, currentOrgLabel, effectiveOrganizations, runSwitch]);

  /*
   * FB-2：反馈弹层的唯一实例挂在壳层，因为它的三个入口分属三处
   * （图标栏 / <md 顶栏 / chat 里每个 agent·skill 一个按钮），而弹层只该有一个。
   * 见 `components/feedback/feedback-provider.tsx` 头注。
   *
   * UC-17.8 D5（2026-09-04）曾把原型 mock store 的 Provider 上提到这里，让弹层里
   * 「去 PM 设计工作台」入口在 chat / 顶栏 / 图标栏三处都可见；B6.1（2026-09-05）三屏
   * 全部真栈化后该 store 整个删掉，入口改成恒可见的纯路由跳转，壳层不再挂任何原型 Provider。
   */
  /**
   * UIUX-CK-1（人类实测 3 分的第一条实锤，2026-08-23）：左右栏此前固定宽度、
   * 不可收起——右栏在 xl 以下整个消失，xl 以上永远占位。加收起/展开 toggle，
   * 状态记忆在 localStorage（每人自己的工作习惯，不是服务端事实，不入库）。
   * 读取放 effect：SSR 无 localStorage，初始渲染两端必须一致，否则 hydration 警告。
   */
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [rightCollapsed, setRightCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setLeftCollapsed(window.localStorage.getItem("shell.leftCollapsed") === "1");
      setRightCollapsed(window.localStorage.getItem("shell.rightCollapsed") === "1");
    } catch { /* 隐私模式等拿不到 storage：保持默认展开 */ }
  }, []);
  const togglePanel = (side: "left" | "right") => {
    const next = side === "left" ? !leftCollapsed : !rightCollapsed;
    (side === "left" ? setLeftCollapsed : setRightCollapsed)(next);
    try { window.localStorage.setItem(`shell.${side}Collapsed`, next ? "1" : "0"); } catch { /* 同上 */ }
  };

  /*
   * D4（chat-main-fidelity-rubric.md）—— 业务屏（线程头部）没有办法触发这里的折叠
   * 状态：此前只有本组件自己画的 `shell-right-collapse` 按钮能切换右栏，参照原型
   * 要求线程头部本身也要有一枚可辨识的「侧栏」按钮。两边不共享 React 树（`AppShell`
   * 在部分单测里整体被 mock），改听一个 `window` 自定义事件——见
   * `lib/shell-panel-events.ts` 头注，事件只是"触发点"，折叠状态本身仍只活在这里。
   */
  React.useEffect(() => {
    const handler = () => togglePanel("right");
    window.addEventListener(SHELL_RIGHT_PANEL_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(SHELL_RIGHT_PANEL_TOGGLE_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightCollapsed]);

  return (
    <FeedbackProvider>
    <div data-testid="app-shell" className="relative flex h-dvh w-full overflow-hidden bg-background">
      {/*
        键盘用户的第一条快捷路，必须是壳层里第一个可聚焦的东西。
        实测真实安装版：可聚焦元素 124 个，消息输入框排在第 113 位——
        键盘用户要按 113 次 Tab 才能开始打字。见该组件头注。
      */}
      <SkipToContent />
      {!fullscreen && <div className="hidden md:flex">
        <IconRail
          identity={identity}
          organizations={effectiveOrganizations}
          onSwitchOrganization={handleSwitchOrganization}
          switching={switching}
          avatarInitial={identity.displayName.slice(0, 1)}
          onLogout={onLogout}
        />
      </div>}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          2026-09-22 —— 版次标识条。「不受 `hideTopBar` 影响」：藏顶栏的页面（如全屏画布）
          普通 hideTopBar 保留版次信息；fullscreen 为用户明确要求的全窗口画布，隐藏全部导航占位。
        */}
        {!fullscreen && <EditionBanner />}
        {!fullscreen && !hideTopBar && (
          <TopBar
            identity={identity}
            previewRole={previewRole}
            hideRoleSwitcher={hideRoleSwitcher}
            organizations={effectiveOrganizations}
            onSwitchOrganization={handleSwitchOrganization}
            switching={switching}
          />
        )}
        <div className="flex min-h-0 flex-1">
          {left && !leftCollapsed && (
            <aside
              data-testid="shell-left-panel"
              className="relative hidden w-panel shrink-0 overflow-y-auto border-r border-border bg-panel md:block"
            >
              <button
                type="button"
                aria-label="收起左栏"
                data-testid="shell-left-collapse"
                onClick={() => togglePanel("left")}
                className="absolute right-1 top-1 z-10 hidden h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground md:flex"
              >
                ‹
              </button>
              {left}
            </aside>
          )}
          {left && leftCollapsed && (
            <button
              type="button"
              aria-label="展开左栏"
              data-testid="shell-left-expand"
              onClick={() => togglePanel("left")}
              className="hidden w-5 shrink-0 items-center justify-center border-r border-border bg-panel text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground md:flex"
            >
              ›
            </button>
          )}
          {/* id 来自 `skip-to-content.tsx`，是跳转链接的落点。那份 id 只声明在那一处。 */}
          <main id={MAIN_CONTENT_ID} data-testid="shell-main" className="min-w-0 flex-1 overflow-y-auto bg-card">
            {children}
          </main>
          {right && !rightCollapsed && (
            <aside
              data-testid="shell-right-panel"
              className={cn("relative hidden w-panel-alt shrink-0 overflow-y-auto border-l border-border bg-panel-alt xl:block")}
            >
              {/*
                D9（chat-main-fidelity-rubric.md）—— 此前这颗按钮画在 `left-1 top-1`，
                与 `ChatArtifactsPanel` 头部左侧的「产物」包裹图标（`Package` + 文字）
                同一格重叠，放大截图后判不出任何「›」/「×」字形（两个小图标叠在一起
                互相吃掉了可辨识的轮廓）。挪到右上角，避开任何面板自己的头部图标；
                字符「›」换成 lucide `X`（真的 × 字形，明确表达「关闭/收起整个右栏」），
                加边框与背景保证在任何面板底色上都有对比度。
              */}
              <button
                type="button"
                aria-label="收起右栏"
                data-testid="shell-right-collapse"
                onClick={() => togglePanel("right")}
                className="absolute right-1 top-1 z-10 hidden h-6 w-6 items-center justify-center rounded border border-border bg-panel-alt text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-background-foreground xl:flex"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
              {right}
            </aside>
          )}
          {right && rightCollapsed && (
            <button
              type="button"
              aria-label="展开右栏"
              data-testid="shell-right-expand"
              onClick={() => togglePanel("right")}
              className="hidden w-5 shrink-0 items-center justify-center border-l border-border bg-panel-alt text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground xl:flex"
            >
              ‹
            </button>
          )}
        </div>
        {!fullscreen && <MobileTabs />}
      </div>
      {/*
        切换的三段体感挂在壳层最外层，不挂在组织菜单里：菜单一点就关，
        而这三样东西要在菜单消失之后、跨越一次换页继续说话。
      */}
      {pendingSwitch !== null && (
        <OrgSwitchConfirm
          pending={pendingSwitch}
          onConfirm={() => runSwitch(pendingSwitch)}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
      {switching && switchingTo !== null && <OrgSwitchProgress toLabel={switchingTo} />}
      {failed !== null && !switching && (
        <OrgSwitchFailed
          toLabel={failed.toLabel}
          onRetry={() => runSwitch({ ...failed, runsInFlight: busyCount })}
          onDismiss={() => setFailed(null)}
        />
      )}
      {landing !== null && (
        <OrgSwitchLanded
          toLabel={landing.toLabel}
          fromLabel={landing.fromLabel}
          runsLeftBehind={landing.runsLeftBehind}
          onDismiss={() => setLanding(null)}
        />
      )}
    </div>
    </FeedbackProvider>
  );
}
