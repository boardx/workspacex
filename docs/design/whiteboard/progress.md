# 设计进度

## 2026-09-23

- 用户直接要求先形成便利贴协作白板需求与架构，因此本轮为设计输入编写，未认领队列中的代码 feature。
- 完成 requirements.md、architecture.md、research.md 与阅读入口；覆盖首版工作坊闭环、Yjs、API、AI、会议室、自托管和迁移。
- 检查本地既有 canvas、board、AI canvas 契约，并查阅竞品/Yjs 官方资料；检查范围和 HEAD 见 research.md。
- 未开发功能、未更改 feature 状态、未签核 UI/用例/API、未创建正式 ADR；没有把设计稿称为开发完成。
- 初始化未通过：`./init.sh` 在写 `.git/hooks/pre-commit` 时遇到 Operation not permitted。标准 harness CLI 的 tsx IPC 亦受沙箱限制；改用 `node --import tsx` 成功读取 readiness，但 tick 明确报告未配置 COORD_GATEWAY_URL。
- dashboard 的 GitHub 请求、fetch 和 Docker 查询受环境限制，结果不用于确认远端或生产健康。未配置身份/租约及持续 loop，未冒用 registry 中的身份。
- 本轮为本地未提交设计草稿；没有 PR/CI/合并证据。代码基础验证仍未确认，后续开发前必须恢复正常开工流程。

### 用户补充：Chat 图表插入 Board

- 将当前 Chat 可渲染的 Mermaid/Fabric 图表及 canvas/persona 模板插入 Board 纳入首版 WB-12，新增 A11/A12 验收。
- 明确对象级编辑、当前布局持久化、来源追溯、独立副本语义、权限与重试边界；不能用截图替代已有图型的可编辑支持。
- 架构补充 DiagramModel/当前布局到 Board 对象的桥接、ID 重映射和原子导入；检查了 Chat 分流与 canvas-io 接入点。仍为文档变更，未实现桥接功能。

### 第 1 轮开发（issue #3902）

- 在 codex/studio-board-ui 隔离 worktree 中实现 Studio Board 顶级入口与可复用交互界面；开发预览生产禁用。
- 重新以获准权限运行 ./init.sh，主工作区与隔离 worktree 快速初始化均通过，上一轮 git hooks 权限问题已解除；不代表全仓 release 验证通过。
- 实现便签/图形/Frame、连线、拖动、批量、文字修改、搜索定位、撤销/重做与缩放；保持显式未保存预览，不接后端。
- 浏览器发现并修复375/768下裁切与属性遮挡。13项浏览器、19项组件/导航测试通过；详情见 ui-review.md。
- 缺注册身份与协调凭据；tick仍不能接入。正式UI/用例/API契约签核尚不存在，未代签。后续九轮未开始，完整需求未完成。
- 首轮 PR CI 的 verify-control-plane 指出两条新增路由未登记。已用 lint-ui-wiring 的生成器补齐原型分类；现有 mock 上限仍为36，不将登录壳的API冒充白板数据接线。应用代码首轮 CI 全绿，清单修正须以新提交CI为准。
- 第二轮 CI 发现 Board 浏览器 spec 尚未接入远端任务；已纳入现有 prototype-audit 配置，spec-gate 检查通过，使用 CI 同款配置本地执行 13 条用例。未增加测试豁免。
