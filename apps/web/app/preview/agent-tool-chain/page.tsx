import * as React from "react";
import Link from "next/link";
import { AgentToolChain } from "@/components/chat/agent-tool-chain";
import {
  TOOLCHAIN_SCENES,
  SCENE_LABEL,
  resolveToolChainScene,
  toolChainSteps,
  sceneDefaultOpen,
} from "@/lib/mock/agent-tool-chain";

/**
 * agent-tool-chain（TOOLCHAIN-01：活体 run 工具调用链改折叠式内联展示）UI 先行原型入口 ——
 * ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 纯前端 mock，**不接后端**。这里做的是**签核材料**，走真实的 `AgentToolChain` 组件，
 *   吃 mock 的 `AgentRunView["steps"]`。人类逐 scene 点选、亲手展开/收起核对。
 *
 * query 参数（预览手段）：?scene= collapsed | expanded | failure | no-tools | single
 *   顶部一排场景切换 pill。`expanded` 屏令组件默认展开，其余默认收起——但每屏都可手动切换。
 */
export default function AgentToolChainPreviewPage({
  searchParams,
}: {
  searchParams: { scene?: string };
}) {
  const scene = resolveToolChainScene(searchParams.scene);
  const steps = toolChainSteps(scene);
  const defaultOpen = sceneDefaultOpen(scene);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <nav
        className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3"
        data-testid="agent-tool-chain-scene-nav"
      >
        <span className="mr-1 text-11 font-medium text-muted-foreground">界面态</span>
        {TOOLCHAIN_SCENES.map((s) => {
          const active = s === scene;
          return (
            <Link
              key={s}
              href={`/preview/agent-tool-chain?scene=${s}`}
              data-testid={`agent-tool-chain-scene-${s}`}
              data-active={active}
              className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-200 ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-card-foreground hover:bg-muted"
              }`}
            >
              {SCENE_LABEL[s]}
            </Link>
          );
        })}
      </nav>

      <div
        className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6"
        data-testid="agent-tool-chain-preview"
      >
        <p className="text-11 text-muted-foreground">
          TOOLCHAIN-01 原型 · 纯前端 mock（不接后端）· 吃活体 run 的 <code>steps</code>（<code>AgentRunView[&quot;steps&quot;]</code>）
        </p>

        {/* 模拟活体 run 在 composer 下方的落点：一条「正在执行」状态 + 折叠式工具链。 */}
        <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card/50 p-3">
          <header className="flex items-center gap-2">
            <span className="text-11 font-medium text-primary">执行完成，回复已写入对话</span>
            <span className="text-10 text-muted-foreground">（mock 活体 run · 落点在 composer 下方）</span>
          </header>
          <AgentToolChain steps={steps} defaultOpen={defaultOpen} />
        </section>

        <p className="text-10 text-muted-foreground">
          提示：点摘要行可展开/收起。<code>expanded</code> 屏默认展开、其余默认收起——
          但每屏都能手动切换，收起态是本次要签的默认样式。
        </p>
      </div>
    </main>
  );
}
