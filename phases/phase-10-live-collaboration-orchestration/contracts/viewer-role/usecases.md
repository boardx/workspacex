# `viewer-role` — 用例接口与失败模式

## 端口（草案，签核通过后落进 `packages/contracts/src/live-collab-viewer-role.ts`）

| 端口 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `getViewerOptions` | `projectId`, `userId`（服务端从会话取，不信前端传） | `{ viewers: [{id, kind: "stage"\|"group", label, statusSuffix?}], currentRole }` | 返回当前用户能切到的视角列表；组长/组员只返回自己那一组 |
| `getRoleScopeNote` | `projectId`, `userId` | `{ role, promptText }` | 顶部提示条按角色区分的文案，来自服务端不是前端字典写死（防止漏改） |

## 失败模式

| 场景 | 错误码（草案） | 前端表现 |
|---|---|---|
| 组员/组长尝试访问不属于自己的分组或全场 | `VIEWER_SCOPE_DENIED` | `denied` 态（见 `stage-default-denied.png`） |
| 未登录/会话失效 | `UNAUTHENTICATED` | 跳转登录，不渲染任何视角数据 |
| 项目不存在或已归档 | `PROJECT_NOT_FOUND` | 空态 + 返回项目列表入口 |

## 签核前请重点确认

- [ ] `getViewerOptions` 的角色判定必须是**服务端权威**，前端拿到的列表本身就是「能看的」，
      不是「全量列表 + 前端过滤」——后者意味着响应体里可能夹带了不该给这个用户看的数据。
- [ ] 观察者调用 `getViewerOptions` 时，返回的 `viewers` 列表形状（是否包含分组选项）需要
      在此裁定——`ui.md` 已标出这是 Q1 未覆盖的缺口。
