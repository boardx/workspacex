"use client";
/**
 * 对标 R9（#3954）—— **变体**：让 AI 对当前页出几个结构不同的方案，并排看、挑一个。
 *
 * 候选不落库。挑中一个 ⇒ 调用方用既有 `replace` patch 把这一页的根换成它（I-11），
 * 于是它就是版本历史里普通的一条，「撤销」照常能回到原来那页——不另开一套方案存储。
 *
 * 深度 S9（#3988）补三件事，都是「挑方案」时真正缺的：
 * - **对照**：方案旁边摆着「当前」这一页。挑方案是在比较，此前只能凭记忆比；
 * - **提要求**：一句「更简洁」「突出价格」再出一组。接口早就收 `instruction`（R9 起），界面一直没给入口；
 * - **要几个**：2–4 个（契约的闭区间），默认与服务端同一个数（`PROTOTYPE_VARIANTS_DEFAULT`）。
 */
import * as React from "react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { designWorkbench } from "@repo/contracts";
import { PrototypeCanvas, rotated, type PrototypeDevicePreset } from "./prototype-canvas";
import type { DesignTokens, PrototypeAccent, PrototypeNode } from "@/lib/live-design-workbench";

export type VariantsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly items: readonly designWorkbench.PrototypeVariant[] }
  | { readonly kind: "error"; readonly message: string };

/** 再出一组时带上的要求与个数。 */
export interface VariantsAsk { readonly instruction?: string; readonly count?: number }

/** 候选缩略图的缩放：三张并排放得下，字还认得出。 */
const THUMB_SCALE = 0.42;

const COUNTS = Array.from(
  { length: designWorkbench.PROTOTYPE_VARIANTS_MAX - designWorkbench.PROTOTYPE_VARIANTS_MIN + 1 },
  (_, i) => designWorkbench.PROTOTYPE_VARIANTS_MIN + i,
);

export function VariantsPanel({ state, frameLabel, current, device, landscape, accent, tokens, theme, picking, onPick, onClose, onRegenerate }: {
  readonly state: VariantsState;
  readonly frameLabel: string;
  /** 这一页现在的样子（对照用）；没画出来 ⇒ `null`，那也就出不了方案，不会走到这里。 */
  readonly current: PrototypeNode | null;
  readonly device: PrototypeDevicePreset;
  readonly landscape: boolean;
  readonly accent: PrototypeAccent;
  readonly tokens: DesignTokens;
  readonly theme: "light" | "dark";
  readonly picking: boolean;
  readonly onPick: (index: number) => void;
  readonly onClose: () => void;
  /** 再出一组（出错后的「再试一次」也是它：带着同样的要求与个数重来）。 */
  readonly onRegenerate: (ask: VariantsAsk) => void;
}): React.ReactElement {
  const size = rotated(device, landscape);
  const [instruction, setInstruction] = React.useState("");
  const [count, setCount] = React.useState<number>(designWorkbench.PROTOTYPE_VARIANTS_DEFAULT);
  const ask = (): VariantsAsk => ({ count, ...(instruction.trim() !== "" ? { instruction: instruction.trim() } : {}) });
  const thumb = (root: PrototypeNode) => (
    <div className="overflow-hidden" style={{ width: size.w * THUMB_SCALE, height: size.h * THUMB_SCALE }}>
      <div style={{ transform: `scale(${THUMB_SCALE})`, transformOrigin: "top left", width: size.w, height: size.h }}>
        <PrototypeCanvas thumbnail label={frameLabel} root={root} device={device} landscape={landscape} accent={accent} tokens={tokens} theme={theme} mode="preview" />
      </div>
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="design-variants">
      <div className="flex items-center justify-between gap-2">
        <p className="text-12 font-medium text-card-foreground">「{frameLabel}」的几个方案——挑一个换上去，不满意可以撤销</p>
        <button type="button" onClick={onClose} aria-label="收起方案" className="rounded-control p-1 text-muted-foreground transition-colors duration-fast hover:bg-panel">
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {/* 深度 S9：提一句要求、选要几个，再出一组。回车也算。 */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); onRegenerate(ask()); }}
      >
        <input
          value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={500}
          placeholder="对方案的要求，比如：更简洁、突出价格、换成卡片布局"
          aria-label="对方案的要求"
          data-testid="design-variants-instruction"
          className="min-w-0 flex-1 rounded-control border border-border bg-background px-2 py-1 text-12 text-background-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <label className="inline-flex items-center gap-1 text-11 text-muted-foreground">
          要
          <select
            value={count} onChange={(e) => setCount(Number(e.target.value))}
            data-testid="design-variants-count"
            className="rounded-control border border-border bg-background px-1 py-1 text-12 text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          个
        </label>
        <button
          type="submit" disabled={state.kind === "loading"}
          data-testid="design-variants-regenerate"
          className="inline-flex items-center gap-1 rounded-control border border-border px-2 py-1 text-11 text-card-foreground transition-colors duration-fast hover:bg-panel disabled:bg-disabled disabled:text-disabled-foreground"
        >
          <RefreshCw aria-hidden className="h-3 w-3" /> 再出一组
        </button>
      </form>
      {state.kind === "loading" && (
        <p className="inline-flex items-center gap-1.5 text-12 text-muted-foreground"><Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> 正在出方案……</p>
      )}
      {state.kind === "error" && (
        <div className="flex items-center gap-2 text-12 text-muted-foreground" role="alert">
          <span>{state.message}</span>
          <button type="button" onClick={() => onRegenerate(ask())} className="rounded-control border border-border px-2 py-1 text-11 transition-colors duration-fast hover:bg-panel">再试一次</button>
        </div>
      )}
      {(state.kind === "ready" || current !== null) && (
        <div className="flex flex-wrap gap-4">
          {/* 深度 S9：对照——「当前」排第一个，虚线框、没有「用这个」（它已经是了）。 */}
          {current !== null && (
            <div className="flex flex-col gap-2 rounded-card border border-dashed border-border p-2" data-testid="design-variant-current">
              {thumb(current)}
              <p className="text-11 font-medium text-muted-foreground" style={{ maxWidth: size.w * THUMB_SCALE }}>当前</p>
            </div>
          )}
          {state.kind === "ready" && state.items.map((v, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-card border border-border bg-card p-2" data-testid={i === 0 ? "design-variant-0" : i === 1 ? "design-variant-1" : i === 2 ? "design-variant-2" : "design-variant-3"}>
              {thumb(v.root)}
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
