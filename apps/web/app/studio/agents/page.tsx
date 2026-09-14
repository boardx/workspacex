import { Bot } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";

import { PREVIEW_AGENTS } from "@/lib/mock/agent-previews";

export default function AgentsPage() {
  return (
    <AppShell previewRole={null}>
      <div className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div data-testid="agents-home-page" className="mx-auto w-full max-w-screen-2xl px-5 py-6 md:px-8 lg:px-10">
          <header className="space-y-2">
            <p className="text-11 font-medium text-muted-foreground">Studio / 智能体</p>
            <div className="flex items-center gap-2">
              <h1 className="text-24 font-semibold tracking-tight">智能体</h1>
              <span className="text-18 text-muted-foreground">· {PREVIEW_AGENTS.length}</span>
            </div>
            <p className="text-12 leading-relaxed text-muted-foreground">浏览智能体。当前为示例展示，暂未开放使用。</p>
          </header>
          <section aria-label="智能体列表" className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {PREVIEW_AGENTS.map((name, index) => (
              <article key={name} data-testid={`agent-preview-${index + 1}`} className="flex min-h-64 min-w-0 flex-col rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm">
                <h2 className="text-14 font-semibold">{name}</h2>
                <Bot aria-hidden className="my-6 size-8 text-muted-foreground" />
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <p className="text-12 text-muted-foreground">示例智能体 · 仅供展示</p>
                  <Button asChild variant="outline" size="sm" className="ml-auto">
                    <Link href="/projects">查看项目</Link>
                  </Button>
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
