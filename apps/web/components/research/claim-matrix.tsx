import { Link2, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CLAIMS, READ_ITEMS, EVIDENCE_KIND_LABEL } from "@/lib/mock/research";

/**
 * 研究 · 右栏：洞察矩阵 / Claim（UC-6.5 AC1：每条能点回原始证据）。
 * 无锚点的结论视为不合格——每个 Claim 都列出它引用的读入项并可跳转。
 */
const CONF_TONE = { high: "primary", medium: "warning", low: "outline" } as const;
const CONF_LABEL = { high: "高置信", medium: "中置信", low: "低置信" } as const;

export function ClaimMatrix() {
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="research-claims">
      <div className="flex items-center gap-1.5">
        <GitBranch aria-hidden className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-13 font-semibold">洞察矩阵</h2>
      </div>
      <p className="text-10 text-muted-foreground">
        每条结论都从上下文包的读入证据推出，可点回原始证据。丢弃的证据不在这里出现。
      </p>
      <ul className="flex flex-col gap-2">
        {CLAIMS.map((c) => (
          <li key={c.id} data-testid={`research-claim-${c.id}`} className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2">
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone="outline">{c.theme}</Badge>
              <Badge tone={CONF_TONE[c.confidence]}>{CONF_LABEL[c.confidence]}</Badge>
            </div>
            <p className="text-11 leading-snug">{c.text}</p>
            <div className="flex flex-col gap-0.5 rounded-sm bg-muted p-1.5">
              <span className="text-9 font-medium text-muted-foreground">支撑证据 · {c.evidenceIds.length}</span>
              {c.evidenceIds.map((eid) => {
                const ev = READ_ITEMS.find((r) => r.id === eid);
                if (!ev) return null;
                return (
                  <a
                    key={eid}
                    href={`#research-read-${eid}`}
                    data-testid={`research-claim-anchor-${c.id}-${eid}`}
                    className="flex items-center gap-1 rounded-sm p-0.5 text-10 transition-colors duration-200 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Link2 aria-hidden className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{EVIDENCE_KIND_LABEL[ev.kind]} · {ev.title}</span>
                    <span className="shrink-0 font-mono text-9 text-primary">{ev.anchorLabel}</span>
                  </a>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
