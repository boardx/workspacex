# `group-checkin` — 用例接口与失败模式

## 端口（草案，签核通过后落进 `packages/contracts/src/live-collab-checkin.ts`）

| 端口 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `getGroupCheckinBoard` | `projectId`，服务端从会话取当前用户角色 | `{ groups: [{no, name, joinUrl, missingCount, members: [{name, roleBadge, arrived}]}] }` | 引导师查询用，返回全部分组的聚合到场数据 |
| `recordCheckinEvent` | `groupId`, `userId`（来自 phase-01 01-auth 的链接校验结果，不是本束自己校验） | `{ arrived: true, arrivedAt }` | 参与者点开加入链接触发；本束只负责"记一笔到场"，不负责链接本身的合法性校验 |
| `getJoinPreview`（站内预览，Q5 裁定） | `groupId` | `{ previewHtml 或结构化预览数据 }` | 供引导师"看加入页"按钮调用，返回参与者视角会看到的内容，不是一个可跳转的独立 URL |

## 失败模式

| 场景 | 错误码（草案） | 前端表现 |
|---|---|---|
| 分组未指定组长，无法签发链接 | `GROUP_LEAD_MISSING`（草案，示例规则待签核确认是否保留） | `err-link` 态（见 `stage-checkin-invalid.png`） |
| `recordCheckinEvent` 收到的链接校验结果无效（token 过期/伪造） | 沿用 phase-01 01-auth 已有错误码（需实现时核实具体值） | 不记到场，参与者停留在加入失败页（归属 01-auth） |
| 项目还没有任何分组到场 | 无错误，空数据 | `empty` 态（见 `stage-checkin-empty.png`） |

## 签核前请重点确认

- [ ] **`recordCheckinEvent` 不做二次链接校验**：链接合法性完全信任 phase-01 01-auth 已完成的
      校验结果，本束不重复实现一遍 token 校验逻辑（避免同一件事在两处各判一次、判据还可能不一致）。
- [ ] **`getJoinPreview` 的返回形状**：站内预览具体要返回渲染好的片段还是结构化数据交给前端渲染，
      两种做法对契约设计影响不同，签核时请给方向性意见。
