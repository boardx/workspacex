"use client";

/**
 * #1911 —— 真正 `import "@xyflow/react"` 的那一层。
 *
 * 单独拆成这个文件，好让上层 `agent-capability-graph.tsx` 用
 * `next/dynamic(..., { ssr: false })` 整体懒加载它——`@xyflow/react` 在挂载时
 * 会量测节点尺寸（`ResizeObserver`），SSR 阶段没有这些浏览器 API，与
 * `asset-code-editor.tsx` 对 Monaco 的处理是同一个坑、同一个修法（其头注「为什么用
 * next/dynamic({ ssr: false })」逐字适用于这里，只是浏览器 API 换成了
 * `ResizeObserver` 而不是 `window`/`navigator`）。
 *
 * 只读边界：`nodesConnectable={false}` + 不传 `onConnect`——即使用户在两个节点的
 * 手柄之间拖拽，也构造不出新的边；`nodesDraggable={false}` 连节点位置都不能挪，
 * 这一轮是「看清楚现状」，不是「编辑现状」。
 */
import * as React from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  CapabilityGraphMcpNode,
  CapabilityGraphSkillNode,
} from "@/lib/agent-capability-graph-model";

type NodeVariant = "agent" | "skill" | "mcp";

interface CapabilityNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly sublabel?: string;
  readonly href?: string;
  readonly variant: NodeVariant;
  readonly testId: string;
}

const VARIANT_STYLE: Record<NodeVariant, string> = {
  agent: "border-primary bg-primary/10 text-foreground font-semibold",
  skill: "border-border bg-card text-foreground hover:bg-muted",
  mcp: "border-border bg-card text-foreground hover:bg-muted",
};

function CapabilityNode({ data }: NodeProps) {
  const d = data as CapabilityNodeData;
  const body = (
    <div className="flex flex-col gap-0.5 px-3 py-2 text-11">
      <span>{d.label}</span>
      {d.sublabel ? <span className="text-10 text-muted-foreground">{d.sublabel}</span> : null}
    </div>
  );
  return (
    <div
      className={`rounded-lg border text-left transition-colors duration-200 ${VARIANT_STYLE[d.variant]}`}
      data-testid={d.testId}
    >
      {d.href ? (
        <Link href={d.href} data-testid={`${d.testId}-link`} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

const NODE_TYPES = { capability: CapabilityNode };

function toNode(
  id: string,
  x: number,
  y: number,
  data: CapabilityNodeData,
  handlePosition: { source?: Position; target?: Position } = {},
): Node {
  return {
    id,
    type: "capability",
    position: { x, y },
    data,
    sourcePosition: handlePosition.source,
    targetPosition: handlePosition.target,
  };
}

export default function AgentCapabilityGraphCanvas({
  agentId,
  agentLabel,
  skillNodes,
  mcpNodes,
}: {
  agentId: string;
  agentLabel: string;
  skillNodes: readonly CapabilityGraphSkillNode[];
  mcpNodes: readonly CapabilityGraphMcpNode[];
}) {
  const { nodes, edges } = React.useMemo(() => {
    const centerX = 0;
    const centerY = Math.max(skillNodes.length, mcpNodes.length) * 40;
    const built: Node[] = [
      toNode(
        `agent:${agentId}`,
        centerX,
        centerY,
        {
          label: agentLabel,
          sublabel: "Agent",
          variant: "agent",
          testId: "agent-capability-graph-node-agent",
        },
        { source: Position.Right },
      ),
    ];
    const builtEdges: Edge[] = [];

    skillNodes.forEach((skill, index) => {
      const nodeId = `node:${skill.id}`;
      built.push(
        toNode(
          nodeId,
          -360,
          index * 80,
          {
            label: skill.label,
            sublabel: `Skill · v${skill.skillVersion}`,
            href: skill.href,
            variant: "skill",
            testId: `agent-capability-graph-node-skill-${skill.skillId}`,
          },
          { target: Position.Right },
        ),
      );
      builtEdges.push({
        id: `edge:${nodeId}`,
        source: `agent:${agentId}`,
        target: nodeId,
        data: { testId: `agent-capability-graph-edge-skill-${skill.skillId}` },
      });
    });

    mcpNodes.forEach((tool, index) => {
      const nodeId = `node:${tool.id}`;
      built.push(
        toNode(
          nodeId,
          360,
          index * 80,
          {
            label: `${tool.serverSlug}.${tool.toolName}`,
            sublabel: `MCP · ${tool.state}`,
            href: tool.href,
            variant: "mcp",
            testId: `agent-capability-graph-node-mcp-${tool.serverSlug}-${tool.toolName}`,
          },
          { target: Position.Left },
        ),
      );
      builtEdges.push({
        id: `edge:${nodeId}`,
        source: `agent:${agentId}`,
        target: nodeId,
        data: { testId: `agent-capability-graph-edge-mcp-${tool.serverSlug}-${tool.toolName}` },
      });
    });

    return { nodes: built, edges: builtEdges };
  }, [agentId, agentLabel, skillNodes, mcpNodes]);

  return (
    <div
      className="h-[420px] w-full rounded-lg border border-border bg-background"
      data-testid="agent-capability-graph-canvas"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnScroll
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
