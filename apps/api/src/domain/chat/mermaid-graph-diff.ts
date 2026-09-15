/**
 * 产业图谱两个版本的结构化比较——**纯函数**，domain 层的正式入口。
 *
 * ⚠ 实现**不在这里**，在 `@repo/fabric-markdown/mermaid-graph-diff`，本文件只转出。
 *   不是偷懒，是根 `AGENTS.md` 那条「同一事实不得声明在两处」：这份解析/比较逻辑
 *   前端（版本历史面板要渲染同一张差异表）与后端（`landAsArtifact` 续版本后的服务端
 *   比较）都要用，而 `apps/web` 不可能 import `apps/api/src/domain`。放进那个已经被
 *   两边共用的 mermaid 库（`update-canvas-source.ts` 早就从那里取 `extractMermaidBlocks`
 *   的先例），两边引同一份实现；domain 层保留这个转出口，是为了应用层不必知道
 *   「这件领域知识恰好住在哪个包里」。
 *
 * 该模块**不 import fabric / DOM**（同包里 `markdown.ts` 的处境），后端引它不会把
 * 浏览器依赖拖进来。
 */
export {
  diffMermaidGraphs,
  parseMermaidGraph,
} from "@repo/fabric-markdown/mermaid-graph-diff";
export type {
  MermaidGraph,
  MermaidGraphDiffEntry,
  MermaidGraphEdge,
  MermaidGraphNode,
} from "@repo/fabric-markdown/mermaid-graph-diff";
