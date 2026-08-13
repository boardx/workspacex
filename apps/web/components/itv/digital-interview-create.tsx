"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { createDigitalInterviewDraft } from "@/lib/interview-api";

export function DigitalInterviewCreate() {
  const { push } = useRouter();
  const [name, setName] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const parsedTags = tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean);
  const valid = name.trim().length > 0 && parsedTags.length > 0 && topic.trim().length > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await createDigitalInterviewDraft({
        name: name.trim(), tags: parsedTags, topic: topic.trim(),
      });
      push(`/itv/${created.interviewId}/setup`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.reasonCode ?? cause.message : cause instanceof Error ? cause.message : "DEPENDENCY_UNAVAILABLE");
      setBusy(false);
    }
  }

  return (
    <main data-testid="itv-create-page" className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-8 lg:px-10 lg:py-10">
        <Link href="/itv?tab=history" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> 返回历史访谈
        </Link>

        <header className="mt-6 border-b border-border pb-6">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">创建批量访谈</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">先确认访谈主题</h1>
          <p className="mt-2 text-sm text-muted-foreground">保存名称、标签与主题后进入 Mock 专家预览；确认主题前不会生成专家。</p>
        </header>

        <ol className="mt-6 grid gap-2 sm:grid-cols-5" aria-label="创建步骤">
          {["主题", "专家", "问题", "访谈", "报告"].map((label, index) => (
            <li data-testid={index === 0 ? "itv-step-active" : undefined} key={label} className={index === 0 ? "rounded-lg bg-primary p-3 text-primary-foreground shadow-sm" : "rounded-lg border border-border p-3 text-muted-foreground"}>
              <span className="text-[10px]">0{index + 1}</span><span className="ml-2 text-xs font-medium">{label}</span>
            </li>
          ))}
        </ol>

        <section data-testid="itv-step-1" className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm lg:p-8">
          <div className="grid gap-6">
            <Field label="访谈名称" hint="用于历史记录和报告标题">
              <input data-testid="itv-create-name" value={name} onChange={(event) => setName(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/30" placeholder="例如：德国储能采购决策链调研" />
            </Field>
            <Field label="标签" hint="至少一个；使用逗号分隔">
              <input data-testid="itv-create-tags" value={tags} onChange={(event) => setTags(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/30" placeholder="采购决策，德国市场" />
            </Field>
            <Field label="访谈主题" hint="用一句业务问题说明需要验证什么">
              <textarea data-testid="itv-create-topic" value={topic} onChange={(event) => setTopic(event.target.value)} className="min-h-36 w-full resize-y rounded-lg border border-border bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/30" placeholder="德国工商业储能客户在采购时，谁拥有最终否决权？" />
            </Field>
          </div>

          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground"><Check className="size-4 text-primary" /> 本步骤只保存草稿</div>
            <p className="mt-1">下一步进入 Mock 专家预览。当前不会写入正式访谈数据。</p>
          </div>
          {error && <p role="alert" className="mt-4 text-sm text-destructive">创建失败：{error}</p>}
          <div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-border pt-6">
            <Link href="/itv?tab=history" className="inline-flex h-11 items-center rounded-lg border border-border px-5 text-sm font-medium">取消</Link>
            <button data-testid="itv-create-submit" type="button" disabled={!valid || busy} onClick={submit} className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm disabled:bg-disabled disabled:text-disabled-foreground">
              {busy ? "正在创建…" : "创建 Mock 访谈"}<ArrowRight className="size-4" />
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return <label className="grid gap-2"><span className="text-sm font-medium">{label}<span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span></span>{children}</label>;
}
