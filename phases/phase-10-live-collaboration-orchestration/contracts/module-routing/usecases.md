# `module-routing` — 用例接口与失败模式

## 端口（草案，签核通过后落进 `packages/contracts/src/live-collab-module-routing.ts`）

| 端口 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `getModuleCounts` | `groupId` | `{ chat, interview, research, survey }` | 五模块侧栏计数徽标；具体来自哪个下游 phase 的真实接口，签核时确认聚合方式 |
| `getModuleCards` | `groupId`, `moduleKey`（`chat`\|`interview`\|`research`\|`survey`） | `{ cards: [{id, visibilityBadge, statusBadge, summary, ownerAvatar, openUrl}] }` | 统一卡片形态（Q3 已裁定字段集），`graph` 模块不走这个端口（见下条） |
| `getGroupGraphSummary`（图谱模块专属，非统一卡片形态） | `groupId` | 待定（决策小树结构，需 phase-02 契约束签核后确认形状） | 图谱模块展示形态与其余四模块不同，签核时确认是否要收敛 |

## 失败模式

| 场景 | 错误码（草案） | 前端表现 |
|---|---|---|
| 组员/组长请求不属于自己分组的模块数据 | 沿用 `viewer-role` 束的 `VIEWER_SCOPE_DENIED`（不重复定义） | `denied` 态，与 viewer-role 束共用同一套拒绝渲染逻辑 |
| 下游模块（chat/interview/research/survey）真实接口尚未接入 | 无接口，前端渲染 mock 骨架 | 卡片列表显示"待接入"标记，不渲染编造的卡片内容 |
| 跳转到模块本体时上下文丢失 | 前端路由校验失败（非后端错误码） | 阻止跳转，提示"缺少项目/分组/环节上下文"，不允许静默丢上下文继续跳转 |

## 签核前请重点确认

- [ ] **本束不重复实现 `viewer-role` 束已有的角色判定**：`getModuleCards`/`getModuleCounts`
      的权限校验应该调用 `viewer-role` 束的共享判定服务，不是各自再写一遍角色 if-else。
- [ ] **路由跳转的上下文携带方式**（URL 参数 / 前端 state / 服务端 session）需要在契约设计阶段
      与 4 个下游 phase 统一约定，不能每个模块各带各的。
