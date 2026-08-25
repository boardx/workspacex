import { redirect } from "next/navigation";
import { ChatReadScreen } from "@/components/chat/chat-read-screen";
import { PersonalChatScreen } from "@/components/chat/personal-chat-screen";

/**
 * 正式 Chat 入口。
 *
 * 🔴 2026-08-25 人类裁决（原话「直接更改，chat为新的版本copilot-kit」）：默认入口
 * 翻转为 CopilotKit v2 新轨道——裸 `/chat`（无任何查询参数）redirect 到
 * `/chat/copilotkit-v2`。这是 backlog DA-19g「翻转默认值需要人类确认」那一步的
 * 人类确认本体，不是 agent 自行决定。
 *
 * ## 为什么带参数的深链仍走旧屏（不是留恋旧代码，是新轨道还没有这两个概念）
 *
 * `?projectId=`（项目内对话）与 `?thread=`（定位到某条持久线程）在 CopilotKit v2
 * 轨道上**尚无对应实现**——功能对等差距清单
 * （`.harness/state/chat-feature-parity-gap-2026-08-25.md`）第 1 项：v2 的
 * threadId 每次挂载随机生成、无持久线程概念；项目上下文则完全未接。把这些深链
 * 也 redirect 过去等于把「打开某个项目的某条历史对话」变成「打开一个空白新会话」
 * ——那是功能破坏，不是入口翻转。对等差距（持久化/附件/skill/agent 编制）逐项
 * 补齐后，这两个分支随差距清单第 1 项一起收敛进 v2，旧屏随 DA-19h 正式退役。
 *
 * 旧屏的显式回退入口：`/chat/legacy`（S1=B 灰度纪律——回退路径保留到 DA-19h，
 * 老 e2e 取证 spec 也从那里进）。
 *
 * （历史：#594 人类裁决的「无 projectId ⇒ 个人对话」分岔原文保留在
 * `/chat/legacy/page.tsx`，此处不再复述。）
 */
export default function ChatPage({
  searchParams,
}: {
  searchParams: { projectId?: string; thread?: string };
}) {
  const projectId = nonEmpty(searchParams.projectId);
  const threadId = nonEmpty(searchParams.thread);
  if (projectId === null && threadId === null) redirect("/chat/copilotkit-v2");
  if (projectId === null) return <PersonalChatScreen initialThreadId={threadId} />;
  return <ChatReadScreen projectId={projectId} initialThreadId={threadId} />;
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
