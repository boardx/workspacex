import { Eye, KeyRound, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  VISIBILITY_LABEL, MCP_AUTH_LABEL, MCP_REVIEW_LABEL,
  type VisibilityScope, type McpAuthScope, type McpReviewStatus,
} from "@/lib/mock/admin";

/**
 * 三个**刻意长得不一样**的徽标 —— 让两套枚举在界面上就是两回事（UC-0.3 R7 / UC-21.1 O-20）。
 *
 *  · VisibilityBadge（可见性范围）：眼睛图标 + 前缀「可见性」—— 「谁能看到/用这个能力」
 *  · AuthScopeBadge（MCP 授权范围）：钥匙图标 + 前缀「授权」—— 「谁能调用这台服务器的工具」
 *  · ReviewBadge（评审状态）：盾牌图标，与授权范围**并列但独立**呈现，证明它们正交。
 *
 * 三者用不同图标、不同前缀词、不同色，避免被误读为同一个字段。
 */

/** ① 可见性范围 —— 眼睛 · 前缀「可见性」 */
export function VisibilityBadge({
  scope, team, "data-testid": testId,
}: { scope: VisibilityScope; team?: string; "data-testid"?: string }) {
  const label = scope === "team" && team ? `${VISIBILITY_LABEL.team}（${team}）` : VISIBILITY_LABEL[scope];
  return (
    <Badge tone={scope === "org" ? "primary" : "neutral"} data-testid={testId}>
      <Eye aria-hidden className="h-3 w-3" />
      可见性 · {label}
    </Badge>
  );
}

/** ② MCP 授权范围 —— 钥匙 · 前缀「授权」 */
export function AuthScopeBadge({
  scope, team, "data-testid": testId,
}: { scope: McpAuthScope; team?: string; "data-testid"?: string }) {
  const label = scope === "team" && team ? `${MCP_AUTH_LABEL.team}（${team}）` : MCP_AUTH_LABEL[scope];
  // 收紧程度越高越显眼：仅项目负责人用 warning 底，其余用描边
  return (
    <Badge tone={scope === "lead" ? "warning" : "outline"} data-testid={testId}>
      <KeyRound aria-hidden className="h-3 w-3" />
      授权 · {label}
    </Badge>
  );
}

/** ③ MCP 评审状态 —— 盾牌，独立于授权范围 */
export function ReviewBadge({
  status, "data-testid": testId,
}: { status: McpReviewStatus; "data-testid"?: string }) {
  if (status === "cleared") {
    return (
      <Badge tone="neutral" data-testid={testId}>
        <ShieldAlert aria-hidden className="h-3 w-3" />
        评审 · {MCP_REVIEW_LABEL.cleared}
      </Badge>
    );
  }
  return (
    <Badge tone="danger" data-testid={testId}>
      <ShieldAlert aria-hidden className="h-3 w-3" />
      评审 · {MCP_REVIEW_LABEL.pending}
    </Badge>
  );
}
