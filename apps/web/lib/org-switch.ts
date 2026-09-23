/**
 * 组织切换的**过程**——落地确认的跨页面传递、在途任务的措辞、原型页的 URL 规则。
 *
 * ## 生产路径是什么（先说清楚，因为这里极容易读错）
 * `AppShell` 给 `ShellChrome` 传了 `onSwitchOrganization`，所以生产走的是
 * `session.switchOrganization()` + `router.replace("/projects")`——**客户端导航，
 * 不是整页重载**。`ShellChrome` 里那条 `window.location.assign` 分支只服务于
 * 不带 session 的原型页。我第一遍按「47 个 `<AppShell>` 调用点没有一个传这个 prop」
 * 判成了整页重载，是把调用点的 props 当成了实现——记在这里免得下一个人重犯。
 *
 * ## 为什么落地确认仍然要跨页面存
 * 每个 page 各渲染一个 `<AppShell>`，`router.replace` 换页 = 旧 AppShell 卸载、
 * 新的挂载，React state 不过去。所以确认要落在 sessionStorage 上。
 * 不放 URL：会被复制粘贴出去、被刷新重放，还脏掉一个本该干净的地址。
 * 读写一律吞异常：隐私窗口 / 站点数据被清 / 配额满时访问器会抛。
 */

/**
 * 切换组织时必须丢弃的项目级查询参数——它们的取值只在原组织里有意义。
 * 只有原型页（无 session 的 `window.location.assign` 回落分支）用得到。
 */
export const PROJECT_SCOPED_PARAMS = ["project", "stage", "pack"] as const;

const LANDING_KEY = "wsx.org-switch.landing";

/** 原型页回落分支的目标地址：换掉 `org`，丢掉全部项目级参数，其余原样保留。 */
export function buildOrgSwitchUrl(href: string, orgId: string): string {
  const url = new URL(href);
  url.searchParams.set("org", orgId);
  for (const k of PROJECT_SCOPED_PARAMS) url.searchParams.delete(k);
  return url.toString();
}

export interface OrgSwitchLanding {
  /** 切过去的组织显示名。 */
  readonly toLabel: string;
  /** 离开时还在跑的任务数；0 表示没有。 */
  readonly runsLeftBehind: number;
  /** 离开的那个组织的显示名——「任务还在 X 里跑」这句话要指名道姓。 */
  readonly fromLabel: string;
}

/** 走之前记下，好让重载之后的那一屏能说出「你现在在哪、刚离开哪」。 */
export function rememberOrgSwitch(landing: OrgSwitchLanding): void {
  try {
    window.sessionStorage.setItem(LANDING_KEY, JSON.stringify(landing));
  } catch {
    // 存不下就没有落地确认，切换本身照常——不因为一条提示挡住主路径。
  }
}

/** 切换没成时撤回标记——否则下一次任何跳转都会弹一条「已切换到 X」的假消息。 */
export function forgetOrgSwitch(): void {
  try {
    window.sessionStorage.removeItem(LANDING_KEY);
  } catch {
    // 清不掉就让它被下一次 take 读走；读出来的内容本身是真的，只是时机不对。
  }
}

/** 读一次即清。返回 null = 这次进来不是切换来的（首次打开、刷新、直接敲地址）。 */
export function takeOrgSwitchLanding(): OrgSwitchLanding | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(LANDING_KEY);
    if (raw !== null) window.sessionStorage.removeItem(LANDING_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.toLabel !== "string" || o.toLabel === "") return null;
    return {
      toLabel: o.toLabel,
      fromLabel: typeof o.fromLabel === "string" ? o.fromLabel : "",
      runsLeftBehind: typeof o.runsLeftBehind === "number" && Number.isFinite(o.runsLeftBehind)
        ? Math.max(0, Math.trunc(o.runsLeftBehind))
        : 0,
    };
  } catch {
    return null;
  }
}

/**
 * 切走前那句话。**不吓唬人也不含糊**：任务是服务端队列驱动的
 * （`AgentRunExecutor.kick` + stale 回收），整页重载不会把它们打断，
 * 所以这里说的是「会跑完、在哪找」，不是「可能丢失」。
 */
export function describeRunsLeftBehind(count: number, fromLabel: string): string | null {
  if (count <= 0) return null;
  const where = fromLabel === "" ? "原组织" : `「${fromLabel}」`;
  return `${count} 个任务正在运行。它们会在后台跑完，之后回到${where}就能看到结果。`;
}
