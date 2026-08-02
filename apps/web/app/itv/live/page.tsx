"use client";

/**
 * #356 —— `/itv/live`：访谈列表的第一条真正端到端路径，接的是
 * `interview-scope.controller.ts` 真实暴露的两条读路由（`GET /interviews`、
 * `GET /interviews/:interviewId`）。
 *
 * ## 为什么是新路由，不是把 `/itv` 接上真数据
 *
 * `apps/web/app/itv/page.tsx` 是 UI 先行原型 v2：`lib/mock/itv.ts` 近 900 行，
 * 覆盖模板库/向导/研究设计/质性现场/虚拟专家/证据矩阵/洞察报告——这些展示字段
 * （`InterviewRowView.progress/metric/templateName/actions`、`VirtualExpert`、
 * `MatrixRow`……）在契约 `interview.ts` 里确实存在对应的 operations（wizard、
 * outline、research-plan、rq-coverage……），但 `apps/api/src/interface/controllers/`
 * 下**只有 `interview-scope.controller.ts` 一个文件**，只实现了 `listInterviews` /
 * `getInterview` / `attachToProjectStep` / `detachFromProjectStep` 四条。
 * 硬接 `/itv` 意味着要么把绝大多数展示字段的取数来源现编出来（`design-coherence.md`
 * 点名过的事故：编一个看起来算过的数），要么把整屏拆得七零八落。两者都不是这次
 * 该交付的东西——与 F122 开 `/project/live` 而不是碰 `/projects` 的理由完全同型。
 *
 * `/itv` 保持不动；这里新开一条干净路由，只做「登录 → 选范围 → 刷新列表 → 点开一条
 * 看详情」，证明这条链路在真实 HTTP + 真实 Postgres 上成立。
 *
 * ## 已知缺口（#356 调查结论，不在这里假装解决）
 *
 * 模板库 / 套用模板新建访谈 / 研究设计 / 质性现场记录 / 虚拟专家推演 / 证据矩阵 /
 * 洞察报告——`lib/mock/itv.ts` 里这些板块背后，此刻没有一个真实 controller 可挂。
 * F86（consent-token 持久化）已经换成真实 Postgres（本 issue 的另一半），但签署
 * 令牌/门户令牌/授权页三条 use case 同样没有 controller，无法从前端触发。
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, clearStoredSessionToken, getStoredSessionToken, storeSessionToken } from "@/lib/api-client";
import { getInterview, listInterviews, login, type GetInterviewOut, type InterviewRow } from "@/lib/live-interviews";

function InterviewItem({
  item,
  onOpen,
}: {
  item: InterviewRow;
  onOpen: (id: string) => void;
}) {
  return (
    <li
      data-testid={`live-itv-item-${item.interviewId}`}
      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-13"
    >
      <button
        type="button"
        data-testid={`live-itv-open-${item.interviewId}`}
        className="text-left font-medium underline-offset-2 transition-colors hover:underline"
        onClick={() => onOpen(item.interviewId)}
      >
        {item.title}
      </button>
      <span className="flex items-center gap-2 text-12 text-muted-foreground">
        <span data-testid={`live-itv-source-${item.interviewId}`}>
          {item.sourceKind === "human" ? "真人" : "虚拟"}
        </span>
        {item.archived ? (
          <span data-testid={`live-itv-archived-${item.interviewId}`} className="rounded bg-muted px-1.5 py-0.5">
            已归档
          </span>
        ) : null}
      </span>
    </li>
  );
}

export default function ItvLivePage() {
  const [sessionToken, setSessionToken] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loginBusy, setLoginBusy] = React.useState(false);

  const [scopeKind, setScopeKind] = React.useState<"project" | "research" | "none">("none");
  const [projectId, setProjectId] = React.useState("");
  const [researchProjectId, setResearchProjectId] = React.useState("");

  const [items, setItems] = React.useState<InterviewRow[] | null>(null);
  const [counts, setCounts] = React.useState<{ human: number; virtual: number } | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [listBusy, setListBusy] = React.useState(false);

  const [detail, setDetail] = React.useState<GetInterviewOut | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSessionToken(getStoredSessionToken());
  }, []);

  const refresh = React.useCallback(async () => {
    setListBusy(true);
    setListError(null);
    setDetail(null);
    setDetailError(null);
    try {
      const out = await listInterviews({
        scope: {
          kind: scopeKind,
          projectId: scopeKind === "project" && projectId !== "" ? projectId : null,
          researchProjectId: scopeKind === "research" && researchProjectId !== "" ? researchProjectId : null,
        },
      });
      setItems([...out.items]);
      setCounts({ ...out.counts });
    } catch (e) {
      setListError(describeError(e));
      setItems(null);
      setCounts(null);
    } finally {
      setListBusy(false);
    }
  }, [scopeKind, projectId, researchProjectId]);

  async function handleOpen(interviewId: string) {
    setDetailError(null);
    setDetail(null);
    try {
      const out = await getInterview(interviewId);
      setDetail(out);
    } catch (e) {
      setDetailError(describeError(e));
    }
  }

  async function handleLogin(ev: React.FormEvent) {
    ev.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    try {
      const out = await login(email, password);
      storeSessionToken(out.sessionToken);
      setSessionToken(out.sessionToken);
    } catch (e) {
      setLoginError(describeError(e));
    } finally {
      setLoginBusy(false);
    }
  }

  function handleLogout() {
    clearStoredSessionToken();
    setSessionToken(null);
    setItems(null);
    setCounts(null);
    setDetail(null);
  }

  return (
    <div data-testid="itv-live-page" className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-16 font-semibold">访谈列表（真实数据，#356）</h1>

      {sessionToken === null ? (
        <Card data-testid="live-itv-login-card">
          <CardHeader>
            <CardTitle>登录</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-2" onSubmit={handleLogin}>
              <Input
                data-testid="live-itv-login-email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                data-testid="live-itv-login-password"
                placeholder="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button data-testid="live-itv-login-submit" type="submit" disabled={loginBusy}>
                {loginBusy ? "登录中…" : "登录"}
              </Button>
              {loginError !== null ? (
                <p data-testid="live-itv-login-error" className="text-12 text-destructive">
                  {loginError}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              data-testid="live-itv-scope-kind"
              className="h-8 rounded-md border border-input bg-card px-2.5 text-13"
              value={scopeKind}
              onChange={(e) => setScopeKind(e.target.value as typeof scopeKind)}
            >
              <option value="none">不属于任何项目</option>
              <option value="project">项目</option>
              <option value="research">研究项目</option>
            </select>
            {scopeKind === "project" ? (
              <Input
                data-testid="live-itv-project-id"
                placeholder="项目 id"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="max-w-xs"
              />
            ) : null}
            {scopeKind === "research" ? (
              <Input
                data-testid="live-itv-research-id"
                placeholder="研究项目 id"
                value={researchProjectId}
                onChange={(e) => setResearchProjectId(e.target.value)}
                className="max-w-xs"
              />
            ) : null}
            <Button data-testid="live-itv-refresh" onClick={refresh} disabled={listBusy}>
              {listBusy ? "加载中…" : "刷新列表"}
            </Button>
            <Button data-testid="live-itv-logout" variant="ghost" onClick={handleLogout}>
              退出登录
            </Button>
          </div>

          {listError !== null ? (
            <p data-testid="live-itv-list-error" className="text-12 text-destructive">
              {listError}
            </p>
          ) : null}

          {counts !== null ? (
            <p data-testid="live-itv-counts" className="text-12 text-muted-foreground">
              真人 {counts.human} · 虚拟 {counts.virtual}
            </p>
          ) : null}

          {items !== null ? (
            items.length === 0 ? (
              <p data-testid="live-itv-empty-state" className="text-12 text-muted-foreground">
                本范围暂无访谈。
              </p>
            ) : (
              <ul data-testid="live-itv-list" className="flex flex-col gap-1">
                {items.map((it) => (
                  <InterviewItem key={it.interviewId} item={it} onOpen={handleOpen} />
                ))}
              </ul>
            )
          ) : (
            <p data-testid="live-itv-list-empty-state" className="text-12 text-muted-foreground">
              还没有加载列表——选范围后点「刷新列表」。
            </p>
          )}

          {detailError !== null ? (
            <p data-testid="live-itv-detail-error" className="text-12 text-destructive">
              {detailError}
            </p>
          ) : null}

          {detail !== null ? (
            <Card data-testid="live-itv-detail-card">
              <CardHeader>
                <CardTitle>{detail.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-13">
                <span data-testid="live-itv-detail-source">
                  来源：{detail.sourceKind === "human" ? "真人" : "虚拟"}
                </span>
                <span data-testid="live-itv-detail-outline-status">
                  提纲状态：{detail.outlineStatus ?? "（尚未生成）"}
                </span>
                <span data-testid="live-itv-detail-started-at">
                  开始时间：{detail.startedAt ?? "（尚未开始）"}
                </span>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `HTTP ${e.status}`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
