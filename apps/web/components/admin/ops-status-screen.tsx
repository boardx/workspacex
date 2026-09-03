"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { sendTestEmail, type SendTestEmailOut } from "@/lib/live-system-errors";
import type { UiState } from "@/lib/ui-state";

/**
 * OPS-1 —— 平台后台「运营状态」屏。
 *
 * 2026-09-03 人类反馈：「测试邮件的功能不要放在系统异常下面，放到平台后台的一个
 * 新的菜单叫运营状态」——原来挂在「反馈与迭代 → 系统异常」tab 顶部的 `TestMailPanel`
 * 搬到这里独立成一个入口。它不是"反馈"（没有提交人、没有分诊动作），是运维自查
 * 这个部署本身是否健康的工具，混在反馈收件箱里语义不对。
 *
 * 目前只有「测试邮件」一块内容；以后其他运营自查工具（部署健康、依赖探活……）
 * 按同一模式加进来，不需要再挪一次菜单。
 */
export function OpsStatusScreen({ state }: { state: UiState }) {
  return (
    <AdminScreen
      state={state}
      moduleLabel="运营状态"
      title="运营状态"
      liveBacked
      hideOrgIdentity
      intro="运维自查工具——验证这个部署本身是否健康，不是用户反馈收件箱。"
      emptyHint="还没有运营自查项"
      denialReason="仅平台运维（平台超管白名单，或被超管指定的平台管理员）可用。"
      successMessage="操作已完成"
    >
      <div className="flex flex-col gap-4">
        <TestMailPanel />
      </div>
    </AdminScreen>
  );
}

function describeFailure(err: unknown): string {
  if (err instanceof ApiError) return err.reasonCode ?? `http_${err.status}`;
  if (err instanceof TypeError) return "无法连接服务器，请稍后重试";
  return String(err);
}

/** 设计稿的时间格式：`2026/9/2 11:20`。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

type TestMailState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; out: SendTestEmailOut }
  | { kind: "failed"; reasonCode: string; category: string | null };

/**
 * 「测试邮件」——人类 2026-09-02 要求：后台要能验证邮件发不发得出。走的是生产同一条
 * 事务邮件通路（`POST /system/mail/test`，见契约头注），不是另一套测试通路；失败
 * 如实报契约码 + 适配器归好类的 `category`，成功报收件人与供应商回执 id。
 *
 * ⚠ 与旧位置（「反馈与迭代 → 系统异常」tab）不同，这里没有先读一次系统异常列表来
 *   判断"当前账号是不是平台运维"——`sendTestEmail` 本身就是同一道超管门，非运维账号
 *   点发送会收到 `NOT_PLATFORM_SUPERUSER`，下面单独渲染成一句说明，不是让它落进
 *   通用失败文案。
 */
function TestMailPanel() {
  const [to, setTo] = React.useState("");
  const [state, setState] = React.useState<TestMailState>({ kind: "idle" });

  const send = async () => {
    setState({ kind: "sending" });
    try {
      const out = await sendTestEmail(to);
      setState({ kind: "sent", out });
    } catch (err) {
      const body = err instanceof ApiError ? (err.raw as { category?: unknown } | null | undefined) : null;
      setState({
        kind: "failed",
        reasonCode: describeFailure(err),
        category: typeof body?.category === "string" ? body.category : null,
      });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4" data-testid="admin-ops-status-test-mail">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold">测试邮件</h3>
        <p className="text-11 text-muted-foreground">
          用生产同一条事务邮件通路发一封测试邮件——反馈确认 / 状态变更邮件都是 best-effort、失败只记日志，这里把结果直接摆出来。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={to}
          onChange={(e) => { setTo(e.target.value); if (state.kind !== "sending") setState({ kind: "idle" }); }}
          placeholder="收件人邮箱（留空 = 发给当前账号）"
          aria-label="测试邮件收件人"
          type="email"
          data-testid="admin-ops-status-test-mail-to"
          className="h-8 w-80 max-w-full rounded-md border border-border-subtle bg-card px-2.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button size="sm" variant="primary" disabled={state.kind === "sending"} onClick={() => void send()} data-testid="admin-ops-status-test-mail-send">
          {state.kind === "sending" && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
          发送测试邮件
        </Button>
      </div>
      {state.kind === "sent" && (
        <p className="text-12 text-card-foreground" data-testid="admin-ops-status-test-mail-sent">
          已发送到 <span className="font-medium">{state.out.sentTo}</span>（{formatTime(state.out.sentAt)}）
          {state.out.providerMessageId !== null && (
            <span className="text-muted-foreground"> · 供应商回执 <code className="font-mono text-11">{state.out.providerMessageId}</code></span>
          )}
          。请到收件箱确认——主题「{state.out.subject}」。
        </p>
      )}
      {state.kind === "failed" && (
        <p className="text-12 text-destructive" data-testid="admin-ops-status-test-mail-failed">
          {state.reasonCode === "NOT_PLATFORM_SUPERUSER"
            ? "这个功能仅平台运维（平台超管白名单，或被超管指定的平台管理员）可用——你当前的账号不是。"
            : state.reasonCode === "MAIL_NOT_CONFIGURED"
              ? "这个部署没有配置事务邮件（缺 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_TXN_EMAIL_API_TOKEN / MAIL_FROM 之一）。"
              : state.reasonCode === "NO_RECIPIENT"
                ? "没有收件人：当前账号查不到邮箱，请填一个收件人。"
                : `没发出去（${state.reasonCode}${state.category !== null ? ` · ${state.category}` : ""}）。`}
        </p>
      )}
    </div>
  );
}
