"use client";
import * as React from "react";
import { getAgentRun, type AgentRunView } from "@/lib/agent-run";
import { AgentToolChain } from "@/components/chat/agent-tool-chain";

/**
 * 2026-08-14 人类实测反馈重做：思考过程/工具调用链此前**只**挂在 composer 下方、只在
 * "当前这次正在提交的 run"还活着时可见——一旦消息落库、翻到别的对话再翻回来，
 * 或者只是往上滚一屏，这段信息就彻底看不到了。参照 Claude Code 与本仓自己的原型
 * （`ai-message.tsx`，孤儿组件，从没接进活体路径）：思考摘要该挂在**每一条持久消息自己
 * 身上**，跟着消息走，不是跟着"当前是否有一个 run 在跑"这个瞬时状态走。
 *
 * ## 数据从哪来——`DurableMessage.agentRunId`，不是新接口
 * 每条持久化的 AI 消息本就带 `agentRunId`（`packages/contracts/src/chat.ts`），
 * `getAgentRun(runId)` 是既有的活体轮询端点，本组件只是把它从"只喂当前 run"改成
 * "喂这条消息自己的 run"——零新契约，复用 `AgentToolChain`（TOOLCHAIN-01 已有的
 * 折叠式摘要组件）原样渲染，不重新发明展示形状。
 *
 * ## 惰性到"进入视口才拉取"——不是"挂载就拉取"
 * 第一版写成"挂载即 `getAgentRun`"，本地测试（20 条种子消息、10 条是 AI 消息）当场
 * 暴露真实问题：一进线程详情就并发打 10 个 `getAgentRun`，纯粹为了画 10 行折叠摘要——
 * 这是货真价实的 N+1，滚得越长的线程代价越大。改成同 `ChatDiagramFabric`（VZ-02）
 * 一致的模式：`IntersectionObserver`（`rootMargin: 200px`），这条消息真正滚进视口
 * （或即将滚入）才发起请求，滚过去的历史消息不会因为"曾经渲染过"就一直占着一个
 * 已完成的请求——同时也天然避免了"一次性把整页历史都拉一遍"这种反模式。
 *
 * ## 不做跨组件缓存
 * 第一版还写了一个模块级 `Map` 缓存"同一个 runId 只请求一次"——初衷是避免重复请求，
 * 实测反而引入了一个更隐蔽的问题：同一个 `agentRunId` 在不同渲染场景下被缓存的第一次
 * 结果钉死，后续渲染即使数据环境变了也读到旧值（测试环境下体现为「测试 A 缓存的结果
 * 泄漏进测试 B」）。生产环境下重复请求同一个已终态的 run 只是不必要的一次网络往返，
 * 不是正确性问题；用视口惰性化已经把请求量降到「用户实际看得到多少」的量级，
 * 不需要再叠一层缓存去解决一个次要的性能顾虑、却引入一个真正的数据新鲜度顾虑。
 *
 * ## 失败静默降级
 * 请求失败——网络抖动、run 已被清理等——**不渲染任何东西**，不是错误占位、不是重试
 * 按钮：这是消息正文之外的锦上添花信息，缺了不该让消息本身看起来像出了问题。
 */
export function MessageThinkingChain({
  agentRunId,
  bearer,
}: {
  agentRunId: string | null;
  bearer: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [inView, setInView] = React.useState(false);
  const [view, setView] = React.useState<AgentRunView | null>(null);

  React.useEffect(() => {
    if (!agentRunId) return;
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [agentRunId]);

  React.useEffect(() => {
    if (!agentRunId || !inView) return;
    let cancelled = false;
    void getAgentRun(agentRunId, bearer)
      .then((result) => {
        if (!cancelled) setView(result);
      })
      .catch(() => {
        // 静默降级（见文件头注释）——不设错误态，消息正文不受影响。
      });
    return () => {
      cancelled = true;
    };
  }, [agentRunId, bearer, inView]);

  if (!agentRunId) return null;
  return (
    <div ref={containerRef}>
      {view ? <AgentToolChain steps={view.steps} /> : null}
    </div>
  );
}
