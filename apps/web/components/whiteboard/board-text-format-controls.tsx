"use client";
import { useState, useRef, useEffect } from "react";
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Plus } from "lucide-react";
import type { TextAttributes } from "@repo/whiteboard-core";
import { Button } from "@/components/ui/button";

// Verified local fonts remain available across submenu mounts in this browser session.
const sessionLocalFonts = new Set<string>();
const FONTS = ["Noto Sans SC", "Bitter", "JetBrains Mono"];
export function BoardTextFormatControls({ text, disabled = false, sticky = false, onChange }: { text: Partial<TextAttributes>; disabled?: boolean; sticky?: boolean; onChange: (patch: TextAttributes) => void }) {
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  const blocked = useRef(disabled); blocked.current = disabled;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [customFonts, setCustomFonts] = useState<string[]>(() => [...sessionLocalFonts]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const apply = (patch: Partial<TextAttributes>) => onChange({ preset: text.preset ?? "body", ...patch });
  const action = (label: string, pressed: boolean, icon: React.ReactNode, patch: Partial<TextAttributes>) => <Button key={label} size="icon" variant={pressed ? "secondary" : "ghost"} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={() => apply(patch)}>{icon}</Button>;
  const addFont = async () => {
    if (pending || disabled) return;
    const name = draft.trim();
    if (!/^[\p{L}\p{N} _-]{1,128}$/u.test(name)) { setError("请输入有效字体名称"); return; }
    setPending(true);
    try {
      // local() resolves an installed font and rejects unavailable names, unlike fonts.check fallback.
      const face = new FontFace(name, `local("${name}")`);
      await face.load();
      if (!active.current || blocked.current) return;
      document.fonts.add(face);
      sessionLocalFonts.add(name);
      setCustomFonts(previous => [...new Set([...previous, name])]); apply({ fontFamily: name });
      setError(""); setAdding(false); setDraft("");
    } catch { if(active.current) setError("未找到该字体，请先在设备上安装后重试"); } finally { if(active.current) setPending(false); }
  };
  return <div data-testid="board-text-format-controls" className="space-y-2">
    <div role="group" aria-label="文字格式" className="flex flex-wrap gap-1">
      {action("切换粗体", text.bold === true, <Bold className="h-4 w-4" />, { bold: !text.bold })}
      {action("切换斜体", text.italic === true, <Italic className="h-4 w-4" />, { italic: !text.italic })}
      {([ ["left", "左对齐", AlignLeft], ["center", "水平居中", AlignCenter], ["right", "右对齐", AlignRight] ] as const).map(([alignment, label, Icon]) => action(label, (text.alignment ?? "left") === alignment, <Icon className="h-4 w-4" />, { alignment }))}
    </div>
    {sticky && <div role="group" aria-label="垂直对齐" className="flex gap-1">{([ ["top", "顶对齐", AlignVerticalJustifyStart], ["middle", "垂直居中", AlignVerticalJustifyCenter], ["bottom", "底对齐", AlignVerticalJustifyEnd] ] as const).map(([verticalAlignment, label, Icon]) => action(label, (text.verticalAlignment ?? "middle") === verticalAlignment, <Icon className="h-4 w-4" />, { verticalAlignment }))}</div>}
    <input data-testid="board-format-font-size" aria-label="字号" title="字号" type="number" min={8} max={200} value={text.fontSize ?? 18} disabled={disabled} className="h-11 w-20 rounded-lg border border-input bg-card px-2" onChange={event => { const fontSize = Number(event.target.value); if (Number.isFinite(fontSize) && fontSize >= 8 && fontSize <= 200) apply({ fontSize }); }} />
    {!sticky && <div className="flex gap-1"><select data-testid="board-format-font-family" aria-label="字体" disabled={disabled} value={text.fontFamily ?? "Noto Sans SC"} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-2" onChange={event => apply({ fontFamily: event.target.value })}>{[...new Set([...FONTS, ...customFonts, ...(text.fontFamily ? [text.fontFamily] : [])])].map(font => <option key={font}>{font}</option>)}</select><Button size="icon" variant="ghost" aria-label="添加字体" title="添加字体" disabled={disabled} onClick={() => setAdding(value => !value)}><Plus className="h-4 w-4" /></Button></div>}
    {adding && <form onSubmit={event => { event.preventDefault(); void addFont(); }} className="flex flex-wrap gap-1"><input aria-label="本地字体名称" placeholder="本地字体名称" value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-2" /><Button type="submit" size="icon" aria-label="加载字体" title="加载字体" disabled={disabled || pending}><Plus className="h-4 w-4" /></Button>{error && <p role="alert" className="w-full text-12 text-destructive">{error}</p>}</form>}
  </div>;
}
