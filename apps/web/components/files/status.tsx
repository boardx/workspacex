"use client";
import * as React from "react";
import {
  FileText, ClipboardList, Mic, Presentation, Search, MessagesSquare,
  Workflow, Sparkles, ShieldAlert, Loader2, AlertTriangle, Lock,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  type SourceType, type IngestState, INGEST_META, type IngestTone,
} from "@/lib/mock/files";

/** 来源类型 → 图标（不可只有图标：调用处一律配文字，UC-22.1 R3 第 3 步）*/
export const SOURCE_ICON: Record<SourceType, LucideIcon> = {
  file: FileText,
  survey: ClipboardList,
  interview: Mic,
  workshop: Presentation,
  research: Search,
  conversation: MessagesSquare,
  canvas: Workflow,
  generated: Sparkles,
};

const TONE_TO_BADGE: Record<IngestTone, React.ComponentProps<typeof Badge>["tone"]> = {
  neutral: "neutral", primary: "primary", warning: "warning", danger: "danger", success: "primary",
};

/** 摄取态角标——非 READY 的行必须显式可见（UC-22.1 R3 第 3 步 / UC-22.2 R7）*/
export function IngestBadge({ state }: { state: IngestState }) {
  const meta = INGEST_META[state];
  const tone = state === "READY" ? "outline" : TONE_TO_BADGE[meta.tone];
  return (
    <Badge tone={tone} data-testid="files-ingest-badge">
      {state !== "READY" && state !== "INDEXED" && meta.tone === "warning" && (
        <AlertTriangle aria-hidden className="h-2.5 w-2.5" />
      )}
      {(state === "RECEIVED" || state === "QUARANTINED" || state === "EXTRACTED" ||
        state === "SEGMENTED" || state === "ENRICHED") && (
        <Loader2 aria-hidden className="h-2.5 w-2.5 animate-spin" />
      )}
      {meta.label}
    </Badge>
  );
}

/** synthesized 醒目标记（generated 类必带；服务端另有 evidencePolicy 强制，非仅视觉）*/
export function SynthesizedBadge() {
  return (
    <Badge tone="ai" data-testid="files-synthesized-badge">
      <Sparkles aria-hidden className="h-2.5 w-2.5" /> synthesized
    </Badge>
  );
}

export function ConfidentialBadge() {
  return (
    <Badge tone="warning" data-testid="files-confidential-badge">
      <Lock aria-hidden className="h-2.5 w-2.5" /> 机密
    </Badge>
  );
}

export function IntegrityBadge() {
  return (
    <Badge tone="danger" data-testid="files-integrity-badge">
      <ShieldAlert aria-hidden className="h-2.5 w-2.5" /> 完整性校验失败
    </Badge>
  );
}

/** 系统产出物 vs 上传原件的一眼区分（file-first 第 1 条）*/
export function OriginBadge({ system }: { system: boolean }) {
  return system
    ? <Badge tone="outline" data-testid="files-origin-badge">系统产出</Badge>
    : <Badge tone="neutral" data-testid="files-origin-badge">上传原件</Badge>;
}
