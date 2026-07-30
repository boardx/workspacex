import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ITV_SCREENS, ITV_SCOPES, type ItvScreen, type ScopeId, type ItvView } from "@/lib/mock/itv";

/**
 * 访谈能力域的左侧语义导航 —— 按人类那条链排列（v1 缺的正是「模板」这一层）：
 *   ① 访谈模板库 / 模板编辑器·报告模板
 *   ② 套用模板新建访谈 / 访谈列表
 *   ③ 研究设计 / 质性访谈现场 / 虚拟画像推演访谈
 *   ④⑤ 洞察报告
 * 顶部是范围切换器（UC-6.0）。链是产品心智，导航直接反映它。
 */
export function ItvChainNav({
  screen,
  state,
  scope,
  view,
}: {
  screen: ItvScreen;
  state: string;
  scope: ScopeId;
  view: ItvView;
}) {
  return (
    <nav data-testid="itv-chain-nav" className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-1">
        <span className="text-13 font-semibold text-foreground">访谈 · 用户洞察</span>
        <span className="text-10 text-muted-foreground">独立发起，不依赖项目</span>
      </div>

      {/* 范围切换器（UC-6.0）—— 「不属于任何项目」是一等档 */}
      <div data-testid="itv-scope-switcher" className="flex flex-col gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">范围</span>
        {ITV_SCOPES.map((s) => (
          <a
            key={s.id}
            data-testid={`itv-scope-${s.id}`}
            href={`?screen=${screen}&scope=${s.id}&view=${view}&state=${state}`}
            className={cn(
              "flex items-center justify-between rounded-md border px-2 py-1.5 text-11 transition-colors duration-200",
              scope === s.id
                ? "border-primary/40 bg-accent text-accent-foreground"
                : "border-border-subtle bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            <span className="truncate">{s.label}</span>
            <Badge tone={s.id === "unassigned" ? "outline" : "neutral"}>{s.kind}</Badge>
          </a>
        ))}
      </div>

      {/* 链路屏导航 */}
      <div className="flex flex-col gap-1">
        <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">从模板到洞察报告</span>
        {ITV_SCREENS.map((sc) => (
          <a
            key={sc.id}
            data-testid={`itv-nav-${sc.id}`}
            href={`?screen=${sc.id}&scope=${scope}&view=${view}&state=${state}`}
            className={cn(
              "group flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors duration-200",
              screen === sc.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
            )}
          >
            <span className="flex items-center gap-1.5 text-12 font-medium">
              <span className={cn("text-10", screen === sc.id ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {sc.step}
              </span>
              {sc.label}
            </span>
            <span
              className={cn(
                "text-10",
                screen === sc.id ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              {sc.uc}
            </span>
          </a>
        ))}
      </div>
    </nav>
  );
}
