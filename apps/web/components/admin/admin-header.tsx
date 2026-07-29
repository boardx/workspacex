import { Building2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ORG_HEADER } from "@/lib/mock/admin";

/**
 * 后台顶部：组织标识 + 本月组织额度条（常驻在每个模块之上）。
 * 额度接近上限时进度条转 warning——78% 仍在 primary，超 90% 才 warning（阈值见 UC-17.7）。
 */
export function AdminHeader({ moduleLabel }: { moduleLabel: string }) {
  const { name, orgId, quotaUsedWan, quotaTotalWan, quotaPct, daysLeft } = ORG_HEADER;
  const tone = quotaPct >= 90 ? "warning" : "primary";
  return (
    <header data-testid="admin-header" className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-12 font-semibold text-inverse-foreground">
            <Building2 aria-hidden className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-14 font-semibold">{name}</span>
            <span className="font-mono text-10 text-muted-foreground">组织 ID {orgId}</span>
          </div>
          <Badge tone="outline" className="ml-1">{moduleLabel}</Badge>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-1 md:w-64">
          <div className="flex items-baseline justify-between text-11">
            <span className="font-medium">本月组织额度 {quotaPct}%</span>
            <span className="text-muted-foreground">还剩 {daysLeft} 天</span>
          </div>
          <Progress
            value={quotaPct}
            tone={tone}
            label={`本月组织额度 ${quotaPct}%`}
            className="w-full"
          />
          <span className="text-10 text-muted-foreground">
            {quotaUsedWan.toLocaleString()} 万 / {quotaTotalWan.toLocaleString()} 万 tokens
          </span>
        </div>
      </div>
    </header>
  );
}
