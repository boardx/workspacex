"use client";

/**
 * `/agent/team2` 的真实聊天界面（issue #3676，替换此前的 mock 原型
 * `rating-workbench.tsx`——那份原型仍保留在仓库供签核材料回溯，但不再是这个
 * 路由渲染的东西）。
 *
 * 这是「真聊天框 + 真算分」的实现：用户在对话框里贴结构化财务数据，
 * 前端直接调用真实的 `POST /postinvest-ratings/score`（生产 controller，
 * 底下是确定性评分引擎，issue #3676 已交付），把服务端返回的真实结果
 * 渲染成一条助手消息。**不经过模型/Agent 工具调用循环**——数值全部来自
 * `apps/api/src/domain/postinvest-rating/scoring.ts`，不是任何地方编出来的。
 *
 * 权限：本页不再传 mock identity，走真实登录会话（同其余 team 页一致），
 * 未登录会被 `AppShell` 的 `SessionAppShell` 引导去登录。
 */
import * as React from "react";
import { apiRequest, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SAMPLE_FINANCIALS, SAMPLE_FACTS } from "@/lib/postinvest-rating/sample-input";

/** 与 `PostinvestRatingController` 的响应形状对应，命名刻意不撞契约束的类型名（ADR-020）。 */
interface ChatScoreResponse {
  grade: "A" | "B" | "C" | "D" | "E" | null;
  scores: {
    revenueSizeScore: number | null;
    revenueGrowthScore: number | null;
    s1: number | null;
    profitLevelScore: number | null;
    profitGrowthScore: number | null;
    s2: number | null;
    cashSelfSufficiencyMonths: number | null;
    s3: number | null;
    total: number | null;
  };
  flags: string[];
  downgrade: "D" | "E" | null;
  cannotRateReason: string | null;
}

const FLAG_LABEL: Record<string, string> = {
  incomplete: "数据不完整",
  estimated: "数据暂估",
  business_abnormal: "公司经营异常",
  suspected_abnormal: "数据疑似异常",
};

/**
 * 语义 token 而非硬编码颜色（uiux-standards §1）。与 `lib/postinvest-rating/grade-visual.ts`
 * 用同一组既有语义色（success/ai/warning/destructive）——设计 token 单源暂无 rating 专用
 * 色阶，E/D 暂共用 destructive，待人类拍板是否新增（同一缺口，两处只占位、不复述数值）。
 */
const GRADE_STYLE: Record<string, string> = {
  A: "border-success bg-success text-success-foreground",
  B: "border-ai bg-ai-tint text-ai-tint-foreground",
  C: "border-warning bg-warning text-warning-foreground",
  D: "border-destructive bg-destructive text-destructive-foreground",
  E: "border-destructive bg-destructive text-destructive-foreground",
};

type ChatMessage =
  | { id: string; role: "assistant"; kind: "intro" }
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "result"; data: ChatScoreResponse }
  | { id: string; role: "assistant"; kind: "error"; status: number; reasonCode: string | null };

let seq = 0;
function nextId(): string {
  seq += 1;
  return `msg-${seq}`;
}

const SAMPLE_TEXT = JSON.stringify({ financials: SAMPLE_FINANCIALS, facts: SAMPLE_FACTS }, null, 2);

export function RatingChat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([{ id: nextId(), role: "assistant", kind: "intro" }]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  function fillSample() {
    setInput(SAMPLE_TEXT);
  }

  async function send() {
    const raw = input.trim();
    if (!raw || sending) return;
    setMessages((prev) => [...prev, { id: nextId(), role: "user", kind: "text", text: raw }]);
    setInput("");

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", kind: "error", status: 0, reasonCode: "postinvest_rating_score_invalid_json" }]);
      return;
    }

    setSending(true);
    try {
      const result = await apiRequest<ChatScoreResponse>("/postinvest-ratings/score", { method: "POST", body });
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", kind: "result", data: result }]);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const reasonCode = err instanceof ApiError ? err.reasonCode : null;
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", kind: "error", status, reasonCode }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div data-testid="postinvest-rating-chat" className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-5 py-6">
      <header className="mb-4">
        <h1 className="text-20 font-semibold tracking-tight">投后财务项目评级 Agent</h1>
        <p className="mt-1 text-12 text-muted-foreground">
          贴入已抽取好的结构化财务字段（JSON），得到真实计算的 A–E 评级。评级由确定性脚本算出，不由模型猜测。
        </p>
      </header>

      <div ref={listRef} data-testid="postinvest-rating-chat-messages" className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-4">
        {messages.map((m, i) => (
          <MessageBubble key={m.id} message={m} index={i} />
        ))}
        {sending && (
          <div data-testid="postinvest-rating-chat-thinking" className="text-12 text-muted-foreground">
            评分引擎计算中…
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" data-testid="postinvest-rating-chat-fill-sample" onClick={fillSample}>
            填入示例数据
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            data-testid="postinvest-rating-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='粘贴 { "financials": {...}, "facts": {...} } 格式的 JSON'
            rows={6}
            className="flex-1 font-mono text-12"
            disabled={sending}
          />
          <Button type="button" data-testid="postinvest-rating-chat-send" onClick={send} disabled={sending || !input.trim()}>
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, index }: { message: ChatMessage; index: number }) {
  const align = message.role === "user" ? "items-end" : "items-start";
  return (
    <div data-testid={`postinvest-rating-chat-message-${index}`} className={cn("flex flex-col gap-1", align)}>
      {message.kind === "intro" && (
        <Bubble role="assistant">
          <p>把已抽取好的财务字段贴进来（示例见下方按钮），我会用确定性评分脚本算出投后评级。</p>
        </Bubble>
      )}
      {message.kind === "text" && (
        <Bubble role="user">
          <pre className="whitespace-pre-wrap break-all font-mono text-11">{message.text}</pre>
        </Bubble>
      )}
      {message.kind === "result" && <ResultBubble data={message.data} />}
      {message.kind === "error" && (
        <Bubble role="assistant" tone="error">
          <p data-testid="postinvest-rating-chat-error-code">
            请求未成功（status {message.status}{message.reasonCode ? `，reasonCode: ${message.reasonCode}` : ""}）。
          </p>
        </Bubble>
      )}
    </div>
  );
}

function Bubble({ role, tone, children }: { role: "user" | "assistant"; tone?: "error"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-lg border px-3 py-2 text-13",
        role === "user" ? "border-border bg-muted" : "border-border bg-background",
        tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive"
      )}
    >
      {children}
    </div>
  );
}

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function ResultBubble({ data }: { data: ChatScoreResponse }) {
  if (data.grade === null) {
    return (
      <Bubble role="assistant">
        <p data-testid="postinvest-rating-chat-no-grade">未出分：{data.cannotRateReason ?? "缺少必要字段"}</p>
      </Bubble>
    );
  }
  return (
    <Bubble role="assistant">
      <div data-testid="postinvest-rating-chat-result" className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            data-testid="postinvest-rating-chat-grade"
            className={cn("inline-flex size-8 items-center justify-center rounded-full border text-16 font-semibold", GRADE_STYLE[data.grade])}
          >
            {data.grade}
          </span>
          <span data-testid="postinvest-rating-chat-total" className="text-14 font-medium">
            总分 {fmt(data.scores.total)}
          </span>
          {data.downgrade && (
            <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-11 text-destructive">
              触发降级 → {data.downgrade}
            </span>
          )}
        </div>
        <p className="text-11 text-muted-foreground">
          S1 {fmt(data.scores.s1)} · S2 {fmt(data.scores.s2)} · S3 {fmt(data.scores.s3)}
        </p>
        {data.flags.length > 0 && (
          <div data-testid="postinvest-rating-chat-flags" className="flex flex-wrap gap-1">
            {data.flags.map((f) => (
              <span key={f} className="rounded-full border border-border bg-muted px-2 py-0.5 text-11">
                {FLAG_LABEL[f] ?? f}
              </span>
            ))}
          </div>
        )}
      </div>
    </Bubble>
  );
}
