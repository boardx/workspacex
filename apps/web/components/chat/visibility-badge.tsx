import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VISIBILITY_SCOPE_LABEL, type VisibilityScope } from "@/lib/mock/chat";

/**
 * 可见范围徽标（UC-8.5 AC1 / R8）
 *
 * ⚠⚠ **[设计 · 待裁决]**：AC1 要求「界面上每条对话都明确标出可见范围」，
 *   但 UC-8.5 R8 / R10 明写「**原型的线程卡与线程头上均未见此徽标**」——
 *   徽标的**位置（线程卡 / 线程头 / 产物条 / 全都要）、文案、观察者视角下的呈现**均需补设计并由产品裁决。
 *   本组件是**一个提案**，不是已确认设计。服务端的 `visibility_scope` 字段本身是 [原型] 明确的。
 *
 * 色调按「越私密越冷」：私有/私聊=neutral、本组共享/团队=ai、全场=primary。
 */
export function VisibilityBadge({ scope }: { scope: VisibilityScope }) {
  const tone: "neutral" | "ai" | "primary" =
    scope === "all-hands" ? "primary" : scope === "member-private" || scope === "private" ? "neutral" : "ai";
  return (
    <Badge tone={tone} data-testid={`chat-visibility-${scope}`} title="[设计·待裁决] 可见范围徽标，原型未见此控件">
      <Eye aria-hidden className="h-3 w-3" />
      {VISIBILITY_SCOPE_LABEL[scope]}
    </Badge>
  );
}
