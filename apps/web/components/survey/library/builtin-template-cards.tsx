"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { BuiltinSurveyTemplate } from "@/lib/survey/builtin-templates";

export function BuiltinTemplateCards({items,base,busy,onCopy,onCreate}:{
 items:BuiltinSurveyTemplate[];base:string;busy:boolean;
 onCopy:(item:BuiltinSurveyTemplate)=>void;onCreate:(item:BuiltinSurveyTemplate)=>void;
}) {
 return <section aria-label="内置模板" className="space-y-4">
  <div><h2 className="text-16 font-semibold">内置模板</h2><p className="mt-1 text-12 text-muted-foreground">可直接使用；修改后保存到我的模板，保留原始模板。</p></div>
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(item=><article key={item.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5">
   <span className="mb-3 w-fit rounded bg-accent px-2 py-1 text-11 text-accent-foreground">内置</span>
   <h3 className="text-16 font-semibold">{item.title}</h3>
   <p className="mt-2 line-clamp-4 text-13 text-muted-foreground">{item.description}</p>
   <p className="mt-auto pt-4 text-12 text-muted-foreground">{item.questions.length} 道题目 · {item.template.sections.length} 个报告章节</p>
   <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
    <Link href={`${base}/${encodeURIComponent(item.id)}`} className="rounded-md border border-border px-3 py-2 text-12 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看并编辑</Link>
    <Button variant="outline" disabled={busy} onClick={()=>onCopy(item)}>保存到我的模板</Button>
    {item.kind === "question" && <Button disabled={busy} onClick={()=>onCreate(item)}>使用并创建问卷</Button>}
   </div>
  </article>)}</div>
  {!items.length&&<p className="text-13 text-muted-foreground">没有匹配的内置模板。</p>}
 </section>;
}
