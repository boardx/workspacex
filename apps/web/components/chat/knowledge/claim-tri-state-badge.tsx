import * as React from "react";
import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { Badge } from "@/components/ui/badge";
import {
  claimTriState,
  type KgTriState,
} from "@repo/contracts/chat-knowledge-graph";
import type { KgClaim } from "@repo/contracts/chat-knowledge-graph";

/** 三态 → Badge tone。文案与映射均取自契约单源，不另建表。 */
const TONE: Record<KgTriState, React.ComponentProps<typeof Badge>["tone"]> = {
  pending: "warning",
  confirmed: "success",
  conflict: "danger",
};

const LABEL_KEYS: Record<KgTriState, MessageKey> = { pending: "aboutMemory.tri.pending", confirmed: "aboutMemory.tri.confirmed", conflict: "aboutMemory.tri.conflict" };

export function ClaimTriStateBadge({ status, locale = "zh-CN" }: { status: KgClaim["status"]; locale?: Locale }) {
  const tri = claimTriState(status);
  if (!tri) return null; // superseded 不渲染（uc-18-3 R7）
  return (
    <Badge tone={TONE[tri]} data-testid={`kg-tri-state-${tri}`}>
      {translate(locale, LABEL_KEYS[tri])}
    </Badge>
  );
}
