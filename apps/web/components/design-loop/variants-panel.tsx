"use client";
/**
 * 对标 R9（#3954）—— **变体**：让 AI 对当前页出几个结构不同的方案，并排看、挑一个。
 *
 * 候选不落库。挑中一个 ⇒ 调用方用既有 `replace` patch 把这一页的根换成它（I-11），
 * 于是它就是版本历史里普通的一条，「撤销」照常能回到原来那页——不另开一套方案存储。
 */
import * as React from "react";
import { Check, Loader2, X } from "lucide-react";
import type { designWorkbench } from "@repo/contracts";
import { PrototypeCanvas, rotated, type PrototypeDevicePreset } from "./prototype-canvas";
import type { DesignTokens, PrototypeAccent } from "@/lib/live-design-workbench";

export type VariantsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly items: readonly designWorkbench.PrototypeVariant[] }
  | { readonly kind: "error"; readonly message: string };

/** 候选缩略图的缩放：三张并排放得下，字还认得出。 */
const THUMB_SCALE = 0.42;

export function VariantsPanel({ state, frameLabel, device, landscape, accent, tokens, theme, picking, onPick, onClose, onRetry }: {
  readonly state: VariantsState;
  readonly frameLabel: string;
  readonly device: PrototypeDevicePreset;
  readonly landscape: boolean;
  readonly accent: PrototypeAccent;
  readonly tokens: DesignTokens;
  readonly theme: "light" | "dark";
  readonly picking: boolean;
  readonly onPick: (index: number) => void;
  readonly onClose: () => void;
  readonly onRetry: () => void;
}): React.ReactElement {
  const size = rotated(device, landscape);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="design-variants">
      <div className="flex items-center justify-between gap-2">
        <p className="text-12 font-medium text-card-foreground">「{frameLabel}」的几个方案——挑一个换上去，不满意可以撤销</p>
        <button type="button" onClick={onClose} aria-label="收起方案" className="rounded-control p-1 text-muted-foreground transition-colors duration-fast hover:bg-panel">
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {state.kind === "loading" && (
        <p className="inline-flex items-center gap-1.5 text-12 text-muted-foreground"><Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> 正在出方案……</p>
      )}
      {state.kind === "error" && (
        <div className="flex items-center gap-2 text-12 text-muted-foreground" role="alert">
          <span>{state.message}</span>
          <button type="button" onClick={onRetry} className="rounded-control border border-border px-2 py-1 text-11 transition-colors duration-fast hover:bg-panel">再试一次</button>
        </div>
      )}
      {state.kind === "ready" && (
        <div className="flex flex-wrap gap-4">
          {state.items.map((v, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-card border border-border bg-card p-2" data-testid={i === 0 ? "design-variant-0" : i === 1 ? "design-variant-1" : i === 2 ? "design-variant-2" : "design-variant-3"}>
              <div className="overflow-hidden" style={{ width: size.w * THUMB_SCALE, height: size.h * THUMB_SCALE }}>
                <div style={{ transform: `scale(${THUMB_SCALE})`, transformOrigin: "top left", width: size.w, height: size.h }}>
                  <PrototypeCanvas thumbnail label={frameLabel} root={v.root} device={device} landscape={landscape} accent={accent} tokens={tokens} theme={theme} mode="preview" />
                </div>
              </div>
              <p className="text-11 text-card-foreground" style={{ maxWidth: size.w * THUMB_SCALE }}>{v.summary}</p>
              <button
                type="button" onClick={() => onPick(i)} disabled={picking}
                data-testid={i === 0 ? "design-variant-pick-0" : i === 1 ? "design-variant-pick-1" : i === 2 ? "design-variant-pick-2" : "design-variant-pick-3"}
                className="inline-flex items-center justify-center gap-1 rounded-control bg-primary px-2 py-1 text-11 text-primary-foreground disabled:bg-disabled disabled:text-disabled-foreground"
              >
                <Check aria-hidden className="h-3 w-3" /> 用这个
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
