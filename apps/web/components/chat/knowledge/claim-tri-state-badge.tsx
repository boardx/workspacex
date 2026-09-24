import * as React from "react";
import { Badge } from "@/components/ui/badge";
import {
  claimTriState,
  KG_TRI_STATE_LABEL_ZH,
  type KgTriState,
} from "@repo/contracts/knowledge-graph";
import type { KgClaim } from "@repo/contracts/knowledge-graph";

/** 三态 → Badge tone。文案与映射均取自契约单源，不另建表。 */
const TONE: Record<KgTriState, React.ComponentProps<typeof Badge>["tone"]> = {
  pending: "warning",
  confirmed: "success",
  conflict: "danger",
};

export function ClaimTriStateBadge({ status }: { status: KgClaim["status"] }) {
  const tri = claimTriState(status);
  if (!tri) return null; // superseded 不渲染（uc-18-3 R7）
  return (
    <Badge tone={TONE[tri]} data-testid={`kg-tri-state-${tri}`}>
      {KG_TRI_STATE_LABEL_ZH[tri]}
    </Badge>
  );
}
