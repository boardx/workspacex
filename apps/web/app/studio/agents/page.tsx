import { Bot } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";

import { AGENTS_NAV_LABEL } from "@/lib/navigation";
import { PREVIEW_AGENT_TEAMS } from "@/lib/mock/agent-previews";

export default function AgentsPage() {
  return (
    <AppShell previewRole={null}>
      <div className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div data-testid="agents-home-page" className="mx-auto w-full max-w-screen-2xl px-5 py-6 md:px-8 lg:px-10">
          <header className="space-y-2">
            <p className="text-11 font-medium text-muted-foreground">Studio / {AGENTS_NAV_LABEL}</p>
            <div className="flex items-center gap-2">
              <h1 className="text-24 font-semibold tracking-tight">{AGENTS_NAV_LABEL}</h1>
              <span className="text-18 text-muted-foreground">· {PREVIEW_AGENT_TEAMS.length}</span>
            </div>
            <p className="text-12 leading-relaxed text-muted-foreground">六个 team，各自对应一个 Agent 的项目。当前为示例展示，暂未开放使用。</p>
          </header>
          <section aria-label={`${AGENTS_NAV_LABEL}列表`} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PREVIEW_AGENT_TEAMS.map((team, index) => (
              <article key={team.slug} data-testid={`agent-preview-${index + 1}`} className="flex min-h-64 min-w-0 flex-col rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm">
                {/* 整张卡片可点（`absolute inset-0` 覆盖层），落到该 team 自己的路由； */}
                {/* 覆盖层挂在标题链接上，卡片内不再有第二个竞争的点击目标。 */}
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <h2 className="text-14 font-semibold">
                    <Link
                      href={`/studio/agents/${team.slug}`}
                      data-testid={`agent-preview-link-${team.slug}`}
                      className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {team.name}
                    </Link>
                  </h2>
                  <Bot aria-hidden className="my-6 size-8 text-muted-foreground" />
                  <p className="mt-auto text-12 text-muted-foreground">{team.summary}</p>
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
