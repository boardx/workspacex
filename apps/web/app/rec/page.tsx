import { RecApp } from "@/components/rec/rec-app";
import { mockIdentity } from "@/lib/identity";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolveRecScreen, resolveCarrier, resolveRecView } from "@/lib/mock/rec";

/**
 * 录音与转写（05-rec · UC-5.1 ~ 5.4）—— 三载体共享一套转写能力的先行原型。
 *
 * ⚠ 服务端组件：只解析 URL、组装身份，把可序列化 props 交给客户端 RecApp。
 *    事件处理器一律下沉到 RecApp 及其子组件（"use client"）。
 *    真实权限在服务端 NestJS Guard + PostgreSQL RLS；这里的视角/载体/状态切换只是预览。
 */
export default function RecPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; screen?: string; carrier?: string };
}) {
  const uiState = resolvePreviewState(searchParams.state);
  const view = resolveRecView(searchParams.as);
  // 视角映射到项目角色（受访者是场景身份，用 member 作项目层投影，仅影响 shell 顶部展示）
  const projectRole = view === "interviewee" ? "member" : view;
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", projectRole);
  const screen = resolveRecScreen(searchParams.screen);
  const carrier = resolveCarrier(searchParams.carrier);

  return (
    <RecApp
      identity={identity}
      uiState={uiState}
      screen={screen}
      carrier={carrier}
      view={view}
      qs={{ as: searchParams.as, carrier: searchParams.carrier, org: searchParams.org }}
    />
  );
}
