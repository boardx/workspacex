"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { presetById } from "@/lib/prototype-devices";
import type { loadAidtPrototypeSnapshot } from "../lib/aidt-prototype-versions";

type Snapshot = Awaited<ReturnType<typeof loadAidtPrototypeSnapshot>>;
/** Existing Design renderer and iframe sandbox, on an exact saved snapshot only. */
export function AidtTestPrototypePreview({ snapshot }: { snapshot: Snapshot }) {
  const [selected, setSelected] = React.useState(0);
  const index = selected < snapshot.frames.length ? selected : 0;
  return <section className="min-w-0 space-y-3" aria-label="被测原型预览">
    <nav className="flex flex-wrap gap-2" aria-label="原型页面">{snapshot.frames.map((name, at) => <Button key={at} type="button" size="xs" variant={index === at ? "primary" : "outline"} aria-pressed={index === at} onClick={() => setSelected(at)}>{name || `第 ${at + 1} 页`}</Button>)}</nav>
    <div className="h-96 min-w-0 overflow-hidden rounded-container border border-border">
      <PrototypeCanvas label={snapshot.frames[index] || "被测原型"} root={snapshot.prototype[index] ?? null} mode="preview" theme="light" device={presetById("laptop")}
        links={snapshot.links?.[index]} onNavigate={at => { if (Number.isInteger(at) && at >= 0 && at < snapshot.frames.length) setSelected(at); }} ungenerated={!snapshot.prototype[index]} />
    </div>
    <p className="text-12 text-muted-foreground">固定版本 {snapshot.id} · {snapshot.prototype.filter(Boolean).length}/{snapshot.frames.length} 页可预览。预览效果不代表真实用户测试结果。</p>
  </section>;
}
