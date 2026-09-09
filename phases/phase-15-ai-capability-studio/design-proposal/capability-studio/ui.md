# 工作台 UI 材料

当前状态：真实组件原型已运行并完成下列浏览器交互验证，尚未接入生产 API；本材料仍属提案，不能替代整阶段签核。

路由：`/preview/ai-capability-studio/workbench`。本地预览命令：`pnpm --filter web dev --port 3027`。

组件：`apps/web/components/ai-capability-studio/workbench-preview.tsx`；本地展示状态：同目录 `preview-model.ts`。使用既有 Button、Input、Textarea、Dialog、StateShell 和设计 token。

## 已验证的交互

| 交互 | 浏览器观察 | 稳定定位 |
|---|---|---|
| 导入预览→确认 | 只推进草稿，发布版本及 Agent 绑定不变 | studio-import、studio-preview-source、studio-confirm-import |
| 多文件保存 | 切换文件保留编辑，保存只推进草稿 revision | studio-file-content、studio-save |
| 新建/重命名/删除 | 非法路径保留输入并报错；删除单独确认；SKILL.md 受保护 | studio-path、studio-confirm-path、studio-confirm-delete |
| AI 修改 | 先显示差异，接受后仅改变 SKILL.md，选中脚本时也不向代码追加自然语言 | studio-ai-diff、studio-accept-ai |
| 试跑成功与失败 | 成功开启发布；失败可返回原草稿编辑 | studio-trial-result、studio-fix-failure |
| 依赖改变 | 停用模型使发布不可用；旧通过结果显示过期；重新启用仍须重新测试 | studio-toggle-model、studio-publish |
| 发布→绑定 | 发布单独确认，v2 发布后 Agent 仍固定 v1；显式绑定后才变为 v2 | studio-confirm-publish、studio-confirm-bind |
| 上游与回退 | 确认后只修改草稿，不改变发布历史或绑定 | studio-merge-upstream、studio-confirm-rollback |
| 七态 | default/loading/empty/invalid/dep-failed/denied/success 均已实际打开 | StatePreviewSwitcher |
| 窄屏 | 390×844 下 DOM clientWidth 与 scrollWidth 都为390，无横向溢出；验证后重置视口 | studio-preview |

## 截图

本文件引用 17 张，目录实存 17 张。

- [agent-bound](../../ui-preview/workbench/agent-bound.png)
- [ai-diff](../../ui-preview/workbench/ai-diff.png)
- [default](../../ui-preview/workbench/default.png)
- [denied](../../ui-preview/workbench/denied.png)
- [dep-failed](../../ui-preview/workbench/dep-failed.png)
- [empty](../../ui-preview/workbench/empty.png)
- [import](../../ui-preview/workbench/import.png)
- [invalid](../../ui-preview/workbench/invalid.png)
- [loading](../../ui-preview/workbench/loading.png)
- [mobile](../../ui-preview/workbench/mobile.png)
- [publish-confirm](../../ui-preview/workbench/publish-confirm.png)
- [rollback-confirm](../../ui-preview/workbench/rollback-confirm.png)
- [stale-evidence](../../ui-preview/workbench/stale-evidence.png)
- [success](../../ui-preview/workbench/success.png)
- [trial-failed](../../ui-preview/workbench/trial-failed.png)
- [trial-passed](../../ui-preview/workbench/trial-passed.png)
- [upstream-confirm](../../ui-preview/workbench/upstream-confirm.png)

## 验证边界与剩余设计

以上为浏览器中的 mock 交互证据，不是导入真实 GitHub、数据库持久化或真实模型运行证据。发布成功提示明确标注演示，未伪造产物下载。

待补齐：ZIP/私有仓库连接、多候选批量导入及任务进度、Model 配置和连接诊断、MCP 发现与逐工具审批、真实 Agent 选择、聊天失败归因、并发冲突、离开页面未保存提醒、键盘焦点专项验证。权限演示还不能证明后端鉴权。正式束签核前需要将原型数据结构接到审阅后的契约，补全覆盖矩阵。
