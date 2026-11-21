import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readAidtProblemDirections, type AidtProblemDirection } from "../lib/aidt-problem-directions";

export function AidtProblemDirections({ fields, readOnly, onChange }: {
  fields: Record<string, string>;
  readOnly: boolean;
  onChange: (fields: Record<string, string>) => void;
}) {
  const id = React.useId();
  const [title, setTitle] = React.useState("");
  const [source, setSource] = React.useState<AidtProblemDirection["source"]>("group");
  const directions = readAidtProblemDirections(fields.problemDirections);
  const selected = fields.problemDirectionId ?? "";
  const add = () => {
    const text = title.trim();
    if (!text || readOnly || directions.length >= 8 || directions.some(direction => direction.title === text)) return;
    onChange({ problemDirections: JSON.stringify([...directions, { id: crypto.randomUUID(), title: text, source }]) });
    setTitle("");
  };
  return <section className="space-y-3 border-t border-border-subtle pt-4" aria-labelledby={id}>
    <div className="flex items-center justify-between gap-2">
      <h3 id={id} className="text-13 font-semibold">讨论与候选方向</h3>
      <span className="text-12 text-muted-foreground">本轮仅选一个</span>
    </div>
    {directions.length > 0 && <fieldset aria-labelledby={id} disabled={readOnly} className="space-y-1">
      {directions.map(direction => <div key={direction.id} className="flex items-center gap-2 rounded-control border border-border-subtle px-2 py-2">
        <input type="radio" id={`${id}-${direction.id}`} name={id} checked={selected === direction.id}
          onChange={() => onChange({ problemDirectionId: direction.id, focus: direction.title })} />
        <label htmlFor={`${id}-${direction.id}`} className="min-w-0 flex-1 break-words text-13">{direction.title}</label>
        <span className="shrink-0 text-11 text-muted-foreground">{direction.source === "ai" ? "AI 补充 · 待验证" : "小组讨论"}</span>
        {!readOnly && <Button type="button" variant="ghost" size="xs" onClick={() => onChange({
          problemDirections: JSON.stringify(directions.filter(item => item.id !== direction.id)),
          ...(selected === direction.id ? { problemDirectionId: "", focus: "" } : {}),
        })} aria-label={`移除方向：${direction.title}`}>移除</Button>}
      </div>)}
    </fieldset>}
    {!readOnly && directions.length < 8 && <details className="text-12">
      <summary className="cursor-pointer font-medium">添加候选方向</summary>
      <div className="mt-2 space-y-2">
        <Input aria-label="候选方向" value={title} maxLength={180} onChange={event => setTitle(event.currentTarget.value)} />
        <fieldset aria-label="候选方向来源" className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><input type="radio" name={`${id}-source`} checked={source === "group"} onChange={() => setSource("group")} />小组讨论</label>
          <label className="flex items-center gap-2"><input type="radio" name={`${id}-source`} checked={source === "ai"} onChange={() => setSource("ai")} />AI 补充</label>
        </fieldset>
        <Button type="button" variant="outline" size="sm" disabled={!title.trim() || directions.some(direction => direction.title === title.trim())} onClick={add}>添加方向</Button>
      </div>
    </details>}
  </section>;
}
