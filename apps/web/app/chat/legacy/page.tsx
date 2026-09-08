import { ChatReadScreen } from "@/components/chat/chat-read-screen";
import { PersonalChatScreen } from "@/components/chat/personal-chat-screen";

/**
 * ⚠ 旧手写 Chat 轨道的入口。**2026-09-07 起这个组件在产品里已经不可达**——
 * 本文件是死代码，不是"回退入口"。
 *
 * ## 现状（issue #2997 实测核对，别再照旧头注推断）
 *
 * `#2890`（`d30ac48e8`）同时做了两件事：① 删掉 `next.config.mjs` `beforeFiles`
 * 里那条把 `?projectId=` 深链改写到本路由的 rewrite；② 在 `redirects()` 里加了
 * `{ source: "/chat/legacy", destination: "/chat" }`。于是 `/chat/legacy` 必然
 * 307 到 `/chat`（v2 工作台），而 `ChatReadScreen` / `PersonalChatScreen`
 * ——连同它们下面的 `chat-live-message-panel.tsx`（1900+ 行）——**没有任何一条
 * 路由再渲染它们**（本仓 `app/` 下这两个组件的引用点只有本文件）。
 *
 * ## 本文件此前的头注是错的，已就地更正（issue #2997）
 *
 * 原文写「带参数的 `/chat?projectId=`/`?thread=` 由 `/chat/page.tsx` 分岔」——
 * 那个文件早在 #2067 就删了，`/chat` 现在由路由组 `(v2)` 独占；分岔逻辑随
 * #2890 一并消失。原文还写「本路由存在到 DA-19h 为止……回退路径消失等于灰度
 * 变成单向门」——回退路径**已经**消失了（#2890 的 redirect），这句话描述的
 * 状态不再存在。留着这两段会让下一个人以为旧屏还活着，正是 AGENTS.md
 * 「静态痕迹 ≠ 动态事实」点名的失效模式。
 *
 * 删不删这三个组件是产品决定，不是顺手改动 —— 已开缺口 issue **#3024** 跟踪。在人类裁决之前本文件原样保留，但**不要把它当成"用户还够得着的回退"**。
 *
 * projectId 分岔逻辑原文（#594，人类本人直接推翻此前裁决，方案 A）：缺失时不再
 * 显示「请先选择项目」的拦截空态——走 `PersonalChatScreen`（个人对话，不挂靠
 * 任何项目）。有 ⇒ 项目内对话（`ChatReadScreen`）。
 */
export default function ChatLegacyPage({
  searchParams,
}: {
  searchParams: { projectId?: string; thread?: string };
}) {
  const projectId = nonEmpty(searchParams.projectId);
  const threadId = nonEmpty(searchParams.thread);
  if (projectId === null) return <PersonalChatScreen initialThreadId={threadId} />;
  return <ChatReadScreen projectId={projectId} initialThreadId={threadId} />;
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
