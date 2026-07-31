/**
 * 纯 Node 入口：只激活 19 个《工作坊模板 A0》的 `TemplateSpec` 注册，**不触碰 fabric / mermaid**。
 *
 * 为什么要单独开一个入口，而不是让调用方 import `../index`：
 *   `src/index.ts` 会 `import './diagrams'`（拉进 er/gantt/... 全部图表插件）并间接触达
 *   `canvas-io` → `fabric`，而 mermaid 的解析路径依赖真实浏览器的 `getBBox`。
 *   后端的模板注册表契约测试（F100）跑在 Node 里，它要的只有「19 个 key」这一条事实。
 *   走这个入口，契约测试就不需要 jsdom、也不需要 fabric 能加载。
 *
 * ⚠ 这里**不声明任何 key 字面量**。key 的唯一权威是下面三个模块 + `persona.ts` 的
 *   `registerTemplate({ key: ... })` 调用；本文件只做「把它们激活」这一件事。
 *   `displayName` 也不在这里 —— 它是展示层事实，单点定义在
 *   `packages/contracts/src/canvas.ts` 的 `BUILTIN_CANVAS_TEMPLATES`（O-09 / ADR-100）。
 */
import './diagrams/persona';
import './diagrams/templates-strategy';
import './diagrams/templates-user';
import './diagrams/templates-story';

export {
  getTemplate,
  listTemplates,
  registerTemplate,
  /** `模板: <key>` 围栏 → DiagramModel。纯函数，不需要浏览器（R10 运行环境取舍） */
  templateToModel,
  parseTemplateText,
  serializeTemplate,
} from './diagrams/template-engine';
export type { TemplateSpec, TemplateSection } from './diagrams/template-engine';
