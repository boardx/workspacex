"use client";

import Link from "next/link";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { findMockDigitalExpert } from "@/lib/mock/digital-expert-personas";

export function DigitalExpertDetail({ expertId }: { expertId: string }) {
  const expert = findMockDigitalExpert(expertId);

  if (!expert) {
    return (
      <main className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
        未找到该 Mock 专家。
      </main>
    );
  }

  return (
    <main data-testid="itv-expert-detail" className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-8 lg:px-10 lg:py-10">
        <Link
          href="/itv?tab=experts"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> 返回专家列表
        </Link>

        <article className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm lg:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-base font-semibold text-primary">
                {expert.initials}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold">{expert.displayName}</h1>
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">Mock 专家</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{expert.role}</p>
                <p className="mt-1 text-xs text-muted-foreground">{expert.location}</p>
              </div>
            </div>
            <Link
              data-testid="itv-expert-detail-quick"
              href={`/itv/quick/new?expertId=${encodeURIComponent(expert.expertId)}`}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm"
            >
              <MessageSquare className="size-4" aria-hidden /> 快捷访谈
            </Link>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <section className="rounded-xl border border-border p-5">
              <h2 className="text-sm font-semibold">专家背景</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{expert.bio}</p>
            </section>
            <section className="rounded-xl border border-border p-5">
              <h2 className="text-sm font-semibold">典型建议</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{expert.typicalAdvice}</p>
            </section>
          </div>

          <div className="mt-5 rounded-xl bg-muted/60 p-4 text-xs leading-6 text-muted-foreground">
            <span className="font-medium text-foreground">使用边界：</span>{expert.materialBoundary}
          </div>
        </article>
      </div>
    </main>
  );
}
