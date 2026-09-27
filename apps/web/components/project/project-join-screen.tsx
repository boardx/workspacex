"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { acceptProjectInvite, PROJECT_JOIN_PAGE_PATH, PROJECT_INVITE_TOKEN_PARAM } from "@/lib/live-project-invite";

/**
 * 项目邀请链接落地页（项目中枢 R2）：`/projects/join?t=<token>`。
 *
 * 三态：
 *   · 未登录 ⇒ 跳登录，`next` 带回本页（登录后自动回来接受）；
 *   · 已登录 ⇒ 自动调 `acceptProjectInvite`，成功后进项目；
 *   · 失败 ⇒ 四种链接失效对参与者渲染成同一句「找引导师重发」（契约 E1，不泄露项目是否存在），
 *     不是组织成员 / 项目已归档 各自说明。
 */
export function ProjectJoinScreen({ token }: { token: string | null }) {
  const router = useRouter();
  const session = useOptionalSession();
  const status = session?.status ?? "loading";
  const [state, setState] = React.useState<{ kind: "idle" | "accepting" | "done" | "failed"; message?: string; projectId?: string }>({ kind: "idle" });
  // 只接受一次：用 ref 而不是把 state 放进 effect 依赖——否则 setState 触发的重跑会先执行
  // cleanup、把 `cancelled` 置 true，结果被自己丢掉。
  const startedRef = React.useRef(false);
  // 路由器同理放 ref：effect 依赖里只留会真正改变结论的 status / token。
  const routerRef = React.useRef(router);
  routerRef.current = router;

  const selfUrl = `${PROJECT_JOIN_PAGE_PATH}?${PROJECT_INVITE_TOKEN_PARAM}=${encodeURIComponent(token ?? "")}`;

  React.useEffect(() => {
    if (status === "anonymous") {
      routerRef.current.replace(`/login?next=${encodeURIComponent(selfUrl)}`);
      return;
    }
    if (status !== "authenticated" || startedRef.current) return;
    startedRef.current = true;
    if (!token) {
      setState({ kind: "failed", message: "这个链接没有带邀请令牌，请向引导师索取完整链接。" });
      return;
    }
    setState({ kind: "accepting" });
    let cancelled = false;
    acceptProjectInvite(token)
      .then((out) => {
        if (cancelled) return;
        setState({ kind: "done", projectId: out.projectId, message: out.alreadyMember ? "你已经在这个项目里了。" : "已加入项目。" });
        routerRef.current.replace(`/projects/${encodeURIComponent(out.projectId)}`);
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "failed", message: describeFailure(e) });
      });
    return () => { cancelled = true; };
  }, [status, token, selfUrl]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6" data-testid="project-join">
      <span className="text-11 font-medium uppercase tracking-widest text-muted-foreground">WorkspaceX</span>
      <h1 className="text-16 font-semibold">加入项目</h1>
      {state.kind === "failed" ? (
        <>
          <p className="text-12 leading-relaxed text-destructive" data-testid="project-join-error">{state.message}</p>
          <div>
            <Button asChild size="sm" variant="outline" data-testid="project-join-back">
              <a href="/projects">回到我的项目</a>
            </Button>
          </div>
        </>
      ) : state.kind === "done" ? (
        <p className="text-12 text-muted-foreground" data-testid="project-join-done">{state.message} 正在进入…</p>
      ) : (
        <p className="text-12 text-muted-foreground" data-testid="project-join-pending">
          {status === "authenticated" ? "正在用邀请链接把你加进项目…" : "正在确认登录状态…"}
        </p>
      )}
    </div>
  );
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "INVITE_NOT_FOUND":
      case "LINK_REVOKED":
      case "LINK_EXPIRED":
      case "LINK_ALREADY_USED":
      case "LINK_TOKEN_REQUIRED":
        return "这条邀请链接已不可用，请找引导师重新发一条。";
      case "NO_ORG_MEMBERSHIP":
        return "你当前登录的账号不是这个项目所属组织的成员，请先加入组织或切换到对应组织。";
      case "FORBIDDEN":
        return "这个项目已归档，不能再加入。";
      case "AUTH_SERVICE_UNAVAILABLE":
        return "身份校验服务暂时不可用，请稍后重试。";
    }
    if (e.status === 401) return "登录已失效，请重新登录后再打开链接。";
    return `${e.reasonCode ?? "加入失败"}（HTTP ${e.status}）`;
  }
  return e instanceof Error ? e.message : "加入失败，请稍后重试。";
}
