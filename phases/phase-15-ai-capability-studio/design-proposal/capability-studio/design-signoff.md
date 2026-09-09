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

见 [ui.md](ui.md)。Skill/导入已有截图；管理原型可运行，最新管理页和原生历史/键盘复验仍待 Mac 解锁。

## ② 用例

见 [usecases.md](usecases.md)、[domain.md](domain.md)、[coverage.md](coverage.md)。确认导入来源范围、保存不发布、精确草稿测试、权限、并发修改、上游冲突及回滚语义。

## ③ API 契约

已加入 skill-development、capability-runtime-policy 与 capability-admin-deltas 可执行草案，33 项定向契约测试通过。完整 API→用例→权限→feature 映射仍未收口；schema 测试不能替代生产 API 与数据库证据。

## 未就绪项

- Skill/导入已有历史截图；管理页及历史/键盘浏览器复验仍缺证据。
- schema 已完成类型检查和反例测试；完整 API→UC→权限→feature 覆盖仍待收口。
- feature 清单未定稿，covers 尚未映射；不能进入 claim/new-sprint。
- 身份与远端租约未就绪，注册 PR 等 CI 和独立评审。
