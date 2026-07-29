import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { THREAD_GROUPS, type ThreadBadgeKind } from "@/lib/mock/chat";
import { ChatTeamPanel } from "./chat-team-panel";

/**
 * 对话屏左栏（272px）—— UC-8.2 R8 信息架构：
 *   顶部 **AI 团队面板**（常驻，UC-8.2 R3 一 / UC-4.2）+ 线程列表（UC-8.1）。
 * 服务端组件渲染；交互部分下沉到客户端叶子 `ChatTeamPanel`。
 */
export function ChatLeftPanel() {
  return (
    <div className="flex flex-col" data-testid="chat-left-panel">
      <div className="p-3">
        <Button variant="secondary" size="sm" className="w-full justify-start" asChild data-testid="chat-new-thread">
          <Link href="/chat">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            新建对话
          </Link>
        </Button>
      </div>

      <Separator />

      {/* ── AI 团队面板（编制数 = 6，UC-4.2 R6 两个计数口径分别标注）── */}
      <ChatTeamPanel />

      <Separator />

      {/* ── 线程列表（今天 / 本周 / 周三 分组，UC-8.1 R3）── */}
      <nav className="flex flex-col gap-3 p-3" data-testid="chat-thread-list" aria-label="对话线程列表">
        {THREAD_GROUPS.map((g) => (
          <div key={g.key} className="flex flex-col gap-1">
            <h3 className="px-1 text-10 font-medium uppercase tracking-wide text-muted-foreground">
              {g.label}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {g.threads.map((t) => (
                <li key={t.id}>
                  <a
                    href={`/chat?thread=${t.id}`}
                    data-testid={`chat-thread-${t.id}`}
                    aria-current={t.active ? "page" : undefined}
                    className={
                      "flex flex-col gap-1 rounded-md px-2 py-1.5 transition-colors duration-200 hover:bg-muted " +
                      (t.active ? "bg-muted" : "")
                    }
                  >
                    <span className="line-clamp-2 text-12 font-medium">{t.title}</span>
                    <span className="flex items-center gap-1.5">
                      {t.badge && <ThreadBadge kind={t.badge.kind} label={t.badge.label} />}
                      {t.meta && <span className="text-10 text-muted-foreground">{t.meta}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

/** 线程卡徽标 —— 一等取值映射到 token 色调（UC-8.1 R7）*/
function ThreadBadge({ kind, label }: { kind: ThreadBadgeKind; label: string }) {
  if (kind === "transcribing") {
    return (
      <Badge tone="primary" className="gap-1">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
        {label}
      </Badge>
    );
  }
  if (kind === "review") return <Badge tone="warning">{label}</Badge>;
  if (kind === "archived") return <Badge tone="neutral">{label}</Badge>;
  if (kind === "agents") return <Badge tone="ai">{label}</Badge>;
  return <Badge tone="outline">{label}</Badge>;
}
