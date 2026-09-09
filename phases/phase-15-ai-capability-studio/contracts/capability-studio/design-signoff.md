---
bundle: capability-studio
phase: "15"
covers: []
status: pending
confirmed_by: ""
confirmed_at: ""
---

# 能力开发与运行统一签核

材料准备中，尚未请求人类签核。功能编号待真实 UI 和 API 契约收敛后由 requirement-author 生成。

本束将导入、草稿、试跑、发布和运行依赖放在一起评审：它们共同约束“被测试内容与被发布、被运行内容相同”，分开签会产生跨束版本歧义。实施仍按独立 feature/issue/PR 分工。

## ① UI

见 [ui.md](ui.md)。必须有真实组件可运行预览与截图，当前待工作台 worker 交付及本地核验。

## ② 用例

见 [usecases.md](usecases.md)、[domain.md](domain.md)、[coverage.md](coverage.md)。确认导入来源范围、保存不发布、精确草稿测试、权限、并发修改、上游冲突及回滚语义。

## ③ API 契约

待集成 packages/contracts 中的可执行 skill-development 与 capability-runtime-policy 草案，并逐条核对已有 skills、agent-runtime、MCP 操作的复用与 design delta。当前文字提案不能替代可执行 schema。

## 未就绪项

- 新原型及七态截图尚未本地验证。
- 两份共享 schema 尚待取回、类型检查、拒绝用例测试及 API→UC 对照。
- feature 清单未定稿，covers 尚未映射；不能进入 claim/new-sprint。
- 身份与远端租约未就绪，注册 PR 等 CI 和独立评审。
