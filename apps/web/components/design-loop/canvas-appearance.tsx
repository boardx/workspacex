"use client";
/**
 * 迭代 24 —— 画布工具条的「外观」面板：明暗、强调色、设备三件事收进一个按钮。
 *
 * ## 为什么要收起来
 *
 * 此前工具条是**一排二十多个控件**：页签、加/复制/删页、画板/单页、编辑/预览、白天/黑夜、
 * 八个无标签的彩色圆点、设备下拉、旋转、撤销、历史——一行平铺，没有分组、没有主次。
 * 对第一次来做原型的人，这一行里真正每天要用的只有两三个（切页、编辑/预览），
 * 而最显眼的是那八个圆点——他既不知道那是什么，也不知道该不该动它。
 *
 * 外观这三件事的共同点是**设一次就不再动**。把它们收进一个按钮，常态下工具条少掉
 * 十几个控件；点开之后每一节有中文小标题，那八个圆点第一次有了名字。
 *
 * 顺带解决一个硬伤：这一排在 375 档把整个页面撑出 460px 的横向滚动
 * （`design-loop-responsive` 一直红着，只是那条 spec 从来没在 CI 上跑过，见本轮的门控修复）。
 *
 * ## 为什么不是 Popover 组件
 *
 * 本仓的 `components/ui` 没有 popover 原语，而这里要的只是「点开一个小面板、点外面关掉、
 * Esc 关掉」。引一个新原语要连带定位策略、焦点陷阱、portal 三件事，都是这一处用不上的。
 */
import * as React from "react";
import { Moon, Palette, RotateCw, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { designWorkbench } from "@repo/contracts";
import type { PrototypeAccent } from "@/lib/live-design-workbench";
import type { PrototypeDevicePreset } from "./prototype-canvas";

/** 对标 R1：字体档位的人话名（只有这个面板说它们）。 */
const FONT_LABEL: Readonly<Record<designWorkbench.PrototypeFont, string>> = {
  sans: "现代", serif: "衬线", rounded: "圆润", mono: "等宽",
};

export function CanvasAppearance({
  theme, onTheme, accent, accentOptions, accentLabel, accentSwatch, onAccent,
  brand, onBrand, font, onFont,
  devices, deviceId, onDevice, landscape, onLandscape, rotatable,
}: {
  readonly theme: "light" | "dark";
  readonly onTheme: (t: "light" | "dark") => void;
  readonly accent: PrototypeAccent;
  readonly accentOptions: readonly PrototypeAccent[];
  readonly accentLabel: Readonly<Record<PrototypeAccent, string>>;
  readonly accentSwatch: Readonly<Record<string, string>>;
  readonly onAccent: (a: PrototypeAccent) => void;
  /** 对标 R1（#3933）：任意品牌色（`#RRGGBB`）；`null` = 用上面的强调色档位。 */
  readonly brand: string | null;
  readonly onBrand: (hex: string | null) => void;
  readonly font: designWorkbench.PrototypeFont;
  readonly onFont: (f: designWorkbench.PrototypeFont) => void;
  readonly devices: readonly PrototypeDevicePreset[];
  readonly deviceId: string;
  readonly onDevice: (id: string) => void;
  readonly landscape: boolean;
  readonly onLandscape: () => void;
  readonly rotatable: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  // 品牌色输入框自己的草稿：边打边校验，合法且回车/失焦才提交——打到一半（#FF5）不该把画布刷成别的色。
  const [brandDraft, setBrandDraft] = React.useState(brand ?? "");
  React.useEffect(() => setBrandDraft(brand ?? ""), [brand]);
  const draftValid = designWorkbench.BrandColor.safeParse(brandDraft.trim()).success;
  const commitBrand = () => {
    const v = brandDraft.trim().toUpperCase();
    if (v === "") { if (brand !== null) onBrand(null); return; }
    if (designWorkbench.BrandColor.safeParse(v).success && v !== brand) onBrand(v);
  };
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="design-detail-appearance"
        title="外观：明暗、强调色、设备尺寸"
        className={cn(
          "inline-flex items-center gap-1 rounded-control border border-border px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
        )}
      >
        <Palette aria-hidden className="h-3 w-3" /> 外观
        {/* 当前强调色在按钮上留一个点：收起来之后也还看得出"现在是哪一档"。 */}
        <span
          aria-hidden
          className={cn("h-2.5 w-2.5 rounded-full border border-border", accent === "neutral" && "bg-muted")}
          style={accent === "neutral" ? undefined : { backgroundColor: `hsl(${accentSwatch[accent] ?? ""})` }}
        />
      </button>

      {open && (
        <div
          role="group"
          aria-label="外观"
          data-testid="design-detail-appearance-panel"
          className="absolute right-0 top-full z-20 mt-1 flex w-60 flex-col gap-3 rounded-card border border-border bg-card p-3 text-card-foreground shadow-lg"
        >
          <Section title="明暗" hint="只改原型，后台不跟着变">
            <div className="inline-flex rounded-control border border-border p-0.5">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t} type="button" data-testid={`design-detail-theme-${t}`} aria-pressed={theme === t}
                  onClick={() => onTheme(t)}
                  className={cn("inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-11 transition-colors duration-fast",
                    theme === t ? "bg-panel text-card-foreground" : "text-muted-foreground hover:bg-panel/60")}
                >
                  {t === "light" ? <Sun aria-hidden className="h-3 w-3" /> : <Moon aria-hidden className="h-3 w-3" />}
                  {t === "light" ? "白天" : "黑夜"}
                </button>
              ))}
            </div>
          </Section>

          <Section title="强调色" hint={accentLabel[accent]}>
            <div className="flex flex-wrap items-center gap-1" data-testid="design-detail-accents">
              {accentOptions.map((a) => (
                <button
                  key={a} type="button" data-testid={`design-detail-accent-${a}`}
                  aria-pressed={brand === null && accent === a} aria-label={accentLabel[a]} title={accentLabel[a]}
                  onClick={() => onAccent(a)}
                  className={cn(
                    "h-5 w-5 rounded-full border transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    brand === null && accent === a ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60",
                    a === "neutral" && "bg-muted",
                  )}
                  style={a === "neutral" ? undefined : { backgroundColor: `hsl(${accentSwatch[a] ?? ""})` }}
                />
              ))}
            </div>
          </Section>

          <Section title="品牌色" hint={brand === null ? "用自己的品牌色，替代上面的档位" : "正在使用品牌色；点上面任一档位可换回"}>
            <div className="flex items-center gap-1.5">
              <input
                type="color" aria-label="选一个品牌色" data-testid="design-detail-brand-picker"
                value={draftValid ? brandDraft.trim() : (brand ?? "#888888")}
                onChange={(e) => { const v = e.target.value.toUpperCase(); setBrandDraft(v); onBrand(v); }}
                className="h-6 w-7 shrink-0 cursor-pointer rounded-control border border-border bg-transparent p-0"
              />
              <input
                type="text" inputMode="text" spellCheck={false} maxLength={7} placeholder="#FF5A1F"
                aria-label="品牌色色值" aria-invalid={brandDraft.trim() !== "" && !draftValid}
                data-testid="design-detail-brand-color"
                value={brandDraft}
                onChange={(e) => setBrandDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitBrand(); } }}
                onBlur={commitBrand}
                className={cn(
                  "min-w-0 flex-1 rounded-control border bg-background px-1.5 py-0.5 font-mono text-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  brandDraft.trim() !== "" && !draftValid ? "border-destructive" : "border-border",
                )}
              />
              {brand !== null && (
                <button type="button" onClick={() => onBrand(null)} data-testid="design-detail-brand-clear"
                  className="shrink-0 rounded-control px-1 text-10 text-muted-foreground transition-colors duration-fast hover:text-card-foreground">
                  清除
                </button>
              )}
            </div>
            {brandDraft.trim() !== "" && !draftValid && (
              <p className="text-10 text-destructive" data-testid="design-detail-brand-invalid">色值写成 #RRGGBB，比如 #FF5A1F</p>
            )}
          </Section>

          <Section title="字体" hint={FONT_LABEL[font]}>
            <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="字体">
              {designWorkbench.PrototypeFont.options.map((f) => (
                <button
                  key={f} type="button" role="radio" aria-checked={font === f} data-testid={`design-detail-font-${f}`}
                  onClick={() => onFont(f)}
                  className={cn(
                    "flex flex-col items-center rounded-control border px-1 py-1 text-10 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    font === f ? "border-primary bg-panel text-card-foreground" : "border-border text-muted-foreground hover:bg-panel/60",
                  )}
                >
                  <span className="text-13" style={f === "sans" ? undefined : { fontFamily: designWorkbench.PROTOTYPE_FONT_STACKS[f] }}>字Aa</span>
                  {FONT_LABEL[f]}
                </button>
              ))}
            </div>
          </Section>

          <Section title="设备" hint="只改画板尺寸；原型没有断点，内容按 flex 自适应">
            <div className="flex items-center gap-1">
              <select
                value={deviceId}
                onChange={(e) => onDevice(e.target.value)}
                data-testid="design-detail-device"
                aria-label="设备尺寸"
                className="h-7 min-w-0 flex-1 rounded-control border border-border bg-panel px-1 text-11 text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.label} {d.w}×{d.h}</option>
                ))}
              </select>
              <button
                type="button" onClick={onLandscape} disabled={!rotatable}
                aria-pressed={landscape && rotatable} data-testid="design-detail-rotate"
                title={rotatable ? "横过来看" : "这个尺寸没有竖屏一说"}
                className={cn("inline-flex shrink-0 items-center rounded-control px-1.5 py-1 transition-colors duration-fast disabled:bg-disabled disabled:text-disabled-foreground",
                  landscape && rotatable ? "bg-panel text-card-foreground" : "text-muted-foreground hover:bg-panel/60")}
              >
                <RotateCw aria-hidden className="h-3 w-3" />
              </button>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-10 font-medium text-muted-foreground">{title}</span>
      {children}
      {hint !== undefined && hint !== "" && <span className="text-10 text-muted-foreground">{hint}</span>}
    </div>
  );
}
