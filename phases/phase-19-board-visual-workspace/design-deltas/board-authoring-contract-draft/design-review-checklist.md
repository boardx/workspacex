# `board-authoring` 设计评审清单（BV04/BV05 草案）

本清单位于 `design-deltas/`，尚未建立正式契约束或签核记录。请先审阅材料并提出修改；人类确认后再形成正式 `contracts/board-authoring/` 并复核阶段一致性。

本束只覆盖 Sticky/Text 直接创作、连续输入、批量创建和基础撤销。① UI 是本地 mock 方向评审，正式路由和真实服务行为尚待实现与验收；签核设计不等于 feature passing。

## 材料

- ① UI：[界面与八态截图](ui.md)；[预览证据说明](../../ui-preview/board-authoring/README.md)。
- ② 用例：[UC-A1～A5 与失败路径](usecases.md)。
- ③ API/协议：[命令入口、ACK、权限与原 id 恢复边界](api.md)。
- 支撑材料：[领域不变量](domain.md)、[需求双向覆盖](coverage.md)。

## ① UI — 界面方向

- [ ] 底部 dock、对象内直接编辑、选中后的轻量菜单与窄屏避让是否可接受？
- [ ] mock 七态加窄屏能否用于方向签核？正式路由的 IME、RTL、软键盘与失败恢复证据何时补齐？
- [ ] `02-object-authoring.md#R8` 的左侧工具描述与底部 dock 方向如何归一？

## ② 用例 — 用户与失败路径

- [ ] UC-A1～A5 的触发、权限、提交确认、远端删除与草稿恢复是否完整？
- [ ] Tab 连续创作与可访问键盘导航如何优先；500 张一次事务与 501 行拒绝如何验收？
- [ ] BV05 的基础 Undo 与 BV22 的多人历史边界是否清楚；Delete→Undo 同 id 的可交付方案是什么？

## ③ API/协议 — 单源与确认语义

- [ ] 是否沿用 `WhiteboardCommand`/`BoardCommandPort`，不新增对象 CRUD 或 Fabric JSON 存储？
- [ ] 持久 sizing `fixed/auto-size/auto-height` 与 normal/free 拖拽手势如何定稿？
- [ ] 服务端 ACL、跨重连幂等、原 id 认证恢复与权威 ACK 的实现位置及错误码是否确定？

## 人类确认动作

请先裁决三节问题，再由人类复核 [阶段一致性](../../design-coherence.md) 对新束的交叉约束。现有阶段确认仅覆盖 `board-fabric-surface`，不能推断为本草案签核。
